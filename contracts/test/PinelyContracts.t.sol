// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {PinelyAccount} from "../src/PinelyAccount.sol";
import {PinelyAccountFactory} from "../src/PinelyAccountFactory.sol";
import {PinelyPaymaster} from "../src/PinelyPaymaster.sol";
import {PinelyStake} from "../src/PinelyStake.sol";
import {BurnVault} from "../src/BurnVault.sol";
import {IBurnVault} from "../src/interfaces/IBurnVault.sol";
import {MachineRegistry} from "../src/MachineRegistry.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {PackedUserOperation} from "../src/interfaces/erc4337/PackedUserOperation.sol";

contract MockStablecoinForPinely is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract MockPinelyToken is ERC20 {
    constructor() ERC20("PINELY Token", "PINELY") {}

    function decimals() public pure override returns (uint8) {
        return 18;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract PinelyContractsTest is Test {
    address public entryPoint = address(0x100);
    address public owner = address(0x200);
    address public operator = address(0x300);
    address public treasury = address(0x400);
    address public sessionKey = address(0x500);

    PinelyAccountFactory public factory;
    MachineRegistry public registry;
    MockStablecoinForPinely public usdc;
    MockPinelyToken public pinely;
    PinelyPaymaster public paymaster;
    PinelyStake public stakeContract;
    BurnVault public burnVault;

    function setUp() public {
        vm.warp(1_700_000_000);

        factory = new PinelyAccountFactory(entryPoint);
        registry = new MachineRegistry(owner);
        usdc = new MockStablecoinForPinely();
        pinely = new MockPinelyToken();

        burnVault = new BurnVault(address(pinely), owner);
        stakeContract = new PinelyStake(address(pinely), address(burnVault), owner, owner);

        paymaster = new PinelyPaymaster(entryPoint, address(registry), address(usdc), treasury, owner);
    }

    function test_PinelyAccountFactory_DeterministicSaltPrefix() public {
        uint256 salt = 42;
        address predicted =
            factory.getAddress(owner, sessionKey, uint48(block.timestamp + 10 days), uint48(block.timestamp), salt);

        PinelyAccount deployed =
            factory.createAccount(owner, sessionKey, uint48(block.timestamp + 10 days), uint48(block.timestamp), salt);

        assertEq(address(deployed), predicted);
        assertEq(deployed.owner(), owner);
        assertEq(deployed.sessionKey(), sessionKey);

        // Compute actual salt uses PINELY_ACCOUNT_V1 prefix
        bytes32 expectedSalt = keccak256(abi.encodePacked(factory.SALT_PREFIX(), salt));
        assertEq(factory.computeActualSalt(salt), expectedSalt);
    }

    function test_PinelyPaymaster_PricingBoundsAndStaleness() public {
        // No default rate: fail-closed until the owner publishes one.
        assertEq(paymaster.fixedNativePrice(), 0);
        assertEq(paymaster.minPrice(), 1 * 1e8);
        assertEq(paymaster.maxPrice(), 500 * 1e8);

        // Owner can set valid price within bounds
        vm.prank(owner);
        paymaster.setNativePrice(30 * 1e8);
        assertEq(paymaster.fixedNativePrice(), 30 * 1e8);

        // Setting below minPrice reverts
        vm.prank(owner);
        vm.expectRevert(PinelyPaymaster.InvalidPriceBounds.selector);
        paymaster.setNativePrice(0.5 * 1e8);

        // Setting above maxPrice reverts
        vm.prank(owner);
        vm.expectRevert(PinelyPaymaster.InvalidPriceBounds.selector);
        paymaster.setNativePrice(600 * 1e8);

        // Stranger cannot update price
        vm.prank(operator);
        vm.expectRevert();
        paymaster.setNativePrice(25 * 1e8);
    }

    function test_PinelyPaymaster_DepositAndCredit() public {
        address machineAccount = address(0xABC);
        usdc.mint(operator, 100 * 1e6);

        vm.startPrank(operator);
        usdc.approve(address(paymaster), 50 * 1e6);
        paymaster.depositCredit(machineAccount, 50 * 1e6);
        vm.stopPrank();

        assertEq(paymaster.creditOf(machineAccount), 50 * 1e6);
        assertEq(usdc.balanceOf(address(paymaster)), 50 * 1e6);
    }

    function test_BurnVault_EmitsBurnedEvent() public {
        pinely.mint(address(burnVault), 1000 * 1e18);

        vm.expectEmit(true, true, true, true);
        emit IBurnVault.Burned(1000 * 1e18);
        burnVault.burnAll();

        assertEq(burnVault.totalBurned(), 1000 * 1e18);
        assertEq(pinely.balanceOf(burnVault.DEAD_ADDRESS()), 1000 * 1e18);
    }

    function test_PinelyStake_StakingLifecycle() public {
        pinely.mint(operator, 20_000 * 1e18);

        vm.startPrank(operator);
        pinely.approve(address(stakeContract), 10_000 * 1e18);
        stakeContract.stake(10_000 * 1e18);
        vm.stopPrank();

        assertEq(stakeContract.stakeOf(operator), 10_000 * 1e18);
        assertTrue(stakeContract.hasMinStakeGold(operator));

        // Initiate unbonding
        vm.prank(operator);
        stakeContract.requestUnstake(5_000 * 1e18);
        assertFalse(stakeContract.hasMinStakeGold(operator)); // Loss of gold tier immediately

        // Warp 7 days and complete unbonding
        vm.warp(block.timestamp + 7 days);
        vm.prank(operator);
        stakeContract.withdrawUnstaked();

        assertEq(pinely.balanceOf(operator), 15_000 * 1e18);
    }
}
