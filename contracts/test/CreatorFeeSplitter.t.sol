// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {CreatorFeeSplitter} from "../src/CreatorFeeSplitter.sol";
import {ICreatorFeeSplitter} from "../src/interfaces/ICreatorFeeSplitter.sol";
import {MockERC20} from "./utils/MockERC20.sol";

contract CreatorFeeSplitterTest is Test {
    CreatorFeeSplitter public splitter;
    MockERC20 public token;

    address public burnVault = address(0xBBBB);
    address public treasury = address(0x7777);

    event FeeSplit(address indexed token, uint256 burnAmount, uint256 treasuryAmount);

    function setUp() public {
        token = new MockERC20("USDC Token", "USDC", 6);
        splitter = new CreatorFeeSplitter(burnVault, treasury);
    }

    function test_Constructor_ZeroAddressReverts() public {
        vm.expectRevert(ICreatorFeeSplitter.ZeroAddress.selector);
        new CreatorFeeSplitter(address(0), treasury);

        vm.expectRevert(ICreatorFeeSplitter.ZeroAddress.selector);
        new CreatorFeeSplitter(burnVault, address(0));
    }

    function test_Distribute_Success() public {
        // Transfer 10,000 USDC ke splitter
        token.mint(address(splitter), 10_000e6);

        // 30% = 3,000 USDC -> burnVault
        // 70% = 7,000 USDC -> treasury
        vm.expectEmit(true, false, false, true);
        emit FeeSplit(address(token), 3000e6, 7000e6);

        splitter.distribute(address(token));

        assertEq(token.balanceOf(burnVault), 3000e6);
        assertEq(token.balanceOf(treasury), 7000e6);
        assertEq(token.balanceOf(address(splitter)), 0);
    }

    function testFuzz_Distribute(uint128 amount) public {
        vm.assume(amount > 100);

        token.mint(address(splitter), amount);

        uint256 expectedBurn = (uint256(amount) * 3000) / 10000;
        uint256 expectedTreasury = uint256(amount) - expectedBurn;

        splitter.distribute(address(token));

        assertEq(token.balanceOf(burnVault), expectedBurn);
        assertEq(token.balanceOf(treasury), expectedTreasury);
        assertEq(token.balanceOf(address(splitter)), 0);
    }

    function test_Distribute_RevertIf_ZeroBalance() public {
        vm.expectRevert(ICreatorFeeSplitter.NothingToDistribute.selector);
        splitter.distribute(address(token));
    }

    function test_Distribute_RevertIf_ZeroAddress() public {
        vm.expectRevert(ICreatorFeeSplitter.ZeroAddress.selector);
        splitter.distribute(address(0));
    }
}
