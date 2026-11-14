// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {FleetSubscription} from "../src/FleetSubscription.sol";
import {IFleetSubscription} from "../src/interfaces/IFleetSubscription.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockStablecoin6 is ERC20 {
    constructor() ERC20("USDC Mock", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockStablecoin18 is ERC20 {
    constructor() ERC20("USDC 18", "USDC18") {}

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract FleetSubscriptionTest is Test {
    MockStablecoin6 public usdc6;
    MockStablecoin18 public usdc18;
    FleetSubscription public subscription;
    FleetSubscription public subscription18;

    address public burnVault = address(0xBEEF);
    address public treasury = address(0xCAFE);
    address public operator = address(0xABCD);

    bytes32 public constant SALT_A = keccak256("FLEET_DELIVERY_ROBOTS");
    // The id of the fleet that `operator` names SALT_A (set in setUp).
    bytes32 public fleetA;

    function setUp() public {
        usdc6 = new MockStablecoin6();
        usdc18 = new MockStablecoin18();

        subscription = new FleetSubscription(address(usdc6), burnVault, treasury);
        subscription18 = new FleetSubscription(address(usdc18), burnVault, treasury);
        fleetA = subscription.fleetIdOf(operator, SALT_A);

        usdc6.mint(operator, 1_000_000 * 1e6);
        usdc18.mint(operator, 1_000_000 * 1e18);

        vm.startPrank(operator);
        usdc6.approve(address(subscription), type(uint256).max);
        usdc18.approve(address(subscription18), type(uint256).max);
        vm.stopPrank();
    }

    function test_ConstructorRevertsOnZeroAddress() public {
        vm.expectRevert(IFleetSubscription.ZeroAddress.selector);
        new FleetSubscription(address(0), burnVault, treasury);

        vm.expectRevert(IFleetSubscription.ZeroAddress.selector);
        new FleetSubscription(address(usdc6), address(0), treasury);

        vm.expectRevert(IFleetSubscription.ZeroAddress.selector);
        new FleetSubscription(address(usdc6), burnVault, address(0));
    }

    function test_SubscribeFleetPro_SuccessAndFeeDistribution() public {
        uint256 initialBurnBal = usdc6.balanceOf(burnVault);
        uint256 initialTreasuryBal = usdc6.balanceOf(treasury);

        vm.prank(operator);
        subscription.subscribeFleetPro(SALT_A, 1);

        uint256 cost = 99 * 1e6;
        uint256 expectedBurn = (cost * 2000) / 10000; // 20%
        uint256 expectedTreasury = cost - expectedBurn; // 80%

        assertEq(usdc6.balanceOf(burnVault) - initialBurnBal, expectedBurn, "Burn split mismatch");
        assertEq(usdc6.balanceOf(treasury) - initialTreasuryBal, expectedTreasury, "Treasury split mismatch");
        assertTrue(subscription.isFleetProActive(fleetA), "Fleet Pro should be active");

        IFleetSubscription.FleetSubscriptionInfo memory info = subscription.getFleetProSubscription(fleetA);
        assertEq(info.validUntil, block.timestamp + 30 days, "Expiry should be +30 days");
        assertEq(info.totalPaidStable, cost, "Total paid mismatch");
    }

    function test_SubscribeFleetPro_CumulativeExtension() public {
        vm.prank(operator);
        subscription.subscribeFleetPro(SALT_A, 2); // 60 days

        uint256 firstExpiry = block.timestamp + 60 days;
        assertEq(subscription.getFleetProSubscription(fleetA).validUntil, firstExpiry);

        // Fast forward 10 days
        vm.warp(block.timestamp + 10 days);
        assertTrue(subscription.isFleetProActive(fleetA));

        // Extend 1 more month
        vm.prank(operator);
        subscription.subscribeFleetPro(SALT_A, 1);

        assertEq(subscription.getFleetProSubscription(fleetA).validUntil, firstExpiry + 30 days);
    }

    function test_SubscribeFleetPro_ExpiredRenewal() public {
        vm.prank(operator);
        subscription.subscribeFleetPro(SALT_A, 1); // 30 days

        // Fast forward past expiration (35 days)
        vm.warp(block.timestamp + 35 days);
        assertFalse(subscription.isFleetProActive(fleetA));

        // Renew for 1 month
        vm.prank(operator);
        subscription.subscribeFleetPro(SALT_A, 1);

        assertTrue(subscription.isFleetProActive(fleetA));
        assertEq(subscription.getFleetProSubscription(fleetA).validUntil, block.timestamp + 30 days);
    }

    function test_SubscribeDevices_SuccessAndCovered() public {
        uint256 initialBurnBal = usdc6.balanceOf(burnVault);
        uint256 initialTreasuryBal = usdc6.balanceOf(treasury);

        uint256 devices = 50;
        uint256 months = 3;
        uint256 cost = devices * months * 1 * 1e6; // $150

        vm.prank(operator);
        subscription.subscribeDevices(SALT_A, devices, months);

        uint256 expectedBurn = (cost * 2000) / 10000;
        uint256 expectedTreasury = cost - expectedBurn;

        assertEq(usdc6.balanceOf(burnVault) - initialBurnBal, expectedBurn);
        assertEq(usdc6.balanceOf(treasury) - initialTreasuryBal, expectedTreasury);
        assertTrue(subscription.isDeviceCovered(fleetA));

        IFleetSubscription.FleetSubscriptionInfo memory info = subscription.getSdkSubscription(fleetA);
        assertEq(info.activeDevices, 50);
        assertEq(info.validUntil, block.timestamp + 90 days);
        assertEq(info.totalPaidStable, cost);
    }

    function test_DecimalScale18Support() public {
        vm.prank(operator);
        subscription18.subscribeFleetPro(SALT_A, 1);

        uint256 cost18 = 99 * 1e18;
        uint256 expectedBurn = (cost18 * 2000) / 10000;

        assertEq(usdc18.balanceOf(burnVault), expectedBurn);
        assertTrue(subscription18.isFleetProActive(fleetA));
    }

    function test_Subscribe_RevertsOnInvalidInputs() public {
        vm.startPrank(operator);

        // Zero months
        vm.expectRevert(IFleetSubscription.InvalidAmount.selector);
        subscription.subscribeFleetPro(SALT_A, 0);

        // Zero devices
        vm.expectRevert(IFleetSubscription.InvalidAmount.selector);
        subscription.subscribeDevices(SALT_A, 0, 1);

        // Zero months devices
        vm.expectRevert(IFleetSubscription.InvalidAmount.selector);
        subscription.subscribeDevices(SALT_A, 10, 0);

        vm.stopPrank();
    }

    function test_FleetId_IsDerivedFromTheOwnerAndTheSalt() public view {
        assertEq(fleetA, keccak256(abi.encode(operator, SALT_A)));
        // The same name under another owner is a different fleet.
        assertTrue(subscription.fleetIdOf(address(0xDEAD), SALT_A) != fleetA);
        // And another name under the same owner is a different fleet too.
        assertTrue(subscription.fleetIdOf(operator, keccak256("OTHER")) != fleetA);
    }

    /// @notice F-01: a free-form fleet id could be claimed for the price of one device-month. Not any more.
    function test_FleetId_CannotBeSquatted() public {
        address attacker = address(0xDEAD);
        usdc6.mint(attacker, 100 * 1e6);
        vm.startPrank(attacker);
        usdc6.approve(address(subscription), type(uint256).max);
        // The attacker is first and uses exactly the name the victim will use.
        subscription.subscribeDevices(SALT_A, 1, 1);
        vm.stopPrank();

        // The victim's subscription with the same name works and is a separate fleet.
        vm.prank(operator);
        subscription.subscribeDevices(SALT_A, 100, 1);

        bytes32 attackerFleet = subscription.fleetIdOf(attacker, SALT_A);
        assertTrue(attackerFleet != fleetA);
        assertEq(subscription.getSdkSubscription(attackerFleet).activeDevices, 1);
        assertEq(subscription.getSdkSubscription(fleetA).activeDevices, 100);
        assertTrue(subscription.isDeviceCovered(fleetA));
    }

    function test_FleetId_ACallerCannotTouchAnotherOperatorsFleet() public {
        vm.prank(operator);
        subscription.subscribeFleetPro(SALT_A, 1);
        uint256 validUntil = subscription.getFleetProSubscription(fleetA).validUntil;

        address stranger = address(0xDEAD);
        usdc6.mint(stranger, 1_000 * 1e6);
        vm.startPrank(stranger);
        usdc6.approve(address(subscription), type(uint256).max);
        subscription.subscribeFleetPro(SALT_A, 5); // pays for the stranger's own fleet, nothing else
        vm.stopPrank();

        assertEq(
            subscription.getFleetProSubscription(fleetA).validUntil, validUntil, "the operator's fleet is untouched"
        );
    }

    function test_SubscribeDevices_CannotDowngradeWhileActive() public {
        vm.prank(operator);
        subscription.subscribeDevices(SALT_A, 100, 1);
        assertEq(subscription.getSdkSubscription(fleetA).activeDevices, 100);

        vm.prank(operator);
        vm.expectRevert(IFleetSubscription.CannotDecreaseActiveDevices.selector);
        subscription.subscribeDevices(SALT_A, 50, 1);
    }

    function test_AnySaltIsValid_IncludingZero() public {
        vm.prank(operator);
        subscription.subscribeFleetPro(bytes32(0), 1);
        bytes32 id = subscription.fleetIdOf(operator, bytes32(0));
        assertTrue(id != bytes32(0));
        assertTrue(subscription.isFleetProActive(id));
    }

    function test_Events_CarryTheDerivedFleetId() public {
        uint256 cost = 99 * 1e6;
        vm.expectEmit(true, true, false, true);
        emit IFleetSubscription.SubscribedFleetPro(fleetA, operator, 1, block.timestamp + 30 days, cost);
        vm.prank(operator);
        subscription.subscribeFleetPro(SALT_A, 1);
    }

    function testFuzz_FleetId_NamespacedPerOwner(address a, address b, bytes32 salt) public view {
        vm.assume(a != b);
        assertTrue(subscription.fleetIdOf(a, salt) != subscription.fleetIdOf(b, salt));
    }

    function test_SubscribeDevices_ProratedOnUpgrade() public {
        // Operator subscribes 10 devices for 2 months (60 days)
        // Cost = 10 * 2 * $1 = $20 (20e6)
        vm.prank(operator);
        subscription.subscribeDevices(SALT_A, 10, 2);

        uint256 startBal = usdc6.balanceOf(operator);

        // Fast forward 30 days (remaining 30 days until expiration)
        vm.warp(block.timestamp + 30 days);

        // Upgrade to 20 devices (delta 10 devices) for 1 additional month
        // Prorated cost for delta 10 devices for remaining 30 days: (10 * 30 days * $1) / 30 days = $10
        // Extension cost for 20 devices for 1 month: 20 * 1 * $1 = $20
        // Total cost = $10 + $20 = $30 (30e6)
        vm.prank(operator);
        subscription.subscribeDevices(SALT_A, 20, 1);

        uint256 spent = startBal - usdc6.balanceOf(operator);
        assertEq(spent, 30 * 1e6);

        IFleetSubscription.FleetSubscriptionInfo memory info = subscription.getSdkSubscription(fleetA);
        assertEq(info.activeDevices, 20);
        // Total validUntil: block.timestamp + 60 days
        assertEq(info.validUntil, block.timestamp + 60 days);
        assertEq(info.totalPaidStable, 20 * 1e6 + 30 * 1e6);
    }
}
