// SPDX-License-Identifier: MIT
// @notice Pragma ^0.8.26 so it compiles in the same unit as the PoolManager (=0.8.26).
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PoolSeeder} from "../src/PoolSeeder.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IHooks} from "@uniswap/v4-core/src/interfaces/IHooks.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {PoolManager} from "@uniswap/v4-core/src/PoolManager.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockSeedToken is ERC20 {
    constructor(string memory name, string memory sym) ERC20(name, sym) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Seeding a pool against the real Uniswap v4 PoolManager.
/// The test pool uses a static fee + hooks = address(0) to focus on the seeder's
/// unlock/settle logic; the dynamic-fee path + PinelyHook authorisation is covered by
/// the existing hook tests and the authorise procedure in the deploy script.
contract PoolSeederTest is Test {
    using PoolIdLibrary for PoolKey;

    PoolManager public manager;
    PoolSeeder public seeder;

    MockSeedToken public reward;
    MockSeedToken public usdc;

    address public payer = address(0xBB1);
    address public recipient = address(0xBB2);
    address public stranger = address(0xFF1);

    PoolKey public poolKey;

    uint160 internal constant SQRT_PRICE_1_1 = 79228162514264337593543950336; // 2**96

    function setUp() public {
        reward = new MockSeedToken("Revenue", "REV");
        usdc = new MockSeedToken("USDC", "USDC");

        manager = new PoolManager(address(this));

        address c0 = address(reward) < address(usdc) ? address(reward) : address(usdc);
        address c1 = address(reward) < address(usdc) ? address(usdc) : address(reward);

        poolKey = PoolKey({
            currency0: Currency.wrap(c0),
            currency1: Currency.wrap(c1),
            fee: 3000, // fee statis khusus uji mekanik (address(0) melarang fee dinamis)
            tickSpacing: 60,
            hooks: IHooks(address(0))
        });

        seeder = new PoolSeeder(address(manager), address(this));
    }

    function test_Seeder_InitializeAndSeedEndToEnd() public {
        int24 tick = seeder.initializePool(poolKey, SQRT_PRICE_1_1);
        assertEq(tick, 0, "initial 1:1 tick must be 0");

        reward.mint(payer, 1_000_000e18);
        usdc.mint(payer, 1_000_000e18);

        vm.startPrank(payer);
        reward.approve(address(seeder), type(uint256).max);
        usdc.approve(address(seeder), type(uint256).max);
        vm.stopPrank();

        uint256 payerRewardBefore = reward.balanceOf(payer);
        uint256 payerUsdcBefore = usdc.balanceOf(payer);

        BalanceDelta delta = seeder.seed(poolKey, -6000, 6000, int256(1_000e18), payer, recipient);

        // The pool received tokens (negative delta = the debt to the pool is settled)
        assertLt(delta.amount0(), 0, "pool must receive currency0");
        assertLt(delta.amount1(), 0, "pool must receive currency1");

        bool rewardIsC0 = Currency.unwrap(poolKey.currency0) == address(reward);
        uint256 paid0 = (rewardIsC0 ? payerRewardBefore : payerUsdcBefore)
            - (rewardIsC0 ? reward.balanceOf(payer) : usdc.balanceOf(payer));
        assertGt(paid0, 0, "payer must be debited");

        // Non-custodial: no funds are left sitting in the seeder
        assertEq(reward.balanceOf(address(seeder)), 0, "seeder must not hold reward");
        assertEq(usdc.balanceOf(address(seeder)), 0, "seeder must not hold usdc");

        // The PoolManager holds the liquidity funds
        assertGt(reward.balanceOf(address(manager)), 0, "manager must hold reward");
        assertGt(usdc.balanceOf(address(manager)), 0, "manager must hold usdc");
    }

    function test_Seeder_RevertBukanOwner() public {
        seeder.initializePool(poolKey, SQRT_PRICE_1_1);
        vm.prank(stranger);
        vm.expectRevert();
        seeder.seed(poolKey, -6000, 6000, int256(1_000e18), payer, recipient);
    }

    function test_Seeder_RevertRangeInvalid() public {
        vm.expectRevert(PoolSeeder.InvalidRange.selector);
        seeder.seed(poolKey, 6000, -6000, int256(1_000e18), payer, recipient);

        vm.expectRevert(PoolSeeder.InvalidRange.selector);
        seeder.seed(poolKey, -5999, 6000, int256(1_000e18), payer, recipient);
    }

    function test_Seeder_RevertLiquidityNol() public {
        vm.expectRevert(PoolSeeder.InvalidLiquidity.selector);
        seeder.seed(poolKey, -6000, 6000, 0, payer, recipient);
    }
}
