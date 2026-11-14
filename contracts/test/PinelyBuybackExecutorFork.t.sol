// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {Test} from "forge-std/Test.sol";
import {BurnVault} from "../src/BurnVault.sol";
import {IBurnVault} from "../src/interfaces/IBurnVault.sol";
import {PinelyBuybackExecutor} from "../src/PinelyBuybackExecutor.sol";
import {PoolSeeder} from "../src/PoolSeeder.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {MockERC20} from "./utils/MockERC20.sol";

/**
 * @title PinelyBuybackExecutorFork
 * @notice The full buyback path (BurnVault -> PinelyBuybackExecutor -> Uniswap v4) against the REAL PoolManager
 *         deployed on Robinhood Chain mainnet (forked), with realistic token decimals (stablecoin 6, $PINELY 18).
 *         Only fresh test tokens and fresh contracts are created; nothing is sent to the chain.
 *
 *         It doubles as the recipe for seeding the buyback pool: the pool is initialised at a chosen price and
 *         seeded through PoolSeeder with `executor.poolKey()`, exactly what the Stage 2 runbook prescribes.
 *
 *         Needs a network, so it runs only when `RPC_URL_ROBINHOOD_MAINNET` is set and is skipped otherwise:
 *           RPC_URL_ROBINHOOD_MAINNET=<endpoint> forge test --match-contract PinelyBuybackExecutorFork -vv
 */
contract PinelyBuybackExecutorFork is Test {
    uint256 internal constant ROBINHOOD_MAINNET_CHAIN_ID = 4663;
    address internal constant POOL_MANAGER = 0x8366a39CC670B4001A1121B8F6A443A643e40951;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint24 internal constant FEE = 3000; // 0.30%, the decided pool fee
    int24 internal constant SPACING = 60;
    int24 internal constant MAX_TICK = 887_220; // 887272 rounded down to a multiple of 60

    // sqrtPriceX96 for 1 $PINELY = 0.01 USDG with 18 vs 6 decimals.
    //   $PINELY is currency0: raw price (USDG raw per $PINELY raw) = 0.01 * 1e6 / 1e18 = 1e-14  -> sqrt = 1e-7
    //   USDG is currency0:    raw price (PINELY raw per USDG raw)  = 100 * 1e18 / 1e6  = 1e14   -> sqrt = 1e7
    uint160 internal constant SQRT_PRICE_PINELY_FIRST = 7_922_816_251_426_433_759_354;
    uint160 internal constant SQRT_PRICE_USDG_FIRST = 792_281_625_142_643_375_935_439_503_360_000_000;
    // Depth equal to about 1,000,000 USDG and 100,000,000 $PINELY across the whole range.
    int256 internal constant LIQUIDITY = 1e19;

    BurnVault internal vault;
    PinelyBuybackExecutor internal executor;
    PoolSeeder internal seeder;
    MockERC20 internal usdg;
    MockERC20 internal pinely;
    PoolKey internal key;

    function setUp() public {
        string memory rpc = vm.envOr("RPC_URL_ROBINHOOD_MAINNET", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        require(block.chainid == ROBINHOOD_MAINNET_CHAIN_ID, "fork is not Robinhood Chain mainnet");
        require(POOL_MANAGER.code.length > 0, "PoolManager has no code on this fork");
    }

    /// @dev Deploys fresh tokens until $PINELY sorts first (or second), so both directions are covered.
    function _build(bool pinelyFirst) internal {
        for (uint256 i = 0; i < 64; i++) {
            usdg = new MockERC20("USDG", "USDG", 6);
            pinely = new MockERC20("PINELY", "PINELY", 18);
            if ((address(pinely) < address(usdg)) == pinelyFirst) break;
            require(i < 63, "could not order tokens");
        }

        vault = new BurnVault(address(pinely), address(this));
        executor = new PinelyBuybackExecutor(POOL_MANAGER, address(vault), address(pinely), address(usdg), FEE, SPACING);
        seeder = new PoolSeeder(POOL_MANAGER, address(this));
        key = executor.poolKey();

        // Seed the pool at 1 $PINELY = 0.01 USDG, full range, through PoolSeeder.
        seeder.initializePool(key, pinelyFirst ? SQRT_PRICE_PINELY_FIRST : SQRT_PRICE_USDG_FIRST);
        usdg.mint(address(this), 1_000_000_000e6);
        pinely.mint(address(this), 1_000_000_000_000e18);
        usdg.approve(address(seeder), type(uint256).max);
        pinely.approve(address(seeder), type(uint256).max);
        seeder.seed(key, -MAX_TICK, MAX_TICK, LIQUIDITY, address(this), address(this));

        // Stage 2 wiring of the vault: allowlist the executor, wait out the public delay, then lock.
        vault.proposeRoute(address(executor), PinelyBuybackExecutor.buyback.selector);
        vm.warp(vm.getBlockTimestamp() + vault.ROUTE_DELAY());
        vault.lockRoutes();

        usdg.mint(address(vault), 100_000e6); // the vault holds 100,000 USDG of protocol fees
    }

    function _runFullBuyback(bool pinelyFirst) internal {
        _build(pinelyFirst);

        // 25% of the vault's balance is the most it may spend today: 25,000 USDG, worth about 2,500,000 $PINELY.
        uint256 amountIn = 25_000e6;
        uint256 minOut = 2_300_000e18; // tolerates about 8% price impact and the 0.30% fee

        uint256 vaultUsdgBefore = usdg.balanceOf(address(vault));
        bytes memory swapData = abi.encodeCall(executor.buyback, (amountIn, minOut));
        uint256 burned = vault.buybackAndBurn(address(executor), address(usdg), amountIn, minOut, swapData);

        assertGt(burned, minOut, "received at least the minimum");
        assertLt(burned, 2_500_000e18, "paid the fee and some price impact");
        assertEq(pinely.balanceOf(DEAD), burned, "everything bought was burned");
        assertEq(vault.totalBurned(), burned);
        assertEq(vaultUsdgBefore - usdg.balanceOf(address(vault)), amountIn, "vault paid exactly amountIn");
        assertEq(usdg.balanceOf(address(executor)), 0, "executor holds nothing");
        assertEq(pinely.balanceOf(address(executor)), 0, "executor holds nothing");
        assertEq(usdg.allowance(address(vault), address(executor)), 0, "allowance cleared");

        // The daily cap is used up; another buyback the same day is refused.
        vm.expectRevert(IBurnVault.BuybackCapExceeded.selector);
        vault.buybackAndBurn(address(executor), address(usdg), 1e6, 1, abi.encodeCall(executor.buyback, (1e6, 1)));
    }

    function test_Fork_Buyback_PinelyIsCurrency0() public {
        _runFullBuyback(true);
    }

    function test_Fork_Buyback_PinelyIsCurrency1() public {
        _runFullBuyback(false);
    }

    function test_Fork_AfterLock_NoOtherRouteCanBeAdded() public {
        _build(true);
        vm.expectRevert(IBurnVault.RoutesAreLocked.selector);
        vault.proposeRoute(address(0xA77AC), bytes4(0xa9059cbb));
    }

    function test_Fork_Buyback_TooLargeForThePoolIsCaughtByMinOut() public {
        _build(true);
        // The vault can spend up to 25,000 USDG, but a minimum computed for a deeper pool is not met.
        vm.expectRevert(IBurnVault.SwapFailed.selector);
        vault.buybackAndBurn(
            address(executor),
            address(usdg),
            25_000e6,
            2_499_000e18, // asks for 99.96% of the spot-price amount: impossible after fee and impact
            abi.encodeCall(executor.buyback, (25_000e6, 2_499_000e18))
        );
        assertEq(usdg.balanceOf(address(vault)), 100_000e6, "nothing was spent");
    }
}
