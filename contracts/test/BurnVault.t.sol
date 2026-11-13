// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {BurnVault} from "../src/BurnVault.sol";
import {IBurnVault} from "../src/interfaces/IBurnVault.sol";
import {MockERC20} from "./utils/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockSwapRouter {
    address public pinelyToken;

    constructor(address _pinelyToken) {
        pinelyToken = _pinelyToken;
    }

    function swapTokens(address tokenIn, uint256 amountIn, uint256 amountOut) external {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(pinelyToken).transfer(msg.sender, amountOut);
    }
}

contract MaliciousReentrantRouter {
    address public vault;

    function setVault(address _vault) external {
        vault = _vault;
    }

    function swapTokens(address, uint256, uint256) external {
        // Attempt reentrancy callback into BurnVault
        BurnVault(payable(vault)).burn(1);
    }
}

contract BurnVaultTest is Test {
    event Burned(uint256 amount);

    BurnVault public vault;
    MockERC20 public pinelyToken;
    MockERC20 public usdcToken;
    MockSwapRouter public swapRouter;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address public alice = address(0xA11CE);

    function setUp() public {
        pinelyToken = new MockERC20("PINELY Token", "PINELY", 18);
        usdcToken = new MockERC20("USDC Token", "USDC", 6);
        vault = new BurnVault(address(pinelyToken), address(this));
        swapRouter = new MockSwapRouter(address(pinelyToken));
    }

    function test_Constructor_ZeroAddressReverts() public {
        vm.expectRevert(IBurnVault.ZeroAddress.selector);
        new BurnVault(address(0), address(this));

        vm.expectRevert(IBurnVault.ZeroAddress.selector);
        new BurnVault(address(pinelyToken), address(0));
    }

    function test_Burn_Success() public {
        pinelyToken.mint(address(vault), 1000e18);

        vm.expectEmit(false, false, false, true);
        emit Burned(400e18);

        vault.burn(400e18);

        assertEq(pinelyToken.balanceOf(DEAD), 400e18);
        assertEq(pinelyToken.balanceOf(address(vault)), 600e18);
        assertEq(vault.totalBurned(), 400e18);
    }

    function test_Burn_RevertIf_ZeroAmount() public {
        vm.expectRevert(IBurnVault.ZeroAmount.selector);
        vault.burn(0);
    }

    function test_BurnAll_Success() public {
        pinelyToken.mint(address(vault), 1500e18);

        vm.expectEmit(false, false, false, true);
        emit Burned(1500e18);

        vault.burnAll();

        assertEq(pinelyToken.balanceOf(DEAD), 1500e18);
        assertEq(pinelyToken.balanceOf(address(vault)), 0);
        assertEq(vault.totalBurned(), 1500e18);
    }

    function test_BurnAll_RevertIf_ZeroBalance() public {
        vm.expectRevert(IBurnVault.ZeroAmount.selector);
        vault.burnAll();
    }

    function test_BuybackAndBurn_Success() public {
        // Mint 1,000 USDC to vault
        usdcToken.mint(address(vault), 1000e6);
        // Mint 5,000 PINELY to swapRouter so it can fulfill the swap
        pinelyToken.mint(address(swapRouter), 5000e18);

        bytes memory swapData =
            abi.encodeWithSelector(MockSwapRouter.swapTokens.selector, address(usdcToken), 1000e6, 5000e18);

        vm.expectEmit(false, false, false, true);
        emit Burned(5000e18);

        uint256 burned = vault.buybackAndBurn(address(swapRouter), address(usdcToken), 1000e6, 5000e18, swapData);

        assertEq(burned, 5000e18);
        assertEq(pinelyToken.balanceOf(DEAD), 5000e18);
        assertEq(usdcToken.balanceOf(address(vault)), 0);
        assertEq(vault.totalBurned(), 5000e18);
    }

    function test_BuybackAndBurn_RevertIfNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 100e6, 500e18, "");
    }

    function test_BuybackAndBurn_RevertIfSlippage() public {
        usdcToken.mint(address(vault), 1000e6);
        pinelyToken.mint(address(swapRouter), 4000e18);

        bytes memory swapData =
            abi.encodeWithSelector(MockSwapRouter.swapTokens.selector, address(usdcToken), 1000e6, 4000e18);

        // Expect minPinelyOut = 5000e18 but receives only 4000e18
        vm.expectRevert(IBurnVault.SlippageExceeded.selector);
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 1000e6, 5000e18, swapData);
    }

    /// @notice A reentrancy callback attempt during swapTokens is blocked by the ReentrancyGuard.
    function test_BuybackAndBurn_ReentrancyBlocked() public {
        MaliciousReentrantRouter reentrantRouter = new MaliciousReentrantRouter();
        reentrantRouter.setVault(address(vault));

        usdcToken.mint(address(vault), 1000e6);
        bytes memory swapData =
            abi.encodeWithSelector(MaliciousReentrantRouter.swapTokens.selector, address(usdcToken), 1000e6, 5000e18);

        vm.expectRevert(IBurnVault.SwapFailed.selector);
        vault.buybackAndBurn(address(reentrantRouter), address(usdcToken), 1000e6, 5000e18, swapData);
    }
}
