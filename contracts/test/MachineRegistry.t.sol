// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {MachineRegistry, IPinelyStake} from "../src/MachineRegistry.sol";
import {IMachineRegistry} from "../src/interfaces/IMachineRegistry.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockRegistryStable is ERC20 {
    constructor() ERC20("USDC Mock", "USDC") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockPinelyStake is IPinelyStake {
    mapping(address => bool) public hasStake;

    function setHasStake(address operator, bool value) external {
        hasStake[operator] = value;
    }

    function hasMinStakeGold(address operator) external view override returns (bool) {
        return hasStake[operator];
    }
}

contract MachineRegistryTest is Test {
    MachineRegistry public registry;
    MockPinelyStake public mockStake;

    address public owner = address(0xAA1);
    address public operator = address(0xBB1);
    address public guardian = address(0xBB2);
    uint256 internal machineAccountPk = 0xACC1;
    address public machineAccount;
    address public machineSigner = address(0xCC2);
    address public hook = address(0xDD1);
    address public attestor = address(0xEE1);
    address public stranger = address(0xFF1);

    bytes32 public sampleAttestation = keccak256("hardware-sample-tpm");

    event MachineRegistered(
        bytes32 indexed machineId,
        address indexed operator,
        address indexed account,
        address signer,
        bytes32 attestationHash
    );
    event PolicyUpdated(
        bytes32 indexed machineId, uint128 maxStableOutPerSwap, uint128 dailyStableOutCap, bool enabled
    );
    event SignerUpdated(bytes32 indexed machineId, address indexed oldSigner, address indexed newSigner);
    event MachineFrozen(bytes32 indexed machineId, address indexed by);
    event MachineUnfrozen(bytes32 indexed machineId, address indexed by);
    event FleetFrozen(address indexed operator, address indexed by);
    event FleetUnfrozen(address indexed operator, address indexed by);

    function setUp() public {
        vm.warp(1_700_000_000); // Set a realistic starting timestamp

        machineAccount = vm.addr(machineAccountPk);

        vm.prank(owner);
        registry = new MachineRegistry(owner);

        mockStake = new MockPinelyStake();

        vm.startPrank(owner);
        registry.setHook(hook);
        registry.setAttestor(attestor);
        registry.setStakeContract(address(mockStake));
        vm.stopPrank();
    }

    // --- Helper ---

    function _signRegisterAuth(address acc, address op, address sig, bytes32 attestation, uint256 accPk)
        internal
        view
        returns (bytes memory)
    {
        return _signRegisterAuthWithDeadline(acc, op, sig, attestation, block.timestamp + 1 hours, accPk);
    }

    function _signRegisterAuthWithDeadline(
        address acc,
        address op,
        address sig,
        bytes32 attestation,
        uint256 deadline,
        uint256 accPk
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                registry.REGISTER_AUTHORIZATION_TYPEHASH(),
                acc,
                op,
                sig,
                attestation,
                registry.accountNonces(acc),
                deadline,
                block.chainid
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", registry.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(accPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _registerDefaultMachine() internal returns (bytes32 machineId) {
        IMachineRegistry.SpendPolicy memory policy = IMachineRegistry.SpendPolicy({
            maxStableOutPerSwap: 50e18, // 50 USDC
            dailyStableOutCap: 200e18, // 200 USDC
            enabled: true
        });

        bytes memory sig =
            _signRegisterAuth(machineAccount, operator, machineSigner, sampleAttestation, machineAccountPk);
        vm.prank(operator);
        machineId = registry.registerMachineWithAuth(
            machineAccount, machineSigner, sampleAttestation, policy, block.timestamp + 1 hours, sig
        );
    }

    // --- Constructor & Admin ---

    function test_Constructor_ZeroAddressReverts() public {
        vm.expectRevert();
        new MachineRegistry(address(0));
    }

    function test_Admin_Setters() public {
        address newHook = address(0x111);
        address newAttestor = address(0x222);
        address newStake = address(0x333);

        vm.startPrank(owner);
        registry.setHook(newHook);
        assertEq(registry.hook(), newHook);

        registry.setAttestor(newAttestor);
        assertEq(registry.attestor(), newAttestor);

        registry.setStakeContract(newStake);
        assertEq(registry.stakeContract(), newStake);
        vm.stopPrank();

        // Non-owner reverts
        vm.prank(stranger);
        vm.expectRevert();
        registry.setHook(address(0x999));
    }

    // --- Registration ---

    function test_RegisterMachine_DirectSelfRegistration_Success() public {
        IMachineRegistry.SpendPolicy memory policy =
            IMachineRegistry.SpendPolicy({maxStableOutPerSwap: 100e18, dailyStableOutCap: 500e18, enabled: true});

        bytes32 expectedMachineId = keccak256(abi.encode(machineAccount));

        vm.expectEmit(true, true, true, true);
        emit MachineRegistered(expectedMachineId, machineAccount, machineAccount, machineSigner, sampleAttestation);

        // Direct self-registration where msg.sender == account
        vm.prank(machineAccount);
        bytes32 id = registry.registerMachine(machineAccount, machineSigner, sampleAttestation, policy);

        assertEq(id, expectedMachineId);
        assertEq(registry.machineIdOf(machineAccount), id);

        IMachineRegistry.Machine memory m = registry.getMachine(id);
        assertEq(m.account, machineAccount);
        assertEq(m.operator, machineAccount);
        assertEq(m.signer, machineSigner);
        assertEq(m.attestationHash, sampleAttestation);
        assertEq(m.registeredAt, uint64(block.timestamp));
        assertFalse(m.frozen);
        assertFalse(m.attestationValid);
    }

    /// @notice Direct registration without signature from non-account sender must revert.
    function test_RegisterMachine_RevertIf_UnauthorizedAccountRegistration() public {
        IMachineRegistry.SpendPolicy memory policy =
            IMachineRegistry.SpendPolicy({maxStableOutPerSwap: 100e18, dailyStableOutCap: 500e18, enabled: true});

        vm.prank(operator);
        vm.expectRevert(IMachineRegistry.UnauthorizedAccountRegistration.selector);
        registry.registerMachine(machineAccount, machineSigner, sampleAttestation, policy);
    }

    /// @notice Operator registration with valid EIP-712 auth signature succeeds.
    function test_RegisterMachineWithAuth_Success() public {
        IMachineRegistry.SpendPolicy memory policy =
            IMachineRegistry.SpendPolicy({maxStableOutPerSwap: 100e18, dailyStableOutCap: 500e18, enabled: true});

        bytes32 expectedMachineId = keccak256(abi.encode(machineAccount));

        bytes memory sig =
            _signRegisterAuth(machineAccount, operator, machineSigner, sampleAttestation, machineAccountPk);

        vm.expectEmit(true, true, true, true);
        emit MachineRegistered(expectedMachineId, operator, machineAccount, machineSigner, sampleAttestation);

        vm.prank(operator);
        bytes32 id = registry.registerMachineWithAuth(
            machineAccount, machineSigner, sampleAttestation, policy, block.timestamp + 1 hours, sig
        );

        assertEq(id, expectedMachineId);
        assertEq(registry.machineIdOf(machineAccount), id);

        IMachineRegistry.Machine memory m = registry.getMachine(id);
        assertEq(m.account, machineAccount);
        assertEq(m.operator, operator);
        assertEq(m.signer, machineSigner);
        assertEq(m.attestationHash, sampleAttestation);
        assertEq(m.registeredAt, uint64(block.timestamp));
        assertFalse(m.frozen);
        assertFalse(m.attestationValid);

        IMachineRegistry.SpendPolicy memory savedPolicy = registry.getPolicy(id);
        assertEq(savedPolicy.maxStableOutPerSwap, 100e18);
        assertEq(savedPolicy.dailyStableOutCap, 500e18);
        assertTrue(savedPolicy.enabled);
    }

    function test_RegisterMachineWithAuth_RevertIf_InvalidSignature() public {
        IMachineRegistry.SpendPolicy memory policy =
            IMachineRegistry.SpendPolicy({maxStableOutPerSwap: 100e18, dailyStableOutCap: 500e18, enabled: true});

        uint256 attackerPk = 0x666;
        bytes memory badSig = _signRegisterAuth(machineAccount, operator, machineSigner, sampleAttestation, attackerPk);

        vm.prank(operator);
        vm.expectRevert(IMachineRegistry.UnauthorizedAccountRegistration.selector);
        registry.registerMachineWithAuth(
            machineAccount, machineSigner, sampleAttestation, policy, block.timestamp + 1 hours, badSig
        );
    }

    function test_RegisterMachine_RevertIf_ZeroAddress() public {
        IMachineRegistry.SpendPolicy memory policy = IMachineRegistry.SpendPolicy(100e18, 500e18, true);

        vm.prank(machineAccount);
        vm.expectRevert(IMachineRegistry.ZeroAddress.selector);
        registry.registerMachine(address(0), machineSigner, sampleAttestation, policy);

        vm.prank(machineAccount);
        vm.expectRevert(IMachineRegistry.ZeroAddress.selector);
        registry.registerMachine(machineAccount, address(0), sampleAttestation, policy);
    }

    function test_RegisterMachine_RevertIf_AccountAlreadyRegistered() public {
        _registerDefaultMachine();

        IMachineRegistry.SpendPolicy memory policy = IMachineRegistry.SpendPolicy(100e18, 500e18, true);

        bytes memory sig =
            _signRegisterAuth(machineAccount, operator, machineSigner, sampleAttestation, machineAccountPk);

        vm.prank(operator);
        vm.expectRevert(IMachineRegistry.AccountAlreadyRegistered.selector);
        registry.registerMachineWithAuth(
            machineAccount, machineSigner, sampleAttestation, policy, block.timestamp + 1 hours, sig
        );
    }

    // --- Signer, Policy, Guardian, Allowlist ---

    function test_SetSigner_Success() public {
        bytes32 id = _registerDefaultMachine();
        address newSigner = address(0xCC3);

        vm.expectEmit(true, true, true, true);
        emit SignerUpdated(id, machineSigner, newSigner);

        vm.prank(operator);
        registry.setSigner(id, newSigner);

        assertEq(registry.getMachine(id).signer, newSigner);
    }

    function test_SetSigner_Reverts() public {
        bytes32 id = _registerDefaultMachine();

        // Stranger tries to update
        vm.prank(stranger);
        vm.expectRevert(IMachineRegistry.NotOperator.selector);
        registry.setSigner(id, address(0xCC3));

        // Invalid zero address signer
        vm.prank(operator);
        vm.expectRevert(IMachineRegistry.InvalidSigner.selector);
        registry.setSigner(id, address(0));

        // Non-existent machine
        vm.prank(operator);
        vm.expectRevert(IMachineRegistry.MachineNotFound.selector);
        registry.setSigner(keccak256("non-existent"), address(0xCC3));
    }

    function test_SetPolicy_Success() public {
        bytes32 id = _registerDefaultMachine();
        IMachineRegistry.SpendPolicy memory newPolicy = IMachineRegistry.SpendPolicy(20e18, 100e18, true);

        vm.prank(operator);
        registry.setPolicy(id, newPolicy);

        IMachineRegistry.SpendPolicy memory p = registry.getPolicy(id);
        assertEq(p.maxStableOutPerSwap, 20e18);
        assertEq(p.dailyStableOutCap, 100e18);
    }

    function test_SetAssetAllowed() public {
        bytes32 id = _registerDefaultMachine();
        address mockAsset = address(0x777);

        assertFalse(registry.isAssetAllowed(id, mockAsset));

        vm.prank(operator);
        registry.setAssetAllowed(id, mockAsset, true);
        assertTrue(registry.isAssetAllowed(id, mockAsset));

        vm.prank(operator);
        registry.setAssetAllowed(id, mockAsset, false);
        assertFalse(registry.isAssetAllowed(id, mockAsset));

        // Revert zero address
        vm.prank(operator);
        vm.expectRevert(IMachineRegistry.ZeroAddress.selector);
        registry.setAssetAllowed(id, address(0), true);
    }

    function test_SetGuardian() public {
        vm.prank(operator);
        registry.setGuardian(guardian);
        assertEq(registry.guardianOf(operator), guardian);
    }

    // --- Freeze / Kill Switch ---

    function test_FreezeAndUnfreezeMachine() public {
        bytes32 id = _registerDefaultMachine();

        vm.prank(operator);
        registry.setGuardian(guardian);

        // Guardian can freeze
        vm.prank(guardian);
        registry.freezeMachine(id);
        assertTrue(registry.isFrozen(id));

        // Guardian CANNOT unfreeze (operator only)
        vm.prank(guardian);
        vm.expectRevert(IMachineRegistry.NotOperator.selector);
        registry.unfreezeMachine(id);

        // Operator unfreezes
        vm.prank(operator);
        registry.unfreezeMachine(id);
        assertFalse(registry.isFrozen(id));

        // Stranger cannot freeze
        vm.prank(stranger);
        vm.expectRevert(IMachineRegistry.NotGuardianOrOperator.selector);
        registry.freezeMachine(id);
    }

    function test_FleetFreeze() public {
        bytes32 id = _registerDefaultMachine();

        vm.prank(operator);
        registry.setGuardian(guardian);

        assertFalse(registry.fleetFrozenOf(operator));
        assertFalse(registry.isFrozen(id));

        // Guardian freezes fleet
        vm.prank(guardian);
        registry.freezeFleet(operator);

        assertTrue(registry.fleetFrozenOf(operator));
        assertTrue(registry.isFrozen(id)); // Machine is implicitly frozen via fleet

        // Stranger cannot freeze operator fleet
        vm.prank(stranger);
        vm.expectRevert(IMachineRegistry.NotGuardianOrOperator.selector);
        registry.freezeFleet(operator);

        // Stranger calling unfreezeFleet does not affect operator fleet
        vm.prank(stranger);
        registry.unfreezeFleet();
        assertTrue(registry.fleetFrozenOf(operator));
        assertTrue(registry.isFrozen(id));

        // Operator unfreezes fleet
        vm.prank(operator);
        registry.unfreezeFleet();

        assertFalse(registry.fleetFrozenOf(operator));
        assertFalse(registry.isFrozen(id));
    }

    // --- Attestation & Violations ---

    function test_SetAttestation() public {
        bytes32 id = _registerDefaultMachine();
        bytes32 newHash = keccak256("new-tpm-quote");

        // Attestor updates
        vm.prank(attestor);
        registry.setAttestation(id, newHash, true);

        IMachineRegistry.Machine memory m = registry.getMachine(id);
        assertEq(m.attestationHash, newHash);
        assertTrue(m.attestationValid);

        // Stranger reverts
        vm.prank(stranger);
        vm.expectRevert(IMachineRegistry.NotAttestor.selector);
        registry.setAttestation(id, newHash, false);
    }

    function test_ReportViolation() public {
        bytes32 id = _registerDefaultMachine();
        bytes32 evidence = keccak256("evidence-payload");

        vm.prank(operator);
        registry.reportViolation(id, evidence);

        IMachineRegistry.Machine memory m = registry.getMachine(id);
        assertEq(m.lastViolationAt, uint64(block.timestamp));

        // Stranger reverts
        vm.prank(stranger);
        vm.expectRevert(IMachineRegistry.NotGuardianOrOperator.selector);
        registry.reportViolation(id, evidence);
    }

    // --- Spend Policy & Spend Consumption ---

    function test_ConsumeSpend_Success() public {
        bytes32 id = _registerDefaultMachine();

        // 30 USDC spend
        vm.prank(hook);
        IMachineRegistry.Tier tier = registry.consumeSpend(id, 30e18);

        assertEq(uint256(tier), uint256(IMachineRegistry.Tier.Bronze));

        uint64 day = uint64(block.timestamp / 1 days);
        assertEq(registry.dailySpent(id, day), 30e18);

        // Another 20 USDC spend on same day (total 50e18, daily limit 200e18)
        vm.prank(hook);
        registry.consumeSpend(id, 20e18);
        assertEq(registry.dailySpent(id, day), 50e18);
    }

    function test_ConsumeSpend_RevertIf_NotHook() public {
        bytes32 id = _registerDefaultMachine();

        vm.prank(stranger);
        vm.expectRevert(IMachineRegistry.NotHook.selector);
        registry.consumeSpend(id, 10e18);
    }

    function test_ConsumeSpend_RevertIf_Frozen() public {
        bytes32 id = _registerDefaultMachine();

        vm.prank(operator);
        registry.freezeMachine(id);

        vm.prank(hook);
        vm.expectRevert(IMachineRegistry.MachineIsFrozen.selector);
        registry.consumeSpend(id, 10e18);
    }

    function test_ConsumeSpend_RevertIf_FleetFrozen() public {
        bytes32 id = _registerDefaultMachine();

        vm.prank(operator);
        registry.freezeFleet();

        vm.prank(hook);
        vm.expectRevert(IMachineRegistry.FleetIsFrozen.selector);
        registry.consumeSpend(id, 10e18);
    }

    function test_ConsumeSpend_RevertIf_PolicyDisabled() public {
        bytes32 id = _registerDefaultMachine();

        vm.prank(operator);
        registry.setPolicy(id, IMachineRegistry.SpendPolicy(50e18, 200e18, false));

        vm.prank(hook);
        vm.expectRevert(IMachineRegistry.PolicyDisabled.selector);
        registry.consumeSpend(id, 10e18);
    }

    function test_ConsumeSpend_RevertIf_PerSwapCapExceeded() public {
        bytes32 id = _registerDefaultMachine(); // cap is 50 USDC

        vm.prank(hook);
        vm.expectRevert(IMachineRegistry.PerSwapCapExceeded.selector);
        registry.consumeSpend(id, 51e18);
    }

    function test_ConsumeSpend_RevertIf_DailyCapExceeded() public {
        bytes32 id = _registerDefaultMachine(); // cap is 200 USDC, per-swap 50 USDC

        // 4 swaps of 50 USDC = 200 USDC
        vm.startPrank(hook);
        registry.consumeSpend(id, 50e18);
        registry.consumeSpend(id, 50e18);
        registry.consumeSpend(id, 50e18);
        registry.consumeSpend(id, 50e18);

        // 5th swap should exceed daily cap
        vm.expectRevert(IMachineRegistry.DailyCapExceeded.selector);
        registry.consumeSpend(id, 1e18);
        vm.stopPrank();
    }

    function test_ConsumeSpend_DayRollover() public {
        bytes32 id = _registerDefaultMachine();

        vm.prank(hook);
        registry.consumeSpend(id, 50e18);

        uint64 day1 = uint64(vm.getBlockTimestamp() / 1 days);
        assertEq(registry.dailySpent(id, day1), 50e18);

        // Warp to the next day (+24 hours)
        vm.warp(vm.getBlockTimestamp() + 1 days);

        uint64 day2 = uint64(vm.getBlockTimestamp() / 1 days);
        assertEq(registry.dailySpent(id, day2), 0);

        // A new day: the quota resets
        vm.prank(hook);
        registry.consumeSpend(id, 50e18);
        assertEq(registry.dailySpent(id, day2), 50e18);
    }

    // --- Dynamic Tier Calculation ---

    function test_TierOf_Transitions() public {
        bytes32 id = _registerDefaultMachine();

        // 1. Initial state -> Bronze
        assertEq(uint256(registry.tierOf(id)), uint256(IMachineRegistry.Tier.Bronze));

        // Make the first transaction activity (machine becomes active)
        vm.prank(hook);
        registry.consumeSpend(id, 10e18);

        // 2. Warp 29 days -> Still Bronze (registration is not yet 30 days old)
        vm.warp(vm.getBlockTimestamp() + 29 days);
        assertEq(uint256(registry.tierOf(id)), uint256(IMachineRegistry.Tier.Bronze));

        // 3. Warp to 30 days -> Silver (age >= 30 days & active in the last 30 days)
        vm.warp(vm.getBlockTimestamp() + 1 days);
        assertEq(uint256(registry.tierOf(id)), uint256(IMachineRegistry.Tier.Silver));

        // 4. Report violation -> Drops back to Bronze immediately
        vm.prank(operator);
        registry.reportViolation(id, keccak256("anomaly"));
        assertEq(uint256(registry.tierOf(id)), uint256(IMachineRegistry.Tier.Bronze));

        // Keep transacting after the violation
        vm.prank(hook);
        registry.consumeSpend(id, 10e18);

        // 5. Warp 30 days after violation -> Recovers to Silver
        vm.warp(vm.getBlockTimestamp() + 30 days);
        assertEq(uint256(registry.tierOf(id)), uint256(IMachineRegistry.Tier.Silver));

        // 6. Test Gold tier conditions:
        // Needs: >= 90 days registered, >= 90 days since violation, attestationValid = true, min stake = true
        // Set attestation valid
        vm.prank(attestor);
        registry.setAttestation(id, sampleAttestation, true);

        // Warp to 90 days since registered & violation
        vm.warp(vm.getBlockTimestamp() + 60 days);

        // Still Silver because operator has no stake
        assertEq(uint256(registry.tierOf(id)), uint256(IMachineRegistry.Tier.Silver));

        // Give operator stake
        mockStake.setHasStake(operator, true);

        // Now achieves Gold
        assertEq(uint256(registry.tierOf(id)), uint256(IMachineRegistry.Tier.Gold));
    }

    /// @notice Dormant machine without valid attestation stays Bronze even after 30+ days.
    function test_TierOf_DormantMachineStaysBronze() public {
        bytes32 id = _registerDefaultMachine();

        // Without any transaction (lastActiveAt == 0)
        // Warp past 35 days
        vm.warp(vm.getBlockTimestamp() + 35 days);

        // Must stay at Bronze tier because it was never active
        assertEq(uint256(registry.tierOf(id)), uint256(IMachineRegistry.Tier.Bronze));
    }

    function test_TierOf_VerifiedAttestationImmediatelyAchievesSilver() public {
        bytes32 id = _registerDefaultMachine();

        // Day 0: no valid attestation -> Bronze
        assertEq(uint256(registry.tierOf(id)), uint256(IMachineRegistry.Tier.Bronze));

        // Day 0: the attester sets a valid attestation -> Silver immediately, without waiting 30 days
        vm.prank(attestor);
        registry.setAttestation(id, sampleAttestation, true);
        assertEq(uint256(registry.tierOf(id)), uint256(IMachineRegistry.Tier.Silver));
    }

    // --- Fuzz Testing ---

    function testFuzz_DailySpendCap(uint64 swapAmount1, uint64 swapAmount2) public {
        // Limit per-swap to 1_000 USDC, daily cap to 2_000 USDC
        uint128 perSwap = 1_000e18;
        uint128 dailyCap = 2_000e18;

        IMachineRegistry.SpendPolicy memory policy = IMachineRegistry.SpendPolicy(perSwap, dailyCap, true);

        uint256 fuzzedPk = 0xF1122;
        address fuzzedAccount = vm.addr(fuzzedPk);
        bytes memory sig = _signRegisterAuth(fuzzedAccount, operator, machineSigner, sampleAttestation, fuzzedPk);

        vm.prank(operator);
        bytes32 id = registry.registerMachineWithAuth(
            fuzzedAccount, machineSigner, sampleAttestation, policy, block.timestamp + 1 hours, sig
        );

        // Bound swaps within [1, 1_000e18]
        uint256 s1 = bound(uint256(swapAmount1), 1e18, perSwap);
        uint256 s2 = bound(uint256(swapAmount2), 1e18, perSwap);

        vm.startPrank(hook);
        registry.consumeSpend(id, s1);

        if (s1 + s2 > dailyCap) {
            vm.expectRevert(IMachineRegistry.DailyCapExceeded.selector);
            registry.consumeSpend(id, s2);
        } else {
            registry.consumeSpend(id, s2);
            uint64 day = uint64(block.timestamp / 1 days);
            assertEq(registry.dailySpent(id, day), s1 + s2);
        }
        vm.stopPrank();
    }

    // --- ERC-8004 Autonomous Agent Standard & peaq DID ---

    function test_ERC8004_RegisterMachineWithAgentAndPeaqDid() public {
        string memory peaqDid = "did:peaq:0x1234567890abcdef1234567890abcdef12345678";
        uint256 agentAccountPk = 0xBEBE01;
        address agentAccount = vm.addr(agentAccountPk);
        uint256 signerKey = 0xA11CE;
        address agentSigner = vm.addr(signerKey);

        IMachineRegistry.SpendPolicy memory policy =
            IMachineRegistry.SpendPolicy({maxStableOutPerSwap: 50e18, dailyStableOutCap: 200e18, enabled: true});

        bytes memory sig = _signRegisterAuth(agentAccount, operator, agentSigner, sampleAttestation, agentAccountPk);

        vm.prank(operator);
        bytes32 id = registry.registerMachineWithAuthAndAgent(
            agentAccount, agentSigner, sampleAttestation, peaqDid, policy, block.timestamp + 1 hours, sig
        );

        (address returnedAccount, address returnedOwner, string memory returnedUri) = registry.getAgent(id);
        assertEq(returnedAccount, agentAccount);
        assertEq(returnedOwner, operator);
        assertEq(returnedUri, peaqDid);

        // Verifikasi signature ERC-8004
        bytes32 digest = keccak256("TASK_AUTH_PROOF_123");
        bytes32 ethSigned = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", digest));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, ethSigned);
        bytes memory sigErc = abi.encodePacked(r, s, v);

        bool isValid = registry.verifyAgentSignature(id, digest, sigErc);
        assertTrue(isValid, "ERC-8004 signature should be valid");

        // If the machine is frozen, verification must return false
        vm.prank(operator);
        registry.freezeMachine(id);
        bool isValidWhenFrozen = registry.verifyAgentSignature(id, digest, sigErc);
        assertFalse(isValidWhenFrozen, "Signature should be rejected when frozen");
    }

    function test_ERC8004_SetAgentUri() public {
        bytes32 id = _registerDefaultMachine();

        string memory initialUri = "did:peaq:initial_device_id";
        vm.prank(operator);
        registry.setAgentUri(id, initialUri);

        (,, string memory uri) = registry.getAgent(id);
        assertEq(uri, initialUri);

        // Non-operator reverts
        vm.prank(stranger);
        vm.expectRevert(IMachineRegistry.NotOperator.selector);
        registry.setAgentUri(id, "did:peaq:attacker");
    }

    function test_RegistrationFee_SuccessAndFeeDistribution() public {
        MockRegistryStable usdcToken = new MockRegistryStable();
        address treasuryAddr = address(0xCAFE);
        address burnVaultAddr = address(0xBEEF);
        uint256 fee = 2 * 1e6; // $2 USDC

        // Paid registration configured by the owner
        vm.prank(owner);
        registry.setRegistrationConfig(address(usdcToken), treasuryAddr, burnVaultAddr, fee);

        assertEq(registry.registrationFee(), fee);

        // Fund the operator and approve
        usdcToken.mint(operator, 100 * 1e6);
        vm.prank(operator);
        usdcToken.approve(address(registry), type(uint256).max);

        // The operator registers the machine with an auth signature
        uint256 newAccPk = 0x9988;
        address newMachineAcc = vm.addr(newAccPk);
        IMachineRegistry.SpendPolicy memory policy =
            IMachineRegistry.SpendPolicy({maxStableOutPerSwap: 50e18, dailyStableOutCap: 200e18, enabled: true});

        bytes memory sig = _signRegisterAuth(newMachineAcc, operator, machineSigner, sampleAttestation, newAccPk);

        uint256 initTreasury = usdcToken.balanceOf(treasuryAddr);
        uint256 initBurn = usdcToken.balanceOf(burnVaultAddr);

        vm.prank(operator);
        bytes32 newId = registry.registerMachineWithAuth(
            newMachineAcc, machineSigner, sampleAttestation, policy, block.timestamp + 1 hours, sig
        );

        assertTrue(newId != bytes32(0));
        assertEq(usdcToken.balanceOf(treasuryAddr) - initTreasury, (fee * 8000) / 10000, "Treasury 80% split mismatch");
        assertEq(usdcToken.balanceOf(burnVaultAddr) - initBurn, (fee * 2000) / 10000, "BurnVault 20% split mismatch");
    }

    function test_SpendPolicy_FailClosedValidation() public {
        bytes32 id = _registerDefaultMachine();

        // 1. setPolicy with dailyStableOutCap == 0 while enabled -> revert
        vm.prank(operator);
        vm.expectRevert(IMachineRegistry.InvalidSpendPolicy.selector);
        registry.setPolicy(id, IMachineRegistry.SpendPolicy(50e18, 0, true));

        // 2. setPolicy with maxStableOutPerSwap > dailyStableOutCap -> revert
        vm.prank(operator);
        vm.expectRevert(IMachineRegistry.InvalidSpendPolicy.selector);
        registry.setPolicy(id, IMachineRegistry.SpendPolicy(200e18, 50e18, true));

        // 3. registerMachineWithAuth with dailyStableOutCap == 0 while enabled -> revert
        uint256 newAccPk = 0x7766;
        address newAcc = vm.addr(newAccPk);
        bytes memory sig = _signRegisterAuth(newAcc, operator, machineSigner, sampleAttestation, newAccPk);

        vm.prank(operator);
        vm.expectRevert(IMachineRegistry.InvalidSpendPolicy.selector);
        registry.registerMachineWithAuth(
            newAcc,
            machineSigner,
            sampleAttestation,
            IMachineRegistry.SpendPolicy(10e18, 0, true),
            block.timestamp + 1 hours,
            sig
        );
    }

    // --- Advanced Hardening Tests ---

    function test_RegisterMachineWithAuth_RevertIf_ExpiredDeadline() public {
        IMachineRegistry.SpendPolicy memory policy = IMachineRegistry.SpendPolicy(50e18, 200e18, true);
        uint256 expiredDeadline = block.timestamp - 1;

        bytes memory sig = _signRegisterAuthWithDeadline(
            machineAccount, operator, machineSigner, sampleAttestation, expiredDeadline, machineAccountPk
        );

        vm.prank(operator);
        vm.expectRevert(IMachineRegistry.ExpiredSignature.selector);
        registry.registerMachineWithAuth(machineAccount, machineSigner, sampleAttestation, policy, expiredDeadline, sig);
    }

    function test_ReportViolation_RevokesAttestationValid() public {
        bytes32 id = _registerDefaultMachine();

        // 1. Attestor marks attestation valid
        vm.prank(attestor);
        registry.setAttestation(id, sampleAttestation, true);
        IMachineRegistry.Machine memory m = registry.getMachine(id);
        assertTrue(m.attestationValid);

        // 2. Violation reported: attestationValid must be revoked immediately
        bytes32 evidence = keccak256("hardware-tampered-evidence");
        vm.prank(operator);
        registry.reportViolation(id, evidence);

        m = registry.getMachine(id);
        assertFalse(m.attestationValid, "Attestation must be revoked upon violation");
        assertGt(m.lastViolationAt, 0);
    }

    function test_TransferMachineOperator_SuccessAndAccessControl() public {
        bytes32 id = _registerDefaultMachine();
        address newOperator = address(0x999);

        // Stranger cannot transfer
        vm.prank(stranger);
        vm.expectRevert(IMachineRegistry.NotOperator.selector);
        registry.transferMachineOperator(id, newOperator);

        // Operator transfers successfully
        vm.prank(operator);
        registry.transferMachineOperator(id, newOperator);

        IMachineRegistry.Machine memory m = registry.getMachine(id);
        assertEq(m.operator, newOperator);

        // Deregister machine by new operator
        vm.prank(newOperator);
        registry.deregisterMachine(id);

        assertEq(registry.machineIdOf(machineAccount), bytes32(0));
        vm.expectRevert(IMachineRegistry.MachineNotFound.selector);
        registry.getMachine(id);
    }
}
