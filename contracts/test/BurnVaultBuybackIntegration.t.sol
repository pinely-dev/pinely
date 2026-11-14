// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {BurnVault} from "../src/BurnVault.sol";
import {IBurnVault} from "../src/interfaces/IBurnVault.sol";
import {PinelyBuybackExecutor} from "../src/PinelyBuybackExecutor.sol";
import {MockERC20} from "./utils/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta, toBalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/// @dev A fixed-rate stand-in for the PoolManager that follows the canonical delta convention for an
///      exact-input swap: the caller owes the input (negative) and is owed the output (positive).
contract FixedRatePoolManager {
    uint256 public immutable outPerIn;

    constructor(uint256 _outPerIn) {
        outPerIn = _outPerIn;
    }

    function unlock(bytes calldata data) external returns (bytes memory) {
        return IUnlockCallback(msg.sender).unlockCallback(data);
    }

    function swap(PoolKey memory, SwapParams memory params, bytes calldata) external view returns (BalanceDelta) {
        uint128 amountIn = uint128(uint256(-params.amountSpecified));
        uint128 amountOut = uint128(uint256(amountIn) * outPerIn);
        return params.zeroForOne
            ? toBalanceDelta(-int128(amountIn), int128(amountOut))
            : toBalanceDelta(int128(amountOut), -int128(amountIn));
    }

    function sync(Currency) external {}

    function settle() external payable returns (uint256) {
        return 0;
    }

    function take(Currency currency, address to, uint256 amount) external {
        MockERC20(Currency.unwrap(currency)).transfer(to, amount);
    }
}

/// @notice The BurnVault wired to the PinelyBuybackExecutor, the way Stage 2 deploys it.
contract BurnVaultBuybackIntegrationTest is Test {
    BurnVault internal vault;
    PinelyBuybackExecutor internal executor;
    FixedRatePoolManager internal poolManager;
    MockERC20 internal pinely;
    MockERC20 internal usdg;

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    // 1 USDG (1e6 base units) buys 5 PINELY (5e18).
    uint256 internal constant OUT_PER_IN = 5e12;

    function setUp() public {
        pinely = new MockERC20("PINELY", "PINELY", 18);
        usdg = new MockERC20("USDG", "USDG", 6);
        vault = new BurnVault(address(pinely), address(this));
        poolManager = new FixedRatePoolManager(OUT_PER_IN);
        executor =
            new PinelyBuybackExecutor(address(poolManager), address(vault), address(pinely), address(usdg), 3000, 60);

        pinely.mint(address(poolManager), 1_000_000e18);
        usdg.mint(address(vault), 1_000e6);

        // Stage 2 allowlists exactly one route: the executor's `buyback`. Then the public delay passes.
        vault.proposeRoute(address(executor), PinelyBuybackExecutor.buyback.selector);
        vm.warp(vm.getBlockTimestamp() + vault.ROUTE_DELAY());
    }

    function _data(uint256 amountIn, uint256 minOut) internal view returns (bytes memory) {
        return abi.encodeCall(executor.buyback, (amountIn, minOut));
    }

    function test_FullBuybackThroughTheExecutor() public {
        uint256 burned = vault.buybackAndBurn(address(executor), address(usdg), 250e6, 1_250e18, _data(250e6, 1_250e18));

        assertEq(burned, 1_250e18);
        assertEq(pinely.balanceOf(DEAD), 1_250e18, "burned to the dead address");
        assertEq(vault.totalBurned(), 1_250e18);
        assertEq(usdg.balanceOf(address(vault)), 750e6, "vault paid exactly amountIn");
        assertEq(usdg.balanceOf(address(poolManager)), 250e6, "pool received the input");
        assertEq(usdg.allowance(address(vault), address(executor)), 0, "allowance cleared");
        assertEq(usdg.balanceOf(address(executor)), 0);
        assertEq(pinely.balanceOf(address(executor)), 0);
    }

    /// @notice The point of C-30: the only thing the owner can ask the executor for is `buyback`. Every other
    ///         call on it, such as the unlock callback or a view, is outside the allowlist.
    function test_OwnerCannotCallAnythingElseOnTheExecutor() public {
        vm.expectRevert(IBurnVault.RouteNotActive.selector);
        vault.buybackAndBurn(
            address(executor),
            address(usdg),
            250e6,
            1,
            abi.encodeWithSelector(executor.unlockCallback.selector, abi.encode(uint256(250e6), uint256(1)))
        );

        vm.expectRevert(IBurnVault.RouteNotActive.selector);
        vault.buybackAndBurn(address(executor), address(usdg), 250e6, 1, abi.encodeCall(executor.poolKey, ()));
    }

    /// @notice The end state of C-30: with the route list locked, the executor's `buyback` is the only thing the
    ///         vault can ever call, and the owner has no way to add a router of their own.
    function test_AfterLock_OnlyTheExecutorRouteCanEverBeUsed() public {
        vault.lockRoutes();

        // A router the owner controls cannot be added any more, however long they wait.
        address attackerRouter = address(0xA77AC);
        vm.expectRevert(IBurnVault.RoutesAreLocked.selector);
        vault.proposeRoute(attackerRouter, IERC20.transfer.selector);

        // And it cannot be used directly either: it was never allowlisted.
        vm.warp(vm.getBlockTimestamp() + 30 days);
        vm.expectRevert(IBurnVault.RouteNotActive.selector);
        vault.buybackAndBurn(
            attackerRouter, address(usdg), 1e6, 1, abi.encodeWithSelector(IERC20.transfer.selector, address(this), 1e6)
        );

        // The legitimate buyback still works after the lock.
        uint256 burned = vault.buybackAndBurn(address(executor), address(usdg), 250e6, 1_250e18, _data(250e6, 1_250e18));
        assertEq(burned, 1_250e18);

        // The owner can still switch it off (buybacks stop, funds stay in the vault).
        vault.revokeRoute(address(executor), PinelyBuybackExecutor.buyback.selector);
        vm.expectRevert(IBurnVault.RouteNotActive.selector);
        vault.buybackAndBurn(address(executor), address(usdg), 100e6, 1, _data(100e6, 1));
    }

    function test_ExecutorRefusesEveryoneButTheVault() public {
        // The owner of the vault calling the executor directly gets nowhere.
        vm.expectRevert(PinelyBuybackExecutor.NotBurnVault.selector);
        executor.buyback(250e6, 1);
    }

    function test_AnotherExecutorNeedsItsOwnRouteAndDelay() public {
        PinelyBuybackExecutor other =
            new PinelyBuybackExecutor(address(poolManager), address(vault), address(pinely), address(usdg), 500, 10);
        vm.expectRevert(IBurnVault.RouteNotActive.selector);
        vault.buybackAndBurn(
            address(other), address(usdg), 250e6, 1_250e18, abi.encodeCall(other.buyback, (250e6, 1_250e18))
        );

        vault.proposeRoute(address(other), PinelyBuybackExecutor.buyback.selector);
        vm.expectRevert(IBurnVault.RouteNotActive.selector); // proposed just now: the two-day delay applies
        vault.buybackAndBurn(
            address(other), address(usdg), 250e6, 1_250e18, abi.encodeCall(other.buyback, (250e6, 1_250e18))
        );
    }

    function test_VaultCapStillApplies() public {
        vm.expectRevert(IBurnVault.BuybackCapExceeded.selector);
        vault.buybackAndBurn(address(executor), address(usdg), 250e6 + 1, 1, _data(250e6 + 1, 1));
    }

    function test_ExecutorSlippageSurfacesAsSwapFailed() public {
        // The pool pays 1,250 PINELY for 250 USDG; asking for 1,251 makes the executor revert.
        vm.expectRevert(IBurnVault.SwapFailed.selector);
        vault.buybackAndBurn(address(executor), address(usdg), 250e6, 1, _data(250e6, 1_251e18));
        assertEq(usdg.balanceOf(address(vault)), 1_000e6, "nothing was spent");
    }

    /// @notice A token other than the executor's stablecoin cannot be used to move the vault's USDG.
    function test_WrongTokenInCannotMoveTheStablecoin() public {
        MockERC20 other = new MockERC20("Other", "OTH", 6);
        other.mint(address(vault), 1_000e6);

        // The vault approves `other` for the executor, but the executor can only ever pull USDG.
        vm.expectRevert(IBurnVault.SwapFailed.selector);
        vault.buybackAndBurn(address(executor), address(other), 250e6, 1, _data(250e6, 1));

        assertEq(usdg.balanceOf(address(vault)), 1_000e6);
        assertEq(other.balanceOf(address(vault)), 1_000e6);
    }
}
