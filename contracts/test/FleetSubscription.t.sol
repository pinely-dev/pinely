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

    bytes32 public constant FLEET_A = keccak256("FLEET_DELIVERY_ROBOTS");

    function setUp() public {
        usdc6 = new MockStablecoin6();
        usdc18 = new MockStablecoin18();

        subscription = new FleetSubscription(address(usdc6), burnVault, treasury);
        subscription18 = new FleetSubscription(address(usdc18), burnVault, treasury);

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
        subscription.subscribeFleetPro(FLEET_A, 1);

        uint256 cost = 99 * 1e6;
        uint256 expectedBurn = (cost * 2000) / 10000; // 20%
        uint256 expectedTreasury = cost - expectedBurn; // 80%

        assertEq(usdc6.balanceOf(burnVault) - initialBurnBal, expectedBurn, "Burn split mismatch");
        assertEq(usdc6.balanceOf(treasury) - initialTreasuryBal, expectedTreasury, "Treasury split mismatch");
        assertTrue(subscription.isFleetProActive(FLEET_A), "Fleet Pro should be active");

        IFleetSubscription.FleetSubscriptionInfo memory info = subscription.getFleetProSubscription(FLEET_A);
        assertEq(info.validUntil, block.timestamp + 30 days, "Expiry should be +30 days");
        assertEq(info.totalPaidStable, cost, "Total paid mismatch");
    }

    function test_SubscribeFleetPro_CumulativeExtension() public {
        vm.prank(operator);
        subscription.subscribeFleetPro(FLEET_A, 2); // 60 days

        uint256 firstExpiry = block.timestamp + 60 days;
        assertEq(subscription.getFleetProSubscription(FLEET_A).validUntil, firstExpiry);

        // Fast forward 10 days
        vm.warp(block.timestamp + 10 days);
        assertTrue(subscription.isFleetProActive(FLEET_A));

        // Extend 1 more month
        vm.prank(operator);
        subscription.subscribeFleetPro(FLEET_A, 1);

        assertEq(subscription.getFleetProSubscription(FLEET_A).validUntil, firstExpiry + 30 days);
    }

    function test_SubscribeFleetPro_ExpiredRenewal() public {
        vm.prank(operator);
        subscription.subscribeFleetPro(FLEET_A, 1); // 30 days

        // Fast forward past expiration (35 days)
        vm.warp(block.timestamp + 35 days);
        assertFalse(subscription.isFleetProActive(FLEET_A));

        // Renew for 1 month
        vm.prank(operator);
        subscription.subscribeFleetPro(FLEET_A, 1);

        assertTrue(subscription.isFleetProActive(FLEET_A));
        assertEq(subscription.getFleetProSubscription(FLEET_A).validUntil, block.timestamp + 30 days);
    }

    function test_SubscribeDevices_SuccessAndCovered() public {
        uint256 initialBurnBal = usdc6.balanceOf(burnVault);
        uint256 initialTreasuryBal = usdc6.balanceOf(treasury);

        uint256 devices = 50;
        uint256 months = 3;
        uint256 cost = devices * months * 1 * 1e6; // $150

        vm.prank(operator);
        subscription.subscribeDevices(FLEET_A, devices, months);

        uint256 expectedBurn = (cost * 2000) / 10000;
        uint256 expectedTreasury = cost - expectedBurn;

        assertEq(usdc6.balanceOf(burnVault) - initialBurnBal, expectedBurn);
        assertEq(usdc6.balanceOf(treasury) - initialTreasuryBal, expectedTreasury);
        assertTrue(subscription.isDeviceCovered(FLEET_A));

        IFleetSubscription.FleetSubscriptionInfo memory info = subscription.getSdkSubscription(FLEET_A);
        assertEq(info.activeDevices, 50);
        assertEq(info.validUntil, block.timestamp + 90 days);
        assertEq(info.totalPaidStable, cost);
    }

    function test_DecimalScale18Support() public {
        vm.prank(operator);
        subscription18.subscribeFleetPro(FLEET_A, 1);

        uint256 cost18 = 99 * 1e18;
        uint256 expectedBurn = (cost18 * 2000) / 10000;

        assertEq(usdc18.balanceOf(burnVault), expectedBurn);
        assertTrue(subscription18.isFleetProActive(FLEET_A));
    }

    function test_Subscribe_RevertsOnInvalidInputs() public {
        vm.startPrank(operator);

        // Zero fleetId
        vm.expectRevert(IFleetSubscription.InvalidAmount.selector);
        subscription.subscribeFleetPro(bytes32(0), 1);

        // Zero months
        vm.expectRevert(IFleetSubscription.InvalidAmount.selector);
        subscription.subscribeFleetPro(FLEET_A, 0);

        // Zero devices
        vm.expectRevert(IFleetSubscription.InvalidAmount.selector);
        subscription.subscribeDevices(FLEET_A, 0, 1);

        // Zero months devices
        vm.expectRevert(IFleetSubscription.InvalidAmount.selector);
        subscription.subscribeDevices(FLEET_A, 10, 0);

        vm.stopPrank();
    }

    function test_SubscribeDevices_GriefingDefeated() public {
        // Operator registers fleet with 100 devices
        vm.prank(operator);
        subscription.subscribeDevices(FLEET_A, 100, 1);

        assertEq(subscription.fleetOwners(FLEET_A), operator);
        assertEq(subscription.getSdkSubscription(FLEET_A).activeDevices, 100);

        // Stranger tries to subscribe/modify devices -> reverts NotFleetOwner
        address stranger = address(0xDEAD);
        usdc6.mint(stranger, 100 * 1e6);
        vm.startPrank(stranger);
        usdc6.approve(address(subscription), type(uint256).max);
        vm.expectRevert(IFleetSubscription.NotFleetOwner.selector);
        subscription.subscribeDevices(FLEET_A, 1, 1);
        vm.stopPrank();

        // Operator tries to downgrade active devices during active period -> reverts CannotDecreaseActiveDevices
        vm.prank(operator);
        vm.expectRevert(IFleetSubscription.CannotDecreaseActiveDevices.selector);
        subscription.subscribeDevices(FLEET_A, 50, 1);
    }

    function test_SubscribeFleetPro_StrangerRevertsNotFleetOwner() public {
        // Operator subscribes Fleet Pro for FLEET_A
        vm.prank(operator);
        subscription.subscribeFleetPro(FLEET_A, 1);
        assertEq(subscription.fleetOwners(FLEET_A), operator);

        // Stranger tries to call subscribeFleetPro for FLEET_A -> reverts NotFleetOwner (IMM-06)
        address stranger = address(0xDEAD);
        usdc6.mint(stranger, 200 * 1e6);
        vm.startPrank(stranger);
        usdc6.approve(address(subscription), type(uint256).max);
        vm.expectRevert(IFleetSubscription.NotFleetOwner.selector);
        subscription.subscribeFleetPro(FLEET_A, 1);
        vm.stopPrank();
    }

    function test_SubscribeDevices_ProratedOnUpgrade() public {
        // Operator subscribes 10 devices for 2 months (60 days)
        // Cost = 10 * 2 * $1 = $20 (20e6)
        vm.prank(operator);
        subscription.subscribeDevices(FLEET_A, 10, 2);

        uint256 startBal = usdc6.balanceOf(operator);

        // Fast forward 30 days (remaining 30 days until expiration)
        vm.warp(block.timestamp + 30 days);

        // Upgrade to 20 devices (delta 10 devices) for 1 additional month
        // Prorated cost for delta 10 devices for remaining 30 days: (10 * 30 days * $1) / 30 days = $10
        // Extension cost for 20 devices for 1 month: 20 * 1 * $1 = $20
        // Total cost = $10 + $20 = $30 (30e6)
        vm.prank(operator);
        subscription.subscribeDevices(FLEET_A, 20, 1);

        uint256 spent = startBal - usdc6.balanceOf(operator);
        assertEq(spent, 30 * 1e6);

        IFleetSubscription.FleetSubscriptionInfo memory info = subscription.getSdkSubscription(FLEET_A);
        assertEq(info.activeDevices, 20);
        // Total validUntil: block.timestamp + 60 days
        assertEq(info.validUntil, block.timestamp + 60 days);
        assertEq(info.totalPaidStable, 20 * 1e6 + 30 * 1e6);
    }
}
