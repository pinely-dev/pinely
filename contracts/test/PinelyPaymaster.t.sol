// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {PinelyPaymaster} from "../src/PinelyPaymaster.sol";
import {MachineRegistry} from "../src/MachineRegistry.sol";
import {IMachineRegistry} from "../src/interfaces/IMachineRegistry.sol";
import {IPaymaster, PostOpMode} from "../src/interfaces/erc4337/IPaymaster.sol";
import {IEntryPoint} from "../src/interfaces/erc4337/IEntryPoint.sol";
import {PackedUserOperation} from "../src/interfaces/erc4337/PackedUserOperation.sol";
import {IPriceFeed} from "../src/interfaces/IPriceFeed.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockStablecoin is ERC20 {
    constructor() ERC20("Stablecoin Mock", "mSTABLE") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockEntryPointForPaymaster is IEntryPoint {
    mapping(address => uint256) public deposits;
    mapping(address => uint256) public stakes;
    mapping(address => uint32) public unstakeDelays;

    function depositTo(address account) external payable override {
        deposits[account] += msg.value;
    }

    function withdrawTo(address payable withdrawAddress, uint256 amount) external override {
        require(deposits[msg.sender] >= amount, "Insufficient deposit");
        deposits[msg.sender] -= amount;
        (bool ok,) = withdrawAddress.call{value: amount}("");
        require(ok, "Transfer failed");
    }

    function addStake(uint32 unstakeDelaySec) external payable override {
        stakes[msg.sender] += msg.value;
        unstakeDelays[msg.sender] = unstakeDelaySec;
    }

    function unlockStake() external override {}

    function withdrawStake(address payable withdrawAddress) external override {
        uint256 amount = stakes[msg.sender];
        stakes[msg.sender] = 0;
        (bool ok,) = withdrawAddress.call{value: amount}("");
        require(ok, "Transfer failed");
    }

    function getDepositInfo(address) external pure override returns (uint112, bool, uint112, uint32, uint48) {
        return (0, false, 0, 0, 0);
    }

    function balanceOf(address account) external view override returns (uint256) {
        return deposits[account];
    }

    function handleOps(PackedUserOperation[] calldata, address payable) external pure override {}

    function getUserOpHash(PackedUserOperation calldata) external pure override returns (bytes32) {
        return bytes32(0);
    }

    receive() external payable {}
}

contract MockPriceFeed is IPriceFeed {
    int256 public price = 3000e8; // $3000
    uint256 public updatedAt;
    uint8 public feedDecimals = 8;

    constructor() {
        updatedAt = block.timestamp;
    }

    function setPrice(int256 newPrice) external {
        price = newPrice;
        updatedAt = block.timestamp;
    }

    function setUpdatedAt(uint256 newUpdatedAt) external {
        updatedAt = newUpdatedAt;
    }

    function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
        return (1, price, block.timestamp, updatedAt, 1);
    }

    function decimals() external view override returns (uint8) {
        return feedDecimals;
    }
}

contract PinelyPaymasterTest is Test {
    PinelyPaymaster public paymaster;
    MachineRegistry public registry;
    MockStablecoin public usdc;
    MockEntryPointForPaymaster public entryPoint;
    MockPriceFeed public priceFeed;

    address public owner = address(0xAA1);
    address public treasury = address(0xAA2);
    address public operator = address(0xBB1);
    uint256 public machineAccountPk = 0xACC1;
    address public machineAccount;
    address public machineSigner = address(0xCC2);
    address public stranger = address(0xFF1);

    bytes32 public machineId;

    function _signRegisterAuth(address acc, address op, address sig, bytes32 attestation, uint256 accPk)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                registry.REGISTER_AUTHORIZATION_TYPEHASH(),
                acc,
                op,
                sig,
                attestation,
                registry.accountNonces(acc),
                block.timestamp + 1 hours,
                block.chainid
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", registry.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(accPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function setUp() public {
        vm.warp(1_700_000_000);

        machineAccount = vm.addr(machineAccountPk);

        usdc = new MockStablecoin();
        entryPoint = new MockEntryPointForPaymaster();
        priceFeed = new MockPriceFeed();

        vm.prank(owner);
        registry = new MachineRegistry(owner);

        vm.prank(owner);
        paymaster = new PinelyPaymaster(address(entryPoint), address(registry), address(usdc), treasury, owner);

        // The paymaster has no default rate and is fail-closed until the owner publishes one.
        vm.startPrank(owner);
        paymaster.setPriceBounds(1e8, 10_000e8);
        paymaster.setNativePrice(3000e8);
        vm.stopPrank();

        // Register default machine
        IMachineRegistry.SpendPolicy memory policy =
            IMachineRegistry.SpendPolicy({maxStableOutPerSwap: 50e18, dailyStableOutCap: 200e18, enabled: true});

        bytes memory sig = _signRegisterAuth(
            machineAccount, operator, machineSigner, keccak256("hardware-attestation"), machineAccountPk
        );
        vm.prank(operator);
        machineId = registry.registerMachineWithAuth(
            machineAccount, machineSigner, keccak256("hardware-attestation"), policy, block.timestamp + 1 hours, sig
        );

        // Mint USDC to operator & stranger
        usdc.mint(operator, 1_000_000e6); // 1,000,000 USDC
        usdc.mint(stranger, 100e6);
    }

    function _createSampleUserOp(address sender) internal pure returns (PackedUserOperation memory) {
        return PackedUserOperation({
            sender: sender,
            nonce: 0,
            initCode: "",
            callData: "",
            accountGasLimits: bytes32(0),
            preVerificationGas: 0,
            gasFees: bytes32(0),
            paymasterAndData: "",
            signature: ""
        });
    }

    // --- Constructor & Admin ---

    function test_Constructor_ZeroAddressReverts() public {
        vm.expectRevert(PinelyPaymaster.ZeroAddress.selector);
        new PinelyPaymaster(address(0), address(registry), address(usdc), treasury, owner);

        vm.expectRevert(PinelyPaymaster.ZeroAddress.selector);
        new PinelyPaymaster(address(entryPoint), address(0), address(usdc), treasury, owner);

        vm.expectRevert(PinelyPaymaster.ZeroAddress.selector);
        new PinelyPaymaster(address(entryPoint), address(registry), address(0), treasury, owner);

        vm.expectRevert(PinelyPaymaster.ZeroAddress.selector);
        new PinelyPaymaster(address(entryPoint), address(registry), address(usdc), address(0), owner);

        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableInvalidOwner(address)")), address(0)));
        new PinelyPaymaster(address(entryPoint), address(registry), address(usdc), treasury, address(0));
    }

    function test_Constructor_InvalidTokenReverts() public {
        // Address without bytecode reverts InvalidToken (IMM-02)
        address emptyTokenAddress = address(0x1234567890123456789012345678901234567890);
        vm.expectRevert(PinelyPaymaster.InvalidToken.selector);
        new PinelyPaymaster(address(entryPoint), address(registry), emptyTokenAddress, treasury, owner);
    }

    function test_Admin_Setters() public {
        vm.startPrank(owner);
        paymaster.setPriceFeed(address(priceFeed));
        assertEq(address(paymaster.priceFeed()), address(priceFeed));

        paymaster.setNativePrice(3500e8);
        assertEq(paymaster.fixedNativePrice(), 3500e8);

        address newTreasury = address(0x999);
        paymaster.setTreasury(newTreasury);
        assertEq(paymaster.treasury(), newTreasury);

        paymaster.setMaxCostStablecoinPerUserOp(1e6); // 1 USDC
        assertEq(paymaster.maxCostStablecoinPerUserOp(), 1e6);

        paymaster.setMaxPriceStaleness(7200);
        assertEq(paymaster.maxPriceStaleness(), 7200);
        vm.stopPrank();

        // Non-owner reverts
        vm.prank(stranger);
        vm.expectRevert();
        paymaster.setTreasury(address(0x123));
    }

    // --- Credit Deposit & Withdrawal ---

    function test_DepositCredit_Success() public {
        vm.startPrank(operator);
        usdc.approve(address(paymaster), 100e6);
        paymaster.depositCredit(machineAccount, 100e6);
        vm.stopPrank();

        assertEq(paymaster.creditOf(machineAccount), 100e6);
        assertEq(usdc.balanceOf(address(paymaster)), 100e6);
    }

    function test_WithdrawCredit_ByOperator_Success() public {
        // Deposit 100 USDC
        vm.startPrank(operator);
        usdc.approve(address(paymaster), 100e6);
        paymaster.depositCredit(machineAccount, 100e6);

        // Direct withdrawCredit by operator reverts with TimelockRequired
        address recipient = address(0x888);
        vm.expectRevert(PinelyPaymaster.TimelockRequired.selector);
        paymaster.withdrawCredit(machineAccount, 40e6, recipient);

        // Operator requests withdrawal with 15-minute cooldown
        paymaster.requestWithdrawCredit(machineAccount, 40e6);
        assertEq(paymaster.creditOf(machineAccount), 60e6);

        // Cannot execute before cooldown
        vm.expectRevert(PinelyPaymaster.WithdrawalCooldownActive.selector);
        paymaster.executeWithdrawCredit(machineAccount, recipient);

        // Warp past cooldown
        vm.warp(block.timestamp + paymaster.WITHDRAWAL_COOLDOWN() + 1);
        paymaster.executeWithdrawCredit(machineAccount, recipient);
        vm.stopPrank();

        assertEq(paymaster.creditOf(machineAccount), 60e6);
        assertEq(usdc.balanceOf(recipient), 40e6);
    }

    function test_WithdrawCredit_RevertIf_OwnerInstantWithdraw() public {
        vm.startPrank(operator);
        usdc.approve(address(paymaster), 50e6);
        paymaster.depositCredit(machineAccount, 50e6);
        vm.stopPrank();

        // Owner cannot bypass timelock to instantly withdraw user prepaid credit
        vm.prank(owner);
        vm.expectRevert(PinelyPaymaster.TimelockRequired.selector);
        paymaster.withdrawCredit(machineAccount, 50e6, owner);

        assertEq(paymaster.creditOf(machineAccount), 50e6);
    }

    function test_WithdrawCredit_RevertIf_NotAuthorized() public {
        vm.startPrank(operator);
        usdc.approve(address(paymaster), 50e6);
        paymaster.depositCredit(machineAccount, 50e6);
        vm.stopPrank();

        vm.prank(stranger);
        vm.expectRevert(PinelyPaymaster.NotAuthorized.selector);
        paymaster.requestWithdrawCredit(machineAccount, 50e6);
    }

    function test_WithdrawCredit_RevertIf_InsufficientCredit() public {
        vm.startPrank(operator);
        usdc.approve(address(paymaster), 10e6);
        paymaster.depositCredit(machineAccount, 10e6);

        vm.expectRevert(PinelyPaymaster.InsufficientCredit.selector);
        paymaster.requestWithdrawCredit(machineAccount, 11e6);
        vm.stopPrank();

        vm.prank(owner);
        vm.expectRevert(PinelyPaymaster.TimelockRequired.selector);
        paymaster.withdrawCredit(machineAccount, 11e6, owner);
    }

    function test_WithdrawCredit_RevertIf_UnregisteredAccount() public {
        address unreg = address(0x777);

        vm.prank(operator);
        vm.expectRevert(PinelyPaymaster.TimelockRequired.selector);
        paymaster.withdrawCredit(unreg, 10e6, operator);
    }

    // --- EntryPoint Gas & Staking Management (ERC-7562) ---

    function test_EntryPointStaking_Success() public {
        vm.deal(owner, 10 ether);

        vm.startPrank(owner);
        paymaster.addStake{value: 2 ether}(86400);
        assertEq(entryPoint.stakes(address(paymaster)), 2 ether);
        assertEq(entryPoint.unstakeDelays(address(paymaster)), 86400);

        paymaster.unlockStake();

        address payable recipient = payable(address(0x999));
        paymaster.withdrawStake(recipient);
        assertEq(entryPoint.stakes(address(paymaster)), 0);
        assertEq(recipient.balance, 2 ether);
        vm.stopPrank();
    }

    function test_DepositAndWithdrawGasEntryPoint() public {
        vm.deal(owner, 10 ether);

        vm.prank(owner);
        paymaster.depositGasToEntryPoint{value: 5 ether}();

        assertEq(entryPoint.balanceOf(address(paymaster)), 5 ether);

        address payable recipient = payable(address(0x555));
        vm.prank(owner);
        paymaster.withdrawGasFromEntryPoint(recipient, 2 ether);

        assertEq(entryPoint.balanceOf(address(paymaster)), 3 ether);
        assertEq(recipient.balance, 2 ether);
    }

    // --- validatePaymasterUserOp ---

    function test_ValidatePaymasterUserOp_Success() public {
        // Deposit 10 USDC
        vm.startPrank(operator);
        usdc.approve(address(paymaster), 10e6);
        paymaster.depositCredit(machineAccount, 10e6);
        vm.stopPrank();

        PackedUserOperation memory userOp = _createSampleUserOp(machineAccount);

        // Max cost: 0.0001 ETH ($0.30 at $3000/ETH, well under $0.50 cap)
        uint256 maxCostWei = 1e14; // 0.0001 ETH

        vm.prank(address(entryPoint));
        (bytes memory context, uint256 validationData) =
            paymaster.validatePaymasterUserOp(userOp, bytes32(0), maxCostWei);

        uint48 unpackedValidUntil = uint48(validationData >> 160);
        uint160 sigFailed = uint160(validationData);
        assertEq(sigFailed, 0);
        assertEq(unpackedValidUntil, uint48(block.timestamp + 300));
        (address decodedAccount, uint256 estimatedUsdc) = abi.decode(context, (address, uint256));
        assertEq(decodedAccount, machineAccount);
        assertEq(estimatedUsdc, 300000); // $0.30 in 6 decimals
    }

    function _fundCredit() internal {
        vm.startPrank(operator);
        usdc.approve(address(paymaster), 10e6);
        paymaster.depositCredit(machineAccount, 10e6);
        vm.stopPrank();
    }

    function test_FixedRate_ExpiresViaValidUntilNotRevert() public {
        _fundCredit();
        PackedUserOperation memory userOp = _createSampleUserOp(machineAccount);

        // Let the owner-set rate age past maxPriceStaleness but keep it inside the 300s default window check.
        uint256 stalenessWindow = paymaster.maxPriceStaleness();
        uint256 publishedAt = paymaster.lastPriceUpdate();
        vm.warp(publishedAt + stalenessWindow - 100);

        vm.prank(address(entryPoint));
        (, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1e14);

        // ERC-7562 OP-011: expiry is reported through validUntil, validation itself must not revert on time.
        assertEq(uint48(validationData >> 160), uint48(publishedAt + stalenessWindow));
    }

    function test_FixedRate_RevertIf_RateNeverPublished() public {
        PinelyPaymaster fresh =
            new PinelyPaymaster(address(entryPoint), address(registry), address(usdc), treasury, owner);
        assertEq(fresh.fixedNativePrice(), 0);

        vm.prank(operator);
        usdc.approve(address(fresh), 10e6);
        vm.prank(operator);
        fresh.depositCredit(machineAccount, 10e6);

        PackedUserOperation memory userOp = _createSampleUserOp(machineAccount);
        vm.prank(address(entryPoint));
        vm.expectRevert(PinelyPaymaster.InvalidPrice.selector);
        fresh.validatePaymasterUserOp(userOp, bytes32(0), 1e14);
    }

    function test_SetPriceBounds_RevertIf_Invalid() public {
        vm.startPrank(owner);
        vm.expectRevert(PinelyPaymaster.InvalidPriceBounds.selector);
        paymaster.setPriceBounds(0, 100e8);
        vm.expectRevert(PinelyPaymaster.InvalidPriceBounds.selector);
        paymaster.setPriceBounds(100e8, 100e8);
        vm.stopPrank();

        vm.prank(stranger);
        vm.expectRevert();
        paymaster.setPriceBounds(1e8, 100e8);
    }

    function test_SetNativePrice_RejectsOutOfBounds() public {
        vm.startPrank(owner);
        vm.expectRevert(PinelyPaymaster.InvalidPriceBounds.selector);
        paymaster.setNativePrice(0.5e8);
        vm.expectRevert(PinelyPaymaster.InvalidPriceBounds.selector);
        paymaster.setNativePrice(10_001e8);
        vm.stopPrank();
    }

    function test_ValidatePaymasterUserOp_RevertIf_NotEntryPoint() public {
        PackedUserOperation memory userOp = _createSampleUserOp(machineAccount);

        vm.prank(stranger);
        vm.expectRevert(PinelyPaymaster.NotEntryPoint.selector);
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1e14);
    }

    function test_ValidatePaymasterUserOp_RevertIf_MachineNotRegistered() public {
        PackedUserOperation memory userOp = _createSampleUserOp(stranger);

        vm.prank(address(entryPoint));
        vm.expectRevert(PinelyPaymaster.MachineNotRegistered.selector);
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1e14);
    }

    function test_ValidatePaymasterUserOp_RevertIf_MachineFrozen() public {
        vm.prank(operator);
        registry.freezeMachine(machineId);

        PackedUserOperation memory userOp = _createSampleUserOp(machineAccount);

        vm.prank(address(entryPoint));
        vm.expectRevert(PinelyPaymaster.MachineFrozen.selector);
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1e14);
    }

    function test_ValidatePaymasterUserOp_RevertIf_InsufficientCredit() public {
        PackedUserOperation memory userOp = _createSampleUserOp(machineAccount);

        // No credit deposited
        vm.prank(address(entryPoint));
        vm.expectRevert(PinelyPaymaster.InsufficientCredit.selector);
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1e14);
    }

    function test_ValidatePaymasterUserOp_RevertIf_ExceedsCap() public {
        // Deposit credit
        vm.startPrank(operator);
        usdc.approve(address(paymaster), 100e6);
        paymaster.depositCredit(machineAccount, 100e6);
        vm.stopPrank();

        PackedUserOperation memory userOp = _createSampleUserOp(machineAccount);

        // 0.001 ETH ($3.00, exceeds $0.50 cap)
        uint256 highCostWei = 1e15;

        vm.prank(address(entryPoint));
        vm.expectRevert(PinelyPaymaster.UserOpCostExceedsCap.selector);
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), highCostWei);
    }

    // --- settlement prefund against the cost cap ---

    // The settlement UserOperation pins 450,000 gas of limits (150,000 verification, 100,000 call, 100,000 paymaster
    // verification, 50,000 post-op and 50,000 pre-verification). The prefund the EntryPoint asks the paymaster to
    // cover is that gas times maxFeePerGas.
    uint256 internal constant SETTLEMENT_GAS = 450_000;

    function test_SettlementPrefund_AtTwoGwei_ExceedsTheDefaultCap_AtAnEthSizedPrice() public {
        // The value the SDK used before: 450,000 gas x 2 gwei = 0.0009 ETH, which is $2.70 at $3,000 per ETH.
        vm.startPrank(operator);
        usdc.approve(address(paymaster), 100e6);
        paymaster.depositCredit(machineAccount, 100e6);
        vm.stopPrank();

        PackedUserOperation memory userOp = _createSampleUserOp(machineAccount);
        vm.prank(address(entryPoint));
        vm.expectRevert(PinelyPaymaster.UserOpCostExceedsCap.selector);
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), SETTLEMENT_GAS * 2 gwei);
    }

    function test_SettlementPrefund_AtTheCurrentCeiling_FitsUnderTheDefaultCap() public {
        // The ceiling now pinned in the SDKs: 450,000 gas x 0.1 gwei = 0.000045 ETH, which is $0.135 at $3,000.
        vm.startPrank(operator);
        usdc.approve(address(paymaster), 100e6);
        paymaster.depositCredit(machineAccount, 100e6);
        vm.stopPrank();

        PackedUserOperation memory userOp = _createSampleUserOp(machineAccount);
        vm.prank(address(entryPoint));
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), SETTLEMENT_GAS * 0.1 gwei);

        (, uint256 escrowed) = abi.decode(context, (address, uint256));
        assertEq(escrowed, 135_000);
        assertLt(escrowed, paymaster.maxCostStablecoinPerUserOp());
    }

    // --- postOp ---

    function test_PostOp_Success() public {
        // Deposit 10 USDC
        vm.startPrank(operator);
        usdc.approve(address(paymaster), 10e6);
        paymaster.depositCredit(machineAccount, 10e6);
        vm.stopPrank();

        PackedUserOperation memory userOp = _createSampleUserOp(machineAccount);
        uint256 maxCostWei = 1e14; // 0.0001 ETH ($0.30)

        vm.prank(address(entryPoint));
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), maxCostWei);

        // Actual gas cost: 0.00005 ETH ($0.15)
        uint256 actualGasCostWei = 5e13;

        vm.prank(address(entryPoint));
        paymaster.postOp(PostOpMode.opSucceeded, context, actualGasCostWei, 1 gwei);

        // 10 USDC - $0.15 = 9.85 USDC
        assertEq(paymaster.creditOf(machineAccount), 9_850_000);
        assertEq(paymaster.totalCollectedStablecoin(), 150_000);
    }

    function test_PostOp_RevertIf_NotEntryPoint() public {
        bytes memory context = abi.encode(machineAccount, 1000);

        vm.prank(stranger);
        vm.expectRevert(PinelyPaymaster.NotEntryPoint.selector);
        paymaster.postOp(PostOpMode.opSucceeded, context, 1000, 1 gwei);
    }

    // --- Oracle Price Feed & Staleness ---

    function test_PriceFeed_Integration() public {
        vm.prank(owner);
        paymaster.setPriceFeed(address(priceFeed));

        // Deposit USDC
        vm.startPrank(operator);
        usdc.approve(address(paymaster), 10e6);
        paymaster.depositCredit(machineAccount, 10e6);
        vm.stopPrank();

        PackedUserOperation memory userOp = _createSampleUserOp(machineAccount);

        // 0.0001 ETH at $3000 = $0.30
        vm.prank(address(entryPoint));
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1e14);
        (, uint256 estimatedUsdc) = abi.decode(context, (address, uint256));
        assertEq(estimatedUsdc, 300000);

        // Update oracle to $4000
        priceFeed.setPrice(4000e8);

        vm.prank(address(entryPoint));
        (context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1e14);
        (, estimatedUsdc) = abi.decode(context, (address, uint256));
        assertEq(estimatedUsdc, 400000); // $0.40
    }

    function test_PriceFeed_StalePricePacksExpiredValidUntil_ERC7562() public {
        vm.prank(owner);
        paymaster.setPriceFeed(address(priceFeed));

        // Set oracle updatedAt 2 hours in the past (> 1 hour maxPriceStaleness)
        priceFeed.setUpdatedAt(vm.getBlockTimestamp() - 7200);

        // Deposit USDC
        vm.startPrank(operator);
        usdc.approve(address(paymaster), 10e6);
        paymaster.depositCredit(machineAccount, 10e6);
        vm.stopPrank();

        PackedUserOperation memory userOp = _createSampleUserOp(machineAccount);

        vm.prank(address(entryPoint));
        (, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1e14);

        // ERC-7562 rule [OP-011]
        // validUntil is packed accurately into the past (updatedAt + 3600 < block.timestamp),
        // so the EntryPoint/Bundler rejects the UserOp without branching on the TIMESTAMP opcode
        uint48 validUntil = uint48(validationData >> 160);
        assertTrue(validUntil < block.timestamp, "validUntil must be expired in the past");
        assertEq(validUntil, uint48(vm.getBlockTimestamp() - 7200 + 3600));
    }

    function test_PriceFeed_NegativePriceReverts() public {
        vm.prank(owner);
        paymaster.setPriceFeed(address(priceFeed));

        priceFeed.setPrice(0);

        // Deposit USDC
        vm.startPrank(operator);
        usdc.approve(address(paymaster), 10e6);
        paymaster.depositCredit(machineAccount, 10e6);
        vm.stopPrank();

        PackedUserOperation memory userOp = _createSampleUserOp(machineAccount);

        vm.prank(address(entryPoint));
        vm.expectRevert(PinelyPaymaster.InvalidPrice.selector);
        paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1e14);
    }

    // --- Treasury Withdrawal ---

    function test_WithdrawStableToTreasury() public {
        // Deposit credit & execute postOp to accumulate collected USDC
        vm.startPrank(operator);
        usdc.approve(address(paymaster), 10e6);
        paymaster.depositCredit(machineAccount, 10e6);
        vm.stopPrank();

        PackedUserOperation memory userOp = _createSampleUserOp(machineAccount);
        vm.prank(address(entryPoint));
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1e14);

        vm.prank(address(entryPoint));
        paymaster.postOp(PostOpMode.opSucceeded, context, 5e13, 1 gwei);

        uint256 collected = paymaster.totalCollectedStablecoin();
        assertEq(collected, 150_000);

        vm.prank(owner);
        paymaster.withdrawStablecoinToTreasury(collected);

        assertEq(paymaster.totalCollectedStablecoin(), 0);
        assertEq(usdc.balanceOf(treasury), collected);

        // Withdrawing more than collected reverts
        vm.prank(owner);
        vm.expectRevert(PinelyPaymaster.AmountExceedsCollected.selector);
        paymaster.withdrawStablecoinToTreasury(1);
    }

    // --- Advanced Hardening Tests ---

    function test_ValidatePaymasterUserOp_EscrowsCreditUpfront() public {
        vm.startPrank(operator);
        usdc.approve(address(paymaster), 1e6);
        paymaster.depositCredit(machineAccount, 1e6); // 1.00 USDC
        vm.stopPrank();

        PackedUserOperation memory userOp = _createSampleUserOp(machineAccount);
        uint256 maxCostWei = 1e14; // $0.30 USDC at $3000/ETH

        vm.prank(address(entryPoint));
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), maxCostWei);

        // Credit should be debited immediately by estimated cost 300_000 ($0.30 USDC)
        assertEq(paymaster.creditOf(machineAccount), 700_000);
        (address acct, uint256 escrowed) = abi.decode(context, (address, uint256));
        assertEq(acct, machineAccount);
        assertEq(escrowed, 300_000);
    }

    function test_ValidatePaymasterUserOp_ParallelDoubleSpendPrevented() public {
        vm.startPrank(operator);
        usdc.approve(address(paymaster), 400_000);
        paymaster.depositCredit(machineAccount, 400_000); // 0.40 USDC
        vm.stopPrank();

        PackedUserOperation memory userOp1 = _createSampleUserOp(machineAccount);
        PackedUserOperation memory userOp2 = _createSampleUserOp(machineAccount);
        uint256 maxCostWei = 1e14; // requires 300_000 ($0.30 USDC)

        // Op 1 validates: passes and escrows 300_000, leaving 100_000
        vm.prank(address(entryPoint));
        paymaster.validatePaymasterUserOp(userOp1, bytes32(0), maxCostWei);
        assertEq(paymaster.creditOf(machineAccount), 100_000);

        // Op 2 validates in same block/bundle: fails because 100_000 < 300_000
        vm.prank(address(entryPoint));
        vm.expectRevert(PinelyPaymaster.InsufficientCredit.selector);
        paymaster.validatePaymasterUserOp(userOp2, bytes32(0), maxCostWei);
    }

    function test_PostOp_RefundsExcessEscrow() public {
        vm.startPrank(operator);
        usdc.approve(address(paymaster), 1e6);
        paymaster.depositCredit(machineAccount, 1e6); // 1.00 USDC
        vm.stopPrank();

        PackedUserOperation memory userOp = _createSampleUserOp(machineAccount);
        uint256 maxCostWei = 1e14; // $0.30 USDC (300_000)

        vm.prank(address(entryPoint));
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), maxCostWei);
        assertEq(paymaster.creditOf(machineAccount), 700_000);

        // Actual gas used is only 5e13 wei ($0.15 USDC = 150_000)
        vm.prank(address(entryPoint));
        paymaster.postOp(PostOpMode.opSucceeded, context, 5e13, 1 gwei);

        // Account receives refund of 150_000, so balance becomes 700_000 + 150_000 = 850_000 ($0.85 USDC)
        assertEq(paymaster.creditOf(machineAccount), 850_000);
        assertEq(paymaster.totalCollectedStablecoin(), 150_000);
    }

    function test_WeiToStable_CeilingDivisionAndMinimumCharge() public {
        vm.startPrank(operator);
        usdc.approve(address(paymaster), 1e6);
        paymaster.depositCredit(machineAccount, 1e6);
        vm.stopPrank();

        PackedUserOperation memory userOp = _createSampleUserOp(machineAccount);

        // Very tiny gas: 1000 wei. Under floor division (1000 * 3000 * 1e8) / 1e20 = 0
        // But under ceiling division & min charge it must be >= 1
        vm.prank(address(entryPoint));
        (bytes memory context,) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), 1000);

        (, uint256 escrowed) = abi.decode(context, (address, uint256));
        assertGe(escrowed, 1);
    }
}
