// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {PinelyAccount} from "../src/PinelyAccount.sol";
import {PinelyAccountFactory} from "../src/PinelyAccountFactory.sol";
import {PackedUserOperation} from "../src/interfaces/erc4337/PackedUserOperation.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import {IERC1271} from "@openzeppelin/contracts/interfaces/IERC1271.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract MockTarget {
    uint256 public count;
    uint256 public totalPaid;

    function increment() external {
        count += 1;
    }

    function pay() external payable {
        totalPaid += msg.value;
    }

    function failingCall() external pure {
        revert("TargetFailure");
    }
}

contract PinelyAccountTest is Test {
    using MessageHashUtils for bytes32;

    PinelyAccount public account;
    PinelyAccountFactory public factory;
    MockTarget public target;

    uint256 public ownerPrivateKey = 0xA11CE;
    address public owner;

    uint256 public sessionPrivateKey = 0xB0B;
    address public sessionKey;

    uint256 public strangerPrivateKey = 0xBAD;
    address public stranger;

    address public entryPoint = address(0xEEE7172);

    uint48 public validAfter = 1_000;
    uint48 public validUntil = 2_000_000;
    uint256 public defaultSalt = 12345;

    function setUp() public {
        owner = vm.addr(ownerPrivateKey);
        sessionKey = vm.addr(sessionPrivateKey);
        stranger = vm.addr(strangerPrivateKey);

        vm.warp(1_700_000_000);

        factory = new PinelyAccountFactory(entryPoint);
        target = new MockTarget();

        account = factory.createAccount(owner, sessionKey, validUntil, validAfter, defaultSalt);

        vm.deal(address(account), 10 ether);
    }

    // --- Helpers to build the UserOp hash & signature ---

    function _signUserOp(uint256 signerPk, bytes32 userOpHash) internal pure returns (bytes memory) {
        bytes32 ethSignedHash = userOpHash.toEthSignedMessageHash();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerPk, ethSignedHash);
        return abi.encodePacked(r, s, v);
    }

    function _createSampleUserOp(bytes memory callData, bytes memory signature)
        internal
        view
        returns (PackedUserOperation memory)
    {
        return PackedUserOperation({
            sender: address(account),
            nonce: 0,
            initCode: "",
            callData: callData,
            accountGasLimits: bytes32(0),
            preVerificationGas: 0,
            gasFees: bytes32(0),
            paymasterAndData: "",
            signature: signature
        });
    }

    // --- Factory & Determinism ---

    function test_Factory_AddressPrediction() public view {
        address predicted = factory.getAddress(owner, sessionKey, validUntil, validAfter, defaultSalt);
        assertEq(predicted, address(account));
    }

    function test_Factory_IdempotentDeployment() public {
        // Re-call createAccount with the same parameters
        PinelyAccount reDeployed = factory.createAccount(owner, sessionKey, validUntil, validAfter, defaultSalt);
        assertEq(address(reDeployed), address(account));
    }

    function test_Factory_ZeroAddressReverts() public {
        vm.expectRevert(PinelyAccountFactory.ZeroAddress.selector);
        new PinelyAccountFactory(address(0));
    }

    // --- Account Direct Execution by Owner ---

    function test_Execute_ByOwner_Success() public {
        bytes memory callData = abi.encodeWithSelector(MockTarget.increment.selector);

        vm.prank(owner);
        account.execute(address(target), 0, callData);

        assertEq(target.count(), 1);
    }

    function test_Execute_WithValue_Success() public {
        bytes memory callData = abi.encodeWithSelector(MockTarget.pay.selector);

        vm.prank(owner);
        account.execute(address(target), 1 ether, callData);

        assertEq(target.totalPaid(), 1 ether);
        assertEq(address(account).balance, 9 ether);
    }

    function test_Execute_ByStranger_Reverts() public {
        bytes memory callData = abi.encodeWithSelector(MockTarget.increment.selector);

        vm.prank(stranger);
        vm.expectRevert(PinelyAccount.NotAuthorized.selector);
        account.execute(address(target), 0, callData);
    }

    function test_Execute_TargetFailureReverts() public {
        bytes memory callData = abi.encodeWithSelector(MockTarget.failingCall.selector);

        vm.prank(owner);
        vm.expectRevert(PinelyAccount.ExecutionFailed.selector);
        account.execute(address(target), 0, callData);
    }

    function test_ExecuteBatch_Success() public {
        address[] memory dests = new address[](2);
        dests[0] = address(target);
        dests[1] = address(target);

        uint256[] memory values = new uint256[](2);
        values[0] = 0;
        values[1] = 0.5 ether;

        bytes[] memory datas = new bytes[](2);
        datas[0] = abi.encodeWithSelector(MockTarget.increment.selector);
        datas[1] = abi.encodeWithSelector(MockTarget.pay.selector);

        vm.prank(owner);
        account.executeBatch(dests, values, datas);

        assertEq(target.count(), 1);
        assertEq(target.totalPaid(), 0.5 ether);
    }

    // --- Session Key Management ---

    function test_SetSessionKey_Success() public {
        address newSessionKey = address(0x999);
        uint48 newValidUntil = 5_000_000;
        uint48 newValidAfter = 2_000;

        vm.prank(owner);
        account.setSessionKey(newSessionKey, newValidUntil, newValidAfter);

        assertEq(account.sessionKey(), newSessionKey);
        assertEq(account.sessionKeyValidUntil(), newValidUntil);
        assertEq(account.sessionKeyValidAfter(), newValidAfter);
    }

    function test_RevokeSessionKey_Success() public {
        vm.prank(owner);
        account.revokeSessionKey();

        assertEq(account.sessionKey(), address(0));
        assertEq(account.sessionKeyValidUntil(), 0);
        assertEq(account.sessionKeyValidAfter(), 0);
    }

    function test_SessionKey_OnlyOwnerReverts() public {
        vm.prank(stranger);
        vm.expectRevert(PinelyAccount.NotOwner.selector);
        account.setSessionKey(address(0x123), 10, 0);

        vm.prank(stranger);
        vm.expectRevert(PinelyAccount.NotOwner.selector);
        account.revokeSessionKey();
    }

    // --- Allowlist & Anti-Self-Call ---

    function test_SessionKey_CannotCallSelf() public {
        // EntryPoint executes call targeting account itself
        bytes memory callData = abi.encodeWithSelector(PinelyAccount.revokeSessionKey.selector);

        vm.prank(entryPoint);
        vm.expectRevert(PinelyAccount.TargetCannotBeSelf.selector);
        account.execute(address(account), 0, callData);
    }

    function test_EnforceAllowlist_FiltersUnauthorizedTargets() public {
        vm.startPrank(owner);
        account.setEnforceAllowlist(true);
        account.setTargetAllowed(address(target), false);
        vm.stopPrank();

        bytes memory callData = abi.encodeWithSelector(MockTarget.increment.selector);

        // EntryPoint execution to disallowed target fails
        vm.prank(entryPoint);
        vm.expectRevert(PinelyAccount.TargetNotAllowed.selector);
        account.execute(address(target), 0, callData);

        // Owner allows target
        vm.prank(owner);
        account.setTargetAllowed(address(target), true);

        // Now EntryPoint execution succeeds
        vm.prank(entryPoint);
        account.execute(address(target), 0, callData);
        assertEq(target.count(), 1);

        // Owner is always exempt from allowlist restrictions
        address anotherTarget = address(0x777);
        vm.prank(owner);
        account.setTargetAllowed(anotherTarget, false);
        // Owner calling directly won't trigger TargetNotAllowed
    }

    function test_Execute_ByEntryPoint_OwnerUserOp_BypassesAllowlist() public {
        bytes memory callPayload = abi.encodeWithSelector(MockTarget.increment.selector);

        // Enable the allowlist and make sure the target is not yet allowed
        vm.prank(owner);
        account.setEnforceAllowlist(true);

        bytes32 userOpHash = keccak256("owner_user_op");
        bytes memory sig = _signUserOp(ownerPrivateKey, userOpHash);
        PackedUserOperation memory userOp = _createSampleUserOp(callPayload, sig);

        // The EntryPoint validates a UserOp signed by the Owner
        vm.prank(entryPoint);
        uint256 validationData = account.validateUserOp(userOp, userOpHash, 0);
        assertEq(validationData, 0);

        // The EntryPoint runs execute: must succeed because it was signed by the Owner
        vm.prank(entryPoint);
        account.execute(address(target), 0, callPayload);
        assertEq(target.count(), 1);
    }

    function test_Execute_ByEntryPoint_SessionKeyUserOp_EnforcesAllowlist() public {
        bytes memory callPayload = abi.encodeWithSelector(MockTarget.increment.selector);

        // Enable the allowlist and make sure the target is not yet allowed
        vm.prank(owner);
        account.setEnforceAllowlist(true);

        bytes memory executeCalldata = abi.encodeWithSelector(account.execute.selector, address(target), 0, callPayload);
        bytes32 userOpHash = keccak256("session_user_op");
        bytes memory sig = _signUserOp(sessionPrivateKey, userOpHash);
        PackedUserOperation memory userOp = _createSampleUserOp(executeCalldata, sig);

        // The EntryPoint validates a UserOp signed by the SessionKey: target not yet allowed -> validation fails
        vm.prank(entryPoint);
        uint256 validationData = account.validateUserOp(userOp, userOpHash, 0);
        assertEq(uint160(validationData), 1, "Validation must fail when destination not allowed");

        // Izinkan target di allowlist
        vm.prank(owner);
        account.setTargetAllowed(address(target), true);

        // Validation must now succeed
        vm.prank(entryPoint);
        validationData = account.validateUserOp(userOp, userOpHash, 0);
        assertEq(uint160(validationData), 0, "Validation must succeed when destination is allowed");

        // The EntryPoint executes against the allowed target: succeeds
        vm.prank(entryPoint);
        account.execute(address(target), 0, callPayload);
        assertEq(target.count(), 1);
    }

    // --- ERC-4337 validateUserOp ---

    function test_ValidateUserOp_OwnerSignature_Succeeds() public {
        bytes32 userOpHash = keccak256("userOpHash_1");
        bytes memory sig = _signUserOp(ownerPrivateKey, userOpHash);
        PackedUserOperation memory userOp = _createSampleUserOp("", sig);

        vm.prank(entryPoint);
        uint256 validationData = account.validateUserOp(userOp, userOpHash, 0);

        // validationData == 0 means valid signature and no time bounds
        assertEq(validationData, 0);
    }

    function test_ValidateUserOp_SessionKeySignature_SucceedsWithBounds() public {
        bytes32 userOpHash = keccak256("userOpHash_2");
        bytes memory sig = _signUserOp(sessionPrivateKey, userOpHash);
        PackedUserOperation memory userOp = _createSampleUserOp("", sig);

        vm.prank(entryPoint);
        uint256 validationData = account.validateUserOp(userOp, userOpHash, 0);

        // Check unpacked bounds
        uint160 sigFailed = uint160(validationData);
        uint48 unpackedValidUntil = uint48(validationData >> 160);
        uint48 unpackedValidAfter = uint48(validationData >> (160 + 48));

        assertEq(sigFailed, 0);
        assertEq(unpackedValidUntil, validUntil);
        assertEq(unpackedValidAfter, validAfter);
    }

    function test_ValidateUserOp_StrangerSignature_Fails() public {
        bytes32 userOpHash = keccak256("userOpHash_3");
        bytes memory sig = _signUserOp(strangerPrivateKey, userOpHash);
        PackedUserOperation memory userOp = _createSampleUserOp("", sig);

        vm.prank(entryPoint);
        uint256 validationData = account.validateUserOp(userOp, userOpHash, 0);

        // sigFailed == 1
        uint160 sigFailed = uint160(validationData);
        assertEq(sigFailed, 1);
    }

    function test_ValidateUserOp_RevokedSessionKey_Fails() public {
        vm.prank(owner);
        account.revokeSessionKey();

        bytes32 userOpHash = keccak256("userOpHash_4");
        bytes memory sig = _signUserOp(sessionPrivateKey, userOpHash);
        PackedUserOperation memory userOp = _createSampleUserOp("", sig);

        vm.prank(entryPoint);
        uint256 validationData = account.validateUserOp(userOp, userOpHash, 0);

        uint160 sigFailed = uint160(validationData);
        assertEq(sigFailed, 1);
    }

    function test_ValidateUserOp_PaysMissingAccountFunds() public {
        bytes32 userOpHash = keccak256("userOpHash_5");
        bytes memory sig = _signUserOp(ownerPrivateKey, userOpHash);
        PackedUserOperation memory userOp = _createSampleUserOp("", sig);

        uint256 epBalanceBefore = entryPoint.balance;

        vm.prank(entryPoint);
        account.validateUserOp(userOp, userOpHash, 0.25 ether);

        assertEq(entryPoint.balance, epBalanceBefore + 0.25 ether);
    }

    function test_ValidateUserOp_RevertIf_NotEntryPoint() public {
        bytes32 userOpHash = keccak256("userOpHash_6");
        bytes memory sig = _signUserOp(ownerPrivateKey, userOpHash);
        PackedUserOperation memory userOp = _createSampleUserOp("", sig);

        vm.prank(stranger);
        vm.expectRevert(PinelyAccount.NotEntryPoint.selector);
        account.validateUserOp(userOp, userOpHash, 0);
    }

    // --- Ownership Transfer ---

    function test_TransferOwnership_Success() public {
        address newOwner = address(0x888);

        vm.prank(owner);
        account.transferOwnership(newOwner);

        assertEq(account.owner(), newOwner);

        // Previous owner loses owner rights
        vm.prank(owner);
        vm.expectRevert(PinelyAccount.NotOwner.selector);
        account.revokeSessionKey();
    }

    // --- EIP-1271 isValidSignature ---

    function test_IsValidSignature_OwnerSignature_Succeeds() public view {
        bytes32 digest = keccak256("test_eip1271_digest");

        // 1. Direct raw hash signature
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPrivateKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);
        bytes4 magic = account.isValidSignature(digest, sig);
        assertEq(magic, bytes4(0x1626ba7e));

        // 2. Prefixed ethSignedMessageHash signature
        bytes32 ethSignedDigest = digest.toEthSignedMessageHash();
        (v, r, s) = vm.sign(ownerPrivateKey, ethSignedDigest);
        bytes memory sigPrefixed = abi.encodePacked(r, s, v);
        bytes4 magicPrefixed = account.isValidSignature(digest, sigPrefixed);
        assertEq(magicPrefixed, bytes4(0x1626ba7e));
    }

    function test_IsValidSignature_StrangerSignature_Fails() public view {
        bytes32 digest = keccak256("test_eip1271_digest_unauthorized");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(strangerPrivateKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        bytes4 magic = account.isValidSignature(digest, sig);
        assertEq(magic, bytes4(0xffffffff));
    }

    // --- EIP-1271 recursive verification and fail-closed hardening ---

    function test_IsValidSignature_SmartContractOwner_RecursiveEIP1271() public {
        MockSafeWallet safeOwner = new MockSafeWallet(owner);
        PinelyAccount safeAccount =
            new PinelyAccount(entryPoint, address(safeOwner), sessionKey, validUntil, validAfter);

        bytes32 digest = keccak256("test_recursive_safe_digest");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ownerPrivateKey, digest);
        bytes memory sig = abi.encodePacked(r, s, v);

        // Recursive EIP-1271 verification succeeds for a smart contract owner
        bytes4 magic = safeAccount.isValidSignature(digest, sig);
        assertEq(magic, bytes4(0x1626ba7e));

        // A stranger's signature is rejected
        (v, r, s) = vm.sign(strangerPrivateKey, digest);
        sig = abi.encodePacked(r, s, v);
        assertEq(safeAccount.isValidSignature(digest, sig), bytes4(0xffffffff));
    }

    function test_ValidateUserOp_SessionKey_RejectsNonExecuteCallData_FailClosed() public {
        bytes32 userOpHash = keccak256("userOpHash_session_unknown_selector");
        bytes memory sig = _signUserOp(sessionPrivateKey, userOpHash);

        // Arbitrary calldata (neither execute nor executeBatch)
        bytes memory badCallData = abi.encodeWithSelector(PinelyAccount.revokeSessionKey.selector);
        PackedUserOperation memory userOp = _createSampleUserOp(badCallData, sig);

        vm.prank(entryPoint);
        uint256 validationData = account.validateUserOp(userOp, userOpHash, 0);

        // The fail-closed hardening must return sigFailed == 1
        uint160 sigFailed = uint160(validationData);
        assertEq(sigFailed, 1, "Session key must not be allowed to invoke arbitrary selectors");
    }

    // --- x402 settlement UserOperations, signed the way the SDK signs them ---
    // The SDK signs personal_sign (EIP-191) over the raw 32-byte userOpHash with the machine session key.

    address internal constant SETTLEMENT_STABLE = address(0x7D29);
    address internal constant SETTLEMENT_MERCHANT = address(0x3C44);
    address internal constant SETTLEMENT_FEE_RECIPIENT = address(0x90F7);

    function _transferCall(address to, uint256 amount) internal pure returns (bytes memory) {
        return abi.encodeWithSignature("transfer(address,uint256)", to, amount);
    }

    function _settlementExecute() internal pure returns (bytes memory) {
        return abi.encodeCall(PinelyAccount.execute, (SETTLEMENT_STABLE, 0, _transferCall(SETTLEMENT_MERCHANT, 99_900)));
    }

    function _settlementBatchWithFee() internal pure returns (bytes memory) {
        address[] memory dests = new address[](2);
        dests[0] = SETTLEMENT_STABLE;
        dests[1] = SETTLEMENT_STABLE;
        uint256[] memory values = new uint256[](2);
        bytes[] memory datas = new bytes[](2);
        datas[0] = _transferCall(SETTLEMENT_MERCHANT, 99_800);
        datas[1] = _transferCall(SETTLEMENT_FEE_RECIPIENT, 100);
        return abi.encodeCall(PinelyAccount.executeBatch, (dests, values, datas));
    }

    function _validateSettlement(bytes memory callData, bytes32 userOpHash, bytes memory sig)
        internal
        returns (uint256)
    {
        vm.prank(entryPoint);
        return account.validateUserOp(_createSampleUserOp(callData, sig), userOpHash, 0);
    }

    function test_Settlement_Execute_SignedBySessionKey_Validates() public {
        bytes32 userOpHash = keccak256("settlement-execute");
        uint256 validationData =
            _validateSettlement(_settlementExecute(), userOpHash, _signUserOp(sessionPrivateKey, userOpHash));
        assertEq(uint160(validationData), 0, "SDK-signed settlement must validate");
        assertEq(uint48(validationData >> 160), validUntil, "session key time bounds are returned");
    }

    function test_Settlement_ExecuteBatchWithFee_SignedBySessionKey_Validates() public {
        bytes32 userOpHash = keccak256("settlement-batch");
        uint256 validationData =
            _validateSettlement(_settlementBatchWithFee(), userOpHash, _signUserOp(sessionPrivateKey, userOpHash));
        assertEq(uint160(validationData), 0);
    }

    function test_Settlement_RawHashSignature_IsRejected() public {
        // Signing the raw hash (not personal_sign over it) must not validate: this pins the scheme the
        // SDK and the backend rely on.
        bytes32 userOpHash = keccak256("settlement-raw");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(sessionPrivateKey, userOpHash);
        uint256 validationData = _validateSettlement(_settlementExecute(), userOpHash, abi.encodePacked(r, s, v));
        assertEq(uint160(validationData), 1);
    }

    function test_Settlement_OtherKey_IsRejected() public {
        bytes32 userOpHash = keccak256("settlement-stranger");
        uint256 validationData =
            _validateSettlement(_settlementExecute(), userOpHash, _signUserOp(strangerPrivateKey, userOpHash));
        assertEq(uint160(validationData), 1);
    }

    function test_Settlement_RequiresTheTokenOnTheAllowlistWhenEnforced() public {
        vm.prank(owner);
        account.setEnforceAllowlist(true);

        bytes32 userOpHash = keccak256("settlement-allowlist");
        bytes memory sig = _signUserOp(sessionPrivateKey, userOpHash);
        assertEq(
            uint160(_validateSettlement(_settlementExecute(), userOpHash, sig)),
            1,
            "USDC must be allowlisted before a session key can pay with it"
        );

        vm.prank(owner);
        account.setTargetAllowed(SETTLEMENT_STABLE, true);
        assertEq(uint160(_validateSettlement(_settlementExecute(), userOpHash, sig)), 0);
    }
}

contract MockSafeWallet is IERC1271 {
    address public signer;

    constructor(address _signer) {
        signer = _signer;
    }

    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4) {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(hash, signature);
        if (err == ECDSA.RecoverError.NoError && recovered == signer) return 0x1626ba7e;
        (recovered, err,) = ECDSA.tryRecover(MessageHashUtils.toEthSignedMessageHash(hash), signature);
        if (err == ECDSA.RecoverError.NoError && recovered == signer) return 0x1626ba7e;
        return 0xffffffff;
    }
}
