// SPDX-License-Identifier: MIT
// @notice Pragma ^0.8.26 so it compiles in the same unit as the real PoolManager (=0.8.26).
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PinelyBuybackExecutor} from "../src/PinelyBuybackExecutor.sol";
import {PoolSeeder} from "../src/PoolSeeder.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {LPFeeLibrary} from "@uniswap/v4-core/src/libraries/LPFeeLibrary.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ExecTestToken is ERC20 {
    constructor(string memory name, string memory sym) ERC20(name, sym) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Behaves like the BurnVault does for the executor: approves exactly `amountIn`, then calls it.
contract MockVaultCaller {
    function buy(PinelyBuybackExecutor executor, address stable, uint256 amountIn, uint256 minOut)
        external
        returns (uint256)
    {
        IERC20(stable).approve(address(executor), amountIn);
        return executor.buyback(amountIn, minOut);
    }

    function rawCall(PinelyBuybackExecutor executor, uint256 amountIn, uint256 minOut) external returns (uint256) {
        return executor.buyback(amountIn, minOut);
    }
}

/// @notice The executor against the REAL Uniswap v4 PoolManager and a real pool seeded by PoolSeeder.
contract PinelyBuybackExecutorTest is Test {
    event BuybackExecuted(uint256 stablecoinIn, uint256 pinelyOut);

    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336; // 2**96
    uint24 internal constant FEE = 3000;
    int24 internal constant SPACING = 60;

    PoolManager internal manager;
    PoolSeeder internal seeder;
    address internal stranger = address(0xBAD);

    struct Env {
        ExecTestToken stable;
        ExecTestToken pinely;
        MockVaultCaller vault;
        PinelyBuybackExecutor executor;
    }

    function setUp() public {
        manager = new PoolManager(address(this));
        seeder = new PoolSeeder(address(manager), address(this));
    }

    /// @dev Deploys fresh tokens until the stablecoin sorts before (or after) $PINELY, so both swap directions are covered.
    function _tokens(bool stableFirst) internal returns (ExecTestToken stable, ExecTestToken pinely) {
        for (uint256 i = 0; i < 64; i++) {
            stable = new ExecTestToken("Stable", "STB");
            pinely = new ExecTestToken("PINELY", "PINELY");
            if ((address(stable) < address(pinely)) == stableFirst) return (stable, pinely);
        }
        revert("could not order tokens");
    }

    /// @dev A full environment: pool initialised at 1:1 and seeded with `liquidity`, executor bound to the vault.
    function _env(bool stableFirst, int256 liquidity) internal returns (Env memory e) {
        (e.stable, e.pinely) = _tokens(stableFirst);
        e.vault = new MockVaultCaller();
        e.executor = new PinelyBuybackExecutor(
            address(manager), address(e.vault), address(e.pinely), address(e.stable), FEE, SPACING
        );

        PoolKey memory key = e.executor.poolKey();
        seeder.initializePool(key, SQRT_PRICE_1_1);

        e.stable.mint(address(this), 100_000_000e18);
        e.pinely.mint(address(this), 100_000_000e18);
        e.stable.approve(address(seeder), type(uint256).max);
        e.pinely.approve(address(seeder), type(uint256).max);
        seeder.seed(key, -6000, 6000, liquidity, address(this), address(this));

        // The vault holds the stablecoin it will sell.
        e.stable.mint(address(e.vault), 1_000_000e18);
    }

    // --- Happy path, both pool orderings ---

    function _assertHappyPath(bool stableFirst) internal {
        Env memory e = _env(stableFirst, 1_000_000e18);
        uint256 amountIn = 1_000e18;

        uint256 vaultStableBefore = e.stable.balanceOf(address(e.vault));
        uint256 managerStableBefore = e.stable.balanceOf(address(manager));

        vm.expectEmit(false, false, false, false);
        emit BuybackExecuted(amountIn, 0);
        uint256 out = e.vault.buy(e.executor, address(e.stable), amountIn, 990e18);

        // 0.3% fee and a negligible price impact: close to 1:1, never above it.
        assertGt(out, 990e18, "fair price");
        assertLt(out, amountIn, "fee is paid");

        // The vault paid exactly amountIn and received all of the output.
        assertEq(vaultStableBefore - e.stable.balanceOf(address(e.vault)), amountIn, "vault paid amountIn");
        assertEq(e.pinely.balanceOf(address(e.vault)), out, "vault received everything");
        assertEq(e.stable.balanceOf(address(manager)) - managerStableBefore, amountIn, "pool received the input");

        // The executor never holds anything, and nobody else received a token.
        assertEq(e.stable.balanceOf(address(e.executor)), 0);
        assertEq(e.pinely.balanceOf(address(e.executor)), 0);
        assertEq(e.pinely.balanceOf(stranger), 0);
        assertEq(e.stable.allowance(address(e.vault), address(e.executor)), 0, "allowance fully used");
    }

    function test_Buyback_StablecoinIsCurrency0() public {
        _assertHappyPath(true);
    }

    function test_Buyback_StablecoinIsCurrency1() public {
        _assertHappyPath(false);
    }

    // --- Access control: who can do what ---

    function test_Buyback_OnlyTheBurnVault() public {
        Env memory e = _env(true, 1_000_000e18);
        vm.prank(stranger);
        vm.expectRevert(PinelyBuybackExecutor.NotBurnVault.selector);
        e.executor.buyback(1e18, 1);

        // Even the test contract (a would-be owner) cannot call it.
        vm.expectRevert(PinelyBuybackExecutor.NotBurnVault.selector);
        e.executor.buyback(1e18, 1);
    }

    function test_UnlockCallback_OnlyThePoolManager() public {
        Env memory e = _env(true, 1_000_000e18);
        vm.expectRevert(PinelyBuybackExecutor.NotAuthorized.selector);
        e.executor.unlockCallback(abi.encode(uint256(1e18), uint256(1)));
    }

    // --- Argument checks ---

    function test_Buyback_RejectsZeroAmountAndZeroMinOut() public {
        Env memory e = _env(true, 1_000_000e18);

        vm.expectRevert(PinelyBuybackExecutor.InvalidAmount.selector);
        e.vault.rawCall(e.executor, 0, 1);

        vm.expectRevert(PinelyBuybackExecutor.InvalidAmount.selector);
        e.vault.rawCall(e.executor, uint256(uint128(type(int128).max)) + 1, 1);

        vm.expectRevert(PinelyBuybackExecutor.ZeroMinOut.selector);
        e.vault.rawCall(e.executor, 1e18, 0);
    }

    // --- Slippage and thin pools ---

    function test_Buyback_RevertsBelowMinOut() public {
        Env memory e = _env(true, 1_000_000e18);
        // A fair quote is just under 1,000; asking for exactly 1,000 cannot be met after the 0.3% fee.
        vm.expectRevert(PinelyBuybackExecutor.SlippageExceeded.selector);
        e.vault.buy(e.executor, address(e.stable), 1_000e18, 1_000e18);
    }

    function test_Buyback_ThinPoolIsCaughtByMinOut() public {
        Env memory e = _env(true, 1_000e18); // very thin pool
        // Selling 100,000 into a pool this thin moves the price a long way; a fair-price minOut protects the vault.
        vm.expectRevert(PinelyBuybackExecutor.SlippageExceeded.selector);
        e.vault.buy(e.executor, address(e.stable), 100_000e18, 99_000e18);
    }

    function test_Buyback_UninitialisedPoolReverts() public {
        (ExecTestToken stable, ExecTestToken pinely) = _tokens(true);
        MockVaultCaller vault = new MockVaultCaller();
        PinelyBuybackExecutor executor =
            new PinelyBuybackExecutor(address(manager), address(vault), address(pinely), address(stable), FEE, SPACING);
        stable.mint(address(vault), 1_000e18);

        vm.expectRevert();
        vault.buy(executor, address(stable), 100e18, 1);
    }

    function test_Buyback_MissingAllowanceReverts() public {
        Env memory e = _env(true, 1_000_000e18);
        // Called without the vault approving first: the pull from the vault fails.
        vm.expectRevert();
        e.vault.rawCall(e.executor, 100e18, 1);
    }

    // --- Immutable configuration ---

    function test_PoolKey_IsFixedAndHookless() public {
        (ExecTestToken stable, ExecTestToken pinely) = _tokens(true);
        PinelyBuybackExecutor executor =
            new PinelyBuybackExecutor(address(manager), address(0xB0B), address(pinely), address(stable), FEE, SPACING);
        PoolKey memory key = executor.poolKey();

        assertEq(Currency.unwrap(key.currency0), address(stable));
        assertEq(Currency.unwrap(key.currency1), address(pinely));
        assertEq(key.fee, FEE);
        assertEq(key.tickSpacing, SPACING);
        assertEq(address(key.hooks), address(0));
        assertEq(executor.burnVault(), address(0xB0B));
    }

    function test_Constructor_RejectsBadConfig() public {
        (ExecTestToken stable, ExecTestToken pinely) = _tokens(true);
        address pm = address(manager);
        address s = address(stable);
        address p = address(pinely);
        address v = address(0xB0B);

        vm.expectRevert(PinelyBuybackExecutor.ZeroAddress.selector);
        new PinelyBuybackExecutor(address(0), v, p, s, FEE, SPACING);
        vm.expectRevert(PinelyBuybackExecutor.ZeroAddress.selector);
        new PinelyBuybackExecutor(pm, address(0), p, s, FEE, SPACING);
        vm.expectRevert(PinelyBuybackExecutor.ZeroAddress.selector);
        new PinelyBuybackExecutor(pm, v, address(0), s, FEE, SPACING);
        vm.expectRevert(PinelyBuybackExecutor.ZeroAddress.selector);
        new PinelyBuybackExecutor(pm, v, p, address(0), FEE, SPACING);

        // The pool manager must be a contract.
        vm.expectRevert(PinelyBuybackExecutor.InvalidPoolConfig.selector);
        new PinelyBuybackExecutor(address(0x1234), v, p, s, FEE, SPACING);

        // One token cannot be both sides.
        vm.expectRevert(PinelyBuybackExecutor.InvalidPoolConfig.selector);
        new PinelyBuybackExecutor(pm, v, p, p, FEE, SPACING);

        // Fee: above the maximum, and the dynamic-fee flag.
        vm.expectRevert(PinelyBuybackExecutor.InvalidPoolConfig.selector);
        new PinelyBuybackExecutor(pm, v, p, s, LPFeeLibrary.MAX_LP_FEE + 1, SPACING);
        vm.expectRevert(PinelyBuybackExecutor.InvalidPoolConfig.selector);
        new PinelyBuybackExecutor(pm, v, p, s, LPFeeLibrary.DYNAMIC_FEE_FLAG, SPACING);

        // Tick spacing: zero, negative, and above the maximum.
        vm.expectRevert(PinelyBuybackExecutor.InvalidPoolConfig.selector);
        new PinelyBuybackExecutor(pm, v, p, s, FEE, 0);
        vm.expectRevert(PinelyBuybackExecutor.InvalidPoolConfig.selector);
        new PinelyBuybackExecutor(pm, v, p, s, FEE, -1);
        vm.expectRevert(PinelyBuybackExecutor.InvalidPoolConfig.selector);
        new PinelyBuybackExecutor(pm, v, p, s, FEE, TickMath.MAX_TICK_SPACING + 1);
    }

    // --- Fuzz: the executor never keeps funds and the vault is always paid in full ---

    function testFuzz_Buyback_NeverKeepsFundsAndPaysTheVault(uint256 amountIn, bool stableFirst) public {
        Env memory e = _env(stableFirst, 1_000_000e18);
        amountIn = bound(amountIn, 1e6, 50_000e18);

        uint256 vaultStableBefore = e.stable.balanceOf(address(e.vault));
        uint256 out = e.vault.buy(e.executor, address(e.stable), amountIn, 1);

        assertGt(out, 0);
        assertEq(e.pinely.balanceOf(address(e.vault)), out, "vault is paid in full");
        assertEq(e.stable.balanceOf(address(e.executor)), 0);
        assertEq(e.pinely.balanceOf(address(e.executor)), 0);
        assertEq(e.stable.balanceOf(address(e.vault)), vaultStableBefore - amountIn, "exactly amountIn was spent");
    }
}
