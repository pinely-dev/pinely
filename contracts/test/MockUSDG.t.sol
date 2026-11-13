// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";

contract MockUSDGTest is Test {
    MockUSDG public usdc;
    address public deployer = address(0xDE910);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);

    event FaucetClaimed(address indexed recipient, uint256 amount);

    function setUp() public {
        vm.prank(deployer);
        usdc = new MockUSDG();
    }

    function test_InitialSupplyAndDecimals() public view {
        assertEq(usdc.name(), "Mock USDG");
        assertEq(usdc.symbol(), "mUSDG");
        assertEq(usdc.decimals(), 6);
        assertEq(usdc.balanceOf(deployer), 1_000_000 * 1e6);
        assertEq(usdc.totalSupply(), 1_000_000 * 1e6);
    }

    function test_FaucetClaimsTokens() public {
        assertEq(usdc.balanceOf(alice), 0);

        vm.expectEmit(true, false, false, true);
        emit FaucetClaimed(alice, 100 * 1e6);

        vm.prank(alice);
        usdc.faucet();

        assertEq(usdc.balanceOf(alice), 100 * 1e6);
        assertEq(usdc.totalSupply(), 1_000_100 * 1e6);

        // Multiple faucet claims allowed for repeated test cycles
        vm.prank(alice);
        usdc.faucet();
        assertEq(usdc.balanceOf(alice), 200 * 1e6);
    }

    function test_MintAndBurn() public {
        vm.prank(deployer);
        usdc.mint(bob, 50 * 1e6);
        assertEq(usdc.balanceOf(bob), 50 * 1e6);

        vm.prank(bob);
        usdc.burn(bob, 20 * 1e6);
        assertEq(usdc.balanceOf(bob), 30 * 1e6);
    }

    function testFuzz_MintAnyAmount(address recipient, uint128 amount) public {
        vm.assume(recipient != address(0));
        uint256 beforeBal = usdc.balanceOf(recipient);
        usdc.mint(recipient, amount);
        assertEq(usdc.balanceOf(recipient), beforeBal + amount);
    }
}
