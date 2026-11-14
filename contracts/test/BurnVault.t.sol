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

    /// @dev A different selector on the same router, used to prove the allowlist is per selector.
    function otherSwap(address, uint256, uint256) external pure {}
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

/// @dev Uses the mock token's open `burn(from, amount)` to take more of the sold token than was approved.
contract DrainingRouter {
    function swapTokens(address tokenIn, uint256 amountIn, uint256) external {
        MockERC20(tokenIn).burn(msg.sender, amountIn * 2);
    }
}

contract BurnVaultTest is Test {
    event Burned(uint256 amount);
    event RouteProposed(address indexed router, bytes4 indexed selector, uint64 activeAt);
    event RouteRevoked(address indexed router, bytes4 indexed selector);

    BurnVault public vault;
    MockERC20 public pinelyToken;
    MockERC20 public usdcToken;
    MockSwapRouter public swapRouter;

    address public constant DEAD = 0x000000000000000000000000000000000000dEaD;
    address public alice = address(0xA11CE);

    bytes4 internal constant SWAP = MockSwapRouter.swapTokens.selector;

    function setUp() public {
        pinelyToken = new MockERC20("PINELY Token", "PINELY", 18);
        usdcToken = new MockERC20("USDC Token", "USDC", 6);
        vault = new BurnVault(address(pinelyToken), address(this));
        swapRouter = new MockSwapRouter(address(pinelyToken));
    }

    /// @dev Proposes a route and waits out the delay so it is usable.
    function _allow(address router, bytes4 selector) internal {
        vault.proposeRoute(router, selector);
        vm.warp(block.timestamp + vault.ROUTE_DELAY());
    }

    function _swapData(uint256 amountIn, uint256 amountOut) internal view returns (bytes memory) {
        return abi.encodeWithSelector(SWAP, address(usdcToken), amountIn, amountOut);
    }

    // --- Constructor and plain burns ---

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

    // --- Buyback: happy path and existing guarantees ---

    function test_BuybackAndBurn_Success() public {
        // 1,000 USDC in the vault; the daily cap is 25%, so 250 USDC can be spent today.
        usdcToken.mint(address(vault), 1000e6);
        pinelyToken.mint(address(swapRouter), 5000e18);
        _allow(address(swapRouter), SWAP);

        bytes memory swapData = _swapData(250e6, 1250e18);

        vm.expectEmit(false, false, false, true);
        emit Burned(1250e18);

        uint256 burned = vault.buybackAndBurn(address(swapRouter), address(usdcToken), 250e6, 1250e18, swapData);

        assertEq(burned, 1250e18);
        assertEq(pinelyToken.balanceOf(DEAD), 1250e18);
        assertEq(usdcToken.balanceOf(address(vault)), 750e6);
        assertEq(vault.totalBurned(), 1250e18);
    }

    function test_BuybackAndBurn_RevertIfNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 100e6, 500e18, "");
    }

    function test_BuybackAndBurn_RevertIfSlippage() public {
        usdcToken.mint(address(vault), 1000e6);
        pinelyToken.mint(address(swapRouter), 4000e18);
        _allow(address(swapRouter), SWAP);

        // Expect minPinelyOut = 5000e18 but receives only 1000e18
        vm.expectRevert(IBurnVault.SlippageExceeded.selector);
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 250e6, 5000e18, _swapData(250e6, 1000e18));
    }

    /// @notice A reentrancy callback attempt during swapTokens is blocked by the ReentrancyGuard.
    function test_BuybackAndBurn_ReentrancyBlocked() public {
        MaliciousReentrantRouter reentrantRouter = new MaliciousReentrantRouter();
        reentrantRouter.setVault(address(vault));
        _allow(address(reentrantRouter), MaliciousReentrantRouter.swapTokens.selector);

        usdcToken.mint(address(vault), 1000e6);
        bytes memory swapData =
            abi.encodeWithSelector(MaliciousReentrantRouter.swapTokens.selector, address(usdcToken), 250e6, 1250e18);

        vm.expectRevert(IBurnVault.SwapFailed.selector);
        vault.buybackAndBurn(address(reentrantRouter), address(usdcToken), 250e6, 1250e18, swapData);
    }

    // --- C-30: route allowlist and delay ---

    function test_Route_NotProposed_Reverts() public {
        usdcToken.mint(address(vault), 1000e6);
        pinelyToken.mint(address(swapRouter), 5000e18);

        vm.expectRevert(IBurnVault.RouteNotActive.selector);
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 250e6, 1250e18, _swapData(250e6, 1250e18));
    }

    function test_Route_UsableOnlyAfterDelay() public {
        usdcToken.mint(address(vault), 1000e6);
        pinelyToken.mint(address(swapRouter), 5000e18);
        bytes memory swapData = _swapData(250e6, 1250e18);

        uint64 expected = uint64(block.timestamp) + vault.ROUTE_DELAY();
        vm.expectEmit(true, true, false, true);
        emit RouteProposed(address(swapRouter), SWAP, expected);
        vault.proposeRoute(address(swapRouter), SWAP);

        assertEq(vault.routeActiveAt(address(swapRouter), SWAP), expected);
        assertFalse(vault.isRouteActive(address(swapRouter), SWAP));

        // One second before the delay ends: still blocked.
        vm.warp(expected - 1);
        vm.expectRevert(IBurnVault.RouteNotActive.selector);
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 250e6, 1250e18, swapData);

        // At the delay: usable.
        vm.warp(expected);
        assertTrue(vault.isRouteActive(address(swapRouter), SWAP));
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 250e6, 1250e18, swapData);
        assertEq(pinelyToken.balanceOf(DEAD), 1250e18);
    }

    function test_Route_IsPerSelector() public {
        usdcToken.mint(address(vault), 1000e6);
        _allow(address(swapRouter), SWAP);

        // `otherSwap` was never proposed on the same router.
        bytes memory other = abi.encodeWithSelector(MockSwapRouter.otherSwap.selector, address(usdcToken), 1, 1);
        vm.expectRevert(IBurnVault.RouteNotActive.selector);
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 250e6, 1, other);
    }

    function test_Route_ShortCalldata_Reverts() public {
        usdcToken.mint(address(vault), 1000e6);
        _allow(address(swapRouter), SWAP);

        vm.expectRevert(IBurnVault.RouteNotActive.selector);
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 250e6, 1, hex"abcdef");
    }

    function test_Route_DuplicateProposal_Reverts() public {
        vault.proposeRoute(address(swapRouter), SWAP);
        vm.expectRevert(IBurnVault.RouteAlreadyProposed.selector);
        vault.proposeRoute(address(swapRouter), SWAP);
    }

    function test_Route_OnlyOwnerCanProposeAndRevoke() public {
        vm.startPrank(alice);
        vm.expectRevert();
        vault.proposeRoute(address(swapRouter), SWAP);
        vm.expectRevert();
        vault.revokeRoute(address(swapRouter), SWAP);
        vm.stopPrank();
    }

    function test_Route_RevokeIsImmediateAndRepeatable() public {
        usdcToken.mint(address(vault), 1000e6);
        pinelyToken.mint(address(swapRouter), 5000e18);
        _allow(address(swapRouter), SWAP);

        vm.expectEmit(true, true, false, false);
        emit RouteRevoked(address(swapRouter), SWAP);
        vault.revokeRoute(address(swapRouter), SWAP);

        assertEq(vault.routeActiveAt(address(swapRouter), SWAP), 0);
        vm.expectRevert(IBurnVault.RouteNotActive.selector);
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 250e6, 1250e18, _swapData(250e6, 1250e18));

        // Revoking something that is not there is an error, and the pair can be proposed again (new delay).
        vm.expectRevert(IBurnVault.RouteNotFound.selector);
        vault.revokeRoute(address(swapRouter), SWAP);
        vault.proposeRoute(address(swapRouter), SWAP);
        assertFalse(vault.isRouteActive(address(swapRouter), SWAP));
    }

    function test_Route_CancelPendingProposal() public {
        vault.proposeRoute(address(swapRouter), SWAP);
        vault.revokeRoute(address(swapRouter), SWAP);
        assertEq(vault.routeActiveAt(address(swapRouter), SWAP), 0);
    }

    function test_Route_InvalidRoutersRejectedAtProposal() public {
        vm.expectRevert(IBurnVault.ZeroAddress.selector);
        vault.proposeRoute(address(0), SWAP);

        vm.expectRevert(IBurnVault.InvalidRouter.selector);
        vault.proposeRoute(address(vault), SWAP);

        vm.expectRevert(IBurnVault.InvalidRouter.selector);
        vault.proposeRoute(address(pinelyToken), IERC20.transfer.selector);
    }

    /// @notice The allowlist can never be used to call a token directly (for example `USDC.transfer(owner, x)`).
    function test_BuybackAndBurn_RouterCannotBeTheSoldToken() public {
        usdcToken.mint(address(vault), 1000e6);
        // Proposing the token as a "router" is possible (it is not known to be the sold token yet) ...
        _allow(address(usdcToken), IERC20.transfer.selector);

        bytes memory drain = abi.encodeWithSelector(IERC20.transfer.selector, address(this), 250e6);
        // ... but using it as the router for a buyback of that same token is refused.
        vm.expectRevert(IBurnVault.InvalidRouter.selector);
        vault.buybackAndBurn(address(usdcToken), address(usdcToken), 250e6, 1, drain);

        assertEq(usdcToken.balanceOf(address(vault)), 1000e6);
    }

    function test_BuybackAndBurn_CannotSellPinelyItself() public {
        pinelyToken.mint(address(vault), 1000e18);
        vm.expectRevert(IBurnVault.InvalidToken.selector);
        vault.buybackAndBurn(address(swapRouter), address(pinelyToken), 100e18, 1, _swapData(100e18, 1));
    }

    // --- C-30: locking the route list ---

    function test_LockRoutes_BlocksNewProposalsForGood() public {
        assertFalse(vault.routesLocked());
        vault.lockRoutes();
        assertTrue(vault.routesLocked());

        vm.expectRevert(IBurnVault.RoutesAreLocked.selector);
        vault.proposeRoute(address(swapRouter), SWAP);

        // Locking twice is an error, not a silent no-op.
        vm.expectRevert(IBurnVault.RoutesAreLocked.selector);
        vault.lockRoutes();
    }

    function test_LockRoutes_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.lockRoutes();
        assertFalse(vault.routesLocked());
    }

    function test_LockRoutes_KeepsExistingRoutesUsableAndRevocable() public {
        usdcToken.mint(address(vault), 1000e6);
        pinelyToken.mint(address(swapRouter), 5000e18);
        _allow(address(swapRouter), SWAP);

        vault.lockRoutes();

        // The route that was already active still works ...
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 100e6, 1, _swapData(100e6, 500e18));

        // ... and the owner can still turn it off, but never add it back.
        vault.revokeRoute(address(swapRouter), SWAP);
        vm.expectRevert(IBurnVault.RouteNotActive.selector);
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 100e6, 1, _swapData(100e6, 500e18));
        vm.expectRevert(IBurnVault.RoutesAreLocked.selector);
        vault.proposeRoute(address(swapRouter), SWAP);
    }

    function test_LockRoutes_KeepsAPendingProposal() public {
        vault.proposeRoute(address(swapRouter), SWAP);
        vault.lockRoutes();

        // A proposal made before the lock is not cancelled by it and still matures.
        vm.warp(vm.getBlockTimestamp() + vault.ROUTE_DELAY());
        assertTrue(vault.isRouteActive(address(swapRouter), SWAP));
    }

    // --- C-30: daily cap ---

    function test_Cap_RejectsMoreThanAQuarterOfTheBalance() public {
        usdcToken.mint(address(vault), 1000e6);
        pinelyToken.mint(address(swapRouter), 50_000e18);
        _allow(address(swapRouter), SWAP);

        vm.expectRevert(IBurnVault.BuybackCapExceeded.selector);
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 250e6 + 1, 1, _swapData(250e6 + 1, 1000e18));

        // Exactly the cap is fine.
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 250e6, 1, _swapData(250e6, 1000e18));
    }

    function test_Cap_IsPerWindowNotPerCall() public {
        usdcToken.mint(address(vault), 1000e6);
        pinelyToken.mint(address(swapRouter), 50_000e18);
        _allow(address(swapRouter), SWAP);

        // Two calls of 100 USDC use 200 of the 250 USDC cap ...
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 100e6, 1, _swapData(100e6, 500e18));
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 100e6, 1, _swapData(100e6, 500e18));

        // ... so a third call that would exceed the window is refused, however it is split.
        vm.expectRevert(IBurnVault.BuybackCapExceeded.selector);
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 51e6, 1, _swapData(51e6, 500e18));
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 50e6, 1, _swapData(50e6, 500e18));
    }

    function test_Cap_ResetsAfterTheWindowAgainstTheNewBalance() public {
        usdcToken.mint(address(vault), 1000e6);
        pinelyToken.mint(address(swapRouter), 50_000e18);
        _allow(address(swapRouter), SWAP);

        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 250e6, 1, _swapData(250e6, 1000e18));
        vm.expectRevert(IBurnVault.BuybackCapExceeded.selector);
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 1e6, 1, _swapData(1e6, 1e18));

        // A day later the cap is 25% of what is left (750 USDC), i.e. 187.5 USDC.
        vm.warp(block.timestamp + vault.BUYBACK_WINDOW());
        vm.expectRevert(IBurnVault.BuybackCapExceeded.selector);
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 187_500_001, 1, _swapData(187_500_001, 1e18));
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 187_500_000, 1, _swapData(187_500_000, 1e18));
    }

    function testFuzz_Cap_BoundaryIsExact(uint256 balance, uint256 amountIn) public {
        balance = bound(balance, 4, 1_000_000_000e6);
        uint256 cap = (balance * vault.MAX_BUYBACK_BPS_PER_DAY()) / 10_000;
        amountIn = bound(amountIn, 1, balance);

        usdcToken.mint(address(vault), balance);
        pinelyToken.mint(address(swapRouter), type(uint128).max);
        _allow(address(swapRouter), SWAP);

        bytes memory swapData = _swapData(amountIn, 1);
        if (amountIn > cap) {
            vm.expectRevert(IBurnVault.BuybackCapExceeded.selector);
        }
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), amountIn, 1, swapData);
    }

    // --- C-30: allowance hygiene and spend check ---

    function test_BuybackAndBurn_ClearsAllowanceAfterTheSwap() public {
        usdcToken.mint(address(vault), 1000e6);
        pinelyToken.mint(address(swapRouter), 5000e18);
        _allow(address(swapRouter), SWAP);

        // The router is approved for 250 USDC but only pulls 100 USDC.
        vault.buybackAndBurn(address(swapRouter), address(usdcToken), 250e6, 1, _swapData(100e6, 500e18));

        assertEq(usdcToken.allowance(address(vault), address(swapRouter)), 0);
    }

    function test_BuybackAndBurn_RevertsIfMoreThanApprovedWasSpent() public {
        DrainingRouter drainer = new DrainingRouter();
        usdcToken.mint(address(vault), 1000e6);
        _allow(address(drainer), DrainingRouter.swapTokens.selector);

        bytes memory swapData = abi.encodeWithSelector(DrainingRouter.swapTokens.selector, address(usdcToken), 100e6, 1);
        vm.expectRevert(IBurnVault.SpentMoreThanApproved.selector);
        vault.buybackAndBurn(address(drainer), address(usdcToken), 100e6, 1, swapData);
    }
}
