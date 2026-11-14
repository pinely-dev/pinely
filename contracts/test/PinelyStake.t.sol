// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {PinelyStake} from "../src/PinelyStake.sol";
import {IPinelyStake} from "../src/interfaces/IPinelyStake.sol";
import {MockERC20} from "./utils/MockERC20.sol";

contract PinelyStakeTest is Test {
    PinelyStake public stakeContract;
    MockERC20 public pinelyToken;

    address public owner = address(0xAAAA);
    address public burnVault = address(0xBBBB);
    address public slashingAuthority = address(0x5555);
    address public operator = address(0x0001);
    address public stranger = address(0x9999);

    function setUp() public {
        pinelyToken = new MockERC20("PINELY Token", "PINELY", 18);
        stakeContract = new PinelyStake(address(pinelyToken), burnVault, slashingAuthority, owner);

        pinelyToken.mint(operator, 50_000e18);
        vm.prank(operator);
        pinelyToken.approve(address(stakeContract), type(uint256).max);
    }

    function test_Stake_Success() public {
        vm.prank(operator);
        stakeContract.stake(10_000e18);

        assertEq(stakeContract.stakeOf(operator), 10_000e18);
        assertTrue(stakeContract.hasMinStakeGold(operator));
    }

    function test_Constructor_RejectsAWrongTokenAndZeroAddresses() public {
        // $PINELY must have 18 decimals: the Gold threshold is written in 18-decimal units.
        MockERC20 sixDecimals = new MockERC20("Six", "SIX", 6);
        vm.expectRevert(IPinelyStake.InvalidToken.selector);
        new PinelyStake(address(sixDecimals), burnVault, slashingAuthority, owner);

        vm.expectRevert(IPinelyStake.ZeroAddress.selector);
        new PinelyStake(address(0), burnVault, slashingAuthority, owner);
        vm.expectRevert(IPinelyStake.ZeroAddress.selector);
        new PinelyStake(address(pinelyToken), address(0), slashingAuthority, owner);
        vm.expectRevert(IPinelyStake.ZeroAddress.selector);
        new PinelyStake(address(pinelyToken), burnVault, address(0), owner);
    }

    function test_SetSlashingAuthority_OnlyOwnerAndTakesEffect() public {
        address newAuthority = address(0x7777);

        vm.prank(stranger);
        vm.expectRevert();
        stakeContract.setSlashingAuthority(newAuthority);

        vm.prank(owner);
        vm.expectRevert(IPinelyStake.ZeroAddress.selector);
        stakeContract.setSlashingAuthority(address(0));

        vm.prank(operator);
        stakeContract.stake(10_000e18);

        vm.prank(owner);
        stakeContract.setSlashingAuthority(newAuthority);

        // The old authority loses the power to slash, the new one gains it.
        vm.prank(slashingAuthority);
        vm.expectRevert(IPinelyStake.NotSlashingAuthority.selector);
        stakeContract.slash(operator, 1e18, bytes32("evidence"));

        vm.prank(newAuthority);
        stakeContract.slash(operator, 1e18, bytes32("evidence"));
        assertEq(stakeContract.stakeOf(operator), 10_000e18 - 1e18);
        assertEq(pinelyToken.balanceOf(burnVault), 1e18, "slashed tokens go straight to the BurnVault");
    }

    function test_Stake_RevertIf_ZeroAmount() public {
        vm.prank(operator);
        vm.expectRevert(IPinelyStake.ZeroAmount.selector);
        stakeContract.stake(0);
    }

    function test_Unbonding_Lifecycle() public {
        vm.startPrank(operator);
        stakeContract.stake(15_000e18);

        stakeContract.requestUnstake(5_000e18);
        assertEq(stakeContract.stakeOf(operator), 10_000e18);
        assertTrue(stakeContract.hasMinStakeGold(operator));

        (uint256 amt, uint64 unlockTime) = stakeContract.unbondRequestOf(operator);
        assertEq(amt, 5_000e18);
        assertEq(unlockTime, block.timestamp + 7 days);

        // Cannot withdraw before 7 days
        vm.expectRevert(IPinelyStake.UnbondingNotMatured.selector);
        stakeContract.withdrawUnstaked();

        vm.warp(block.timestamp + 6 days);
        vm.expectRevert(IPinelyStake.UnbondingNotMatured.selector);
        stakeContract.withdrawUnstaked();

        // After 7 days, withdraw succeeds
        vm.warp(block.timestamp + 1 days + 1);
        uint256 balanceBefore = pinelyToken.balanceOf(operator);
        stakeContract.withdrawUnstaked();
        uint256 balanceAfter = pinelyToken.balanceOf(operator);

        assertEq(balanceAfter - balanceBefore, 5_000e18);

        (amt,) = stakeContract.unbondRequestOf(operator);
        assertEq(amt, 0);

        // Cannot withdraw again once drained
        vm.expectRevert(IPinelyStake.NoActiveUnbond.selector);
        stakeContract.withdrawUnstaked();

        vm.stopPrank();
    }

    function test_Unbonding_ImmediateTierLoss() public {
        vm.startPrank(operator);
        stakeContract.stake(10_000e18);
        assertTrue(stakeContract.hasMinStakeGold(operator));

        stakeContract.requestUnstake(1_000e18);
        assertEq(stakeContract.stakeOf(operator), 9_000e18);
        assertFalse(stakeContract.hasMinStakeGold(operator));
        vm.stopPrank();
    }

    function test_CancelUnstake_Success() public {
        vm.startPrank(operator);
        stakeContract.stake(10_000e18);
        stakeContract.requestUnstake(5_000e18);

        assertEq(stakeContract.stakeOf(operator), 5_000e18);
        assertFalse(stakeContract.hasMinStakeGold(operator));

        stakeContract.cancelUnstake();

        assertEq(stakeContract.stakeOf(operator), 10_000e18);
        assertTrue(stakeContract.hasMinStakeGold(operator));

        (uint256 amt,) = stakeContract.unbondRequestOf(operator);
        assertEq(amt, 0);
        vm.stopPrank();
    }

    function test_CancelUnstake_RevertIf_NoActiveUnbond() public {
        vm.prank(operator);
        vm.expectRevert(IPinelyStake.NoActiveUnbond.selector);
        stakeContract.cancelUnstake();
    }

    function test_Slash_ActiveStake() public {
        vm.prank(operator);
        stakeContract.stake(20_000e18);

        bytes32 evidence = keccak256("fake-firmware-attestation");

        vm.prank(slashingAuthority);
        stakeContract.slash(operator, 15_000e18, evidence);

        assertEq(stakeContract.stakeOf(operator), 5_000e18);
        assertEq(pinelyToken.balanceOf(burnVault), 15_000e18);
        assertFalse(stakeContract.hasMinStakeGold(operator));
    }

    function test_Slash_UnbondingStake_FrontRunningDefeated() public {
        vm.prank(operator);
        stakeContract.stake(20_000e18);

        // Malicious operator tries to front-run slashing by requesting full unbond
        vm.prank(operator);
        stakeContract.requestUnstake(20_000e18);
        assertEq(stakeContract.stakeOf(operator), 0);

        bytes32 evidence = keccak256("frontrun-slash-attempt");

        // Slashing authority slashes during unbonding period
        vm.prank(slashingAuthority);
        stakeContract.slash(operator, 15_000e18, evidence);

        assertEq(pinelyToken.balanceOf(burnVault), 15_000e18);
        (uint256 remainingUnbond,) = stakeContract.unbondRequestOf(operator);
        assertEq(remainingUnbond, 5_000e18);

        // After unbond period, operator can only withdraw the remaining 5,000 PINELY
        vm.warp(block.timestamp + 7 days + 1);
        uint256 balBefore = pinelyToken.balanceOf(operator);
        vm.prank(operator);
        stakeContract.withdrawUnstaked();
        assertEq(pinelyToken.balanceOf(operator) - balBefore, 5_000e18);
    }

    function test_Slash_BothActiveAndUnbonding() public {
        vm.startPrank(operator);
        stakeContract.stake(10_000e18);
        stakeContract.requestUnstake(6_000e18); // 4,000 active, 6,000 unbonding
        vm.stopPrank();

        bytes32 evidence = keccak256("hybrid-slash");

        vm.prank(slashingAuthority);
        stakeContract.slash(operator, 7_000e18, evidence);

        assertEq(stakeContract.stakeOf(operator), 0);
        (uint256 unbondLeft,) = stakeContract.unbondRequestOf(operator);
        assertEq(unbondLeft, 3_000e18);
        assertEq(pinelyToken.balanceOf(burnVault), 7_000e18);
    }

    function test_Slash_RevertIf_InsufficientTotalStake() public {
        vm.prank(operator);
        stakeContract.stake(5_000e18);

        vm.prank(slashingAuthority);
        vm.expectRevert(IPinelyStake.InsufficientStake.selector);
        stakeContract.slash(operator, 6_000e18, keccak256("evidence"));
    }

    function test_Slash_RevertIf_NotAuthority() public {
        vm.prank(operator);
        stakeContract.stake(20_000e18);

        vm.prank(stranger);
        vm.expectRevert(IPinelyStake.NotSlashingAuthority.selector);
        stakeContract.slash(operator, 5_000e18, keccak256("evidence"));
    }

    function test_Constructor_ZeroAddressReverts() public {
        vm.expectRevert(IPinelyStake.ZeroAddress.selector);
        new PinelyStake(address(0), burnVault, slashingAuthority, owner);

        vm.expectRevert(IPinelyStake.ZeroAddress.selector);
        new PinelyStake(address(pinelyToken), address(0), slashingAuthority, owner);

        vm.expectRevert(IPinelyStake.ZeroAddress.selector);
        new PinelyStake(address(pinelyToken), burnVault, address(0), owner);

        vm.expectRevert(abi.encodeWithSelector(bytes4(keccak256("OwnableInvalidOwner(address)")), address(0)));
        new PinelyStake(address(pinelyToken), burnVault, slashingAuthority, address(0));
    }

    function test_Constructor_InvalidDecimalsReverts() public {
        // Token with 6 decimals reverts with InvalidToken (IMM-04)
        MockERC20 token6 = new MockERC20("6 Dec Token", "DEC6", 6);
        vm.expectRevert(IPinelyStake.InvalidToken.selector);
        new PinelyStake(address(token6), burnVault, slashingAuthority, owner);
    }
}
