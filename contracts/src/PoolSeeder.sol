// SPDX-License-Identifier: MIT
// @notice Pragma relaxed (^0.8.26, instead of exactly 0.8.34 like the other contracts)
// so it compiles in the same unit as the Uniswap v4 PoolManager (=0.8.26) under test.
// This mirrors the Uniswap v4 toolchain, which mixes solc versions per file.
pragma solidity ^0.8.26;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {ModifyLiquidityParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";

/**
 * @title PoolSeeder
 * @notice Operational helper to initialise the PINELY Uniswap v4 pool and
 *         provide initial liquidity from the official treasury/LP.
 *         Non-custodial: pulls tokens from the payer via allowance and
 *         holds no funds. Ownership should be handed over to the
 *         treasury multisig once seeding is finished.
 * @dev Only supports adding liquidity (liquidityDelta > 0).
 *      Removing liquidity is the LP's responsibility, directly via the PoolManager.
 */
contract PoolSeeder is Ownable, IUnlockCallback {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    IPoolManager public immutable poolManager;

    error ZeroAddress();
    error InvalidRange();
    error InvalidLiquidity();
    error NotAuthorized();

    event PoolSeeded(bytes32 indexed poolId, int256 liquidityDelta, address indexed payer, address indexed recipient);

    constructor(address _poolManager, address initialOwner) Ownable(initialOwner) {
        if (_poolManager == address(0) || initialOwner == address(0)) revert ZeroAddress();
        poolManager = IPoolManager(_poolManager);
    }

    /**
     * @notice Initialises the pool at its starting price. Needs no unlock callback.
     * @dev Reverts if the pool is already initialised; call once per pool.
     */
    function initializePool(PoolKey memory key, uint160 sqrtPriceX96) external onlyOwner returns (int24 tick) {
        if (sqrtPriceX96 == 0) revert InvalidLiquidity();
        return poolManager.initialize(key, sqrtPriceX96);
    }

    /**
     * @notice Adds initial liquidity on a valid tick range.
     * @param payer Address that supplies the tokens (must approve this contract first).
     * @param recipient Receiver of any excess/position (usually the treasury/LP).
     */
    function seed(
        PoolKey memory key,
        int24 tickLower,
        int24 tickUpper,
        int256 liquidityDelta,
        address payer,
        address recipient
    ) external onlyOwner returns (BalanceDelta delta) {
        if (payer == address(0) || recipient == address(0)) revert ZeroAddress();
        if (tickLower >= tickUpper) revert InvalidRange();
        if (key.tickSpacing != 0 && (tickLower % key.tickSpacing != 0 || tickUpper % key.tickSpacing != 0)) {
            revert InvalidRange();
        }
        if (liquidityDelta <= 0) revert InvalidLiquidity();

        bytes memory ret = poolManager.unlock(
            abi.encode(key, ModifyLiquidityParams(tickLower, tickUpper, liquidityDelta, bytes32(0)), payer, recipient)
        );
        delta = abi.decode(ret, (BalanceDelta));
        emit PoolSeeded(PoolId.unwrap(key.toId()), liquidityDelta, payer, recipient);
    }

    /**
     * @notice Callback from the PoolManager: runs modifyLiquidity and then
     *         settles the delta (pays what is owed, takes what is due).
     */
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotAuthorized();
        (PoolKey memory key, ModifyLiquidityParams memory params, address payer, address recipient) =
            abi.decode(data, (PoolKey, ModifyLiquidityParams, address, address));

        BalanceDelta principalDelta;
        (principalDelta,) = poolManager.modifyLiquidity(key, params, "");

        _settle(key.currency0, principalDelta.amount0(), payer, recipient);
        _settle(key.currency1, principalDelta.amount1(), payer, recipient);
        return abi.encode(principalDelta);
    }

    function _settle(Currency currency, int128 amount, address payer, address recipient) internal {
        if (amount < 0) {
            uint256 owed = uint256(uint128(-amount));
            poolManager.sync(currency);
            IERC20(Currency.unwrap(currency)).safeTransferFrom(payer, address(poolManager), owed);
            // forge-lint: disable-next-line(unused-return)
            poolManager.settle();
        } else if (amount > 0) {
            poolManager.take(currency, recipient, uint256(uint128(amount)));
        }
    }
}
