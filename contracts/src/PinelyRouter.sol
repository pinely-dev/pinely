// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {IPoolManager} from "@uniswap/v4-core/src/interfaces/IPoolManager.sol";
import {IUnlockCallback} from "@uniswap/v4-core/src/interfaces/callback/IUnlockCallback.sol";
import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";
import {PoolId, PoolIdLibrary} from "@uniswap/v4-core/src/types/PoolId.sol";
import {Currency} from "@uniswap/v4-core/src/types/Currency.sol";
import {BalanceDelta} from "@uniswap/v4-core/src/types/BalanceDelta.sol";
import {SwapParams} from "@uniswap/v4-core/src/types/PoolOperation.sol";
import {TickMath} from "@uniswap/v4-core/src/libraries/TickMath.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IPinelyRouter} from "./interfaces/IPinelyRouter.sol";
import {IPinelyHook} from "./interfaces/IPinelyHook.sol";
import {IMachineRegistry} from "./interfaces/IMachineRegistry.sol";

/**
 * @title PinelyRouter
 * @notice The only entry point for PINELY machine pool swaps into Uniswap v4.
 *         Stateless, ownerless, and holds no funds.
 *         Binds the Machine Account identity (msg.sender) to the machineId in the signature,
 *         then forwards hookData unmodified to the PoolManager.
 */
contract PinelyRouter is IPinelyRouter, IUnlockCallback, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using PoolIdLibrary for PoolKey;

    uint256 public constant PROTOCOL_FEE_BPS = 500; // 0.05% in 1e6 basis

    IPoolManager public immutable poolManager;
    IMachineRegistry public immutable registry;
    address public immutable pinelyHook;
    address public immutable stablecoin;

    constructor(address _poolManager, address _registry, address _pinelyHook, address _stablecoin) {
        if (
            _poolManager == address(0) || _registry == address(0) || _pinelyHook == address(0)
                || _stablecoin == address(0)
        ) {
            revert ZeroAddress();
        }

        poolManager = IPoolManager(_poolManager);
        registry = IMachineRegistry(_registry);
        pinelyHook = _pinelyHook;
        stablecoin = _stablecoin;
    }

    /**
     * @notice Starts swapping machine revenue into stablecoin.
     * @param req Swap parameters and the hookData signature.
     * @return amountOut Net stablecoin received by the Machine Account.
     */
    function swap(SwapRequest calldata req) external override nonReentrant returns (uint256 amountOut) {
        if (req.minAmountOut == 0) revert SlippageExceeded();
        (SwapIntent memory intent,) = abi.decode(req.hookData, (SwapIntent, bytes));

        bytes32 registeredMachineId = registry.machineIdOf(msg.sender);
        if (registeredMachineId == bytes32(0) || intent.machineId != registeredMachineId) {
            revert MachineIdMismatch();
        }

        if (address(req.key.hooks) != pinelyHook) revert HookMismatch();
        if (PoolId.unwrap(req.key.toId()) != intent.poolId) revert PoolMismatch();
        if (intent.chainId != block.chainid) revert InvalidChainId();

        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > intent.deadline) revert IntentExpired();
        if (req.amountIn != intent.amountIn) revert AmountMismatch();
        if (req.minAmountOut < intent.minAmountOut) revert SlippageExceeded();
        if (intent.tokenOut != stablecoin) revert TokenMismatch();

        address expectedIn = req.zeroForOne ? Currency.unwrap(req.key.currency0) : Currency.unwrap(req.key.currency1);
        address expectedOut = req.zeroForOne ? Currency.unwrap(req.key.currency1) : Currency.unwrap(req.key.currency0);

        if (expectedIn != intent.tokenIn || expectedOut != intent.tokenOut) {
            revert TokenMismatch();
        }

        // forge-lint: disable-next-line(reentrancy-no-eth)
        bytes memory returnData = poolManager.unlock(abi.encode(req, msg.sender));
        amountOut = abi.decode(returnData, (uint256));
    }

    /**
     * @notice Callback from the Uniswap v4 PoolManager once the pool is unlocked.
     */
    function unlockCallback(bytes calldata data) external override returns (bytes memory) {
        if (msg.sender != address(poolManager)) revert NotAuthorized();

        (SwapRequest memory req, address sender) = abi.decode(data, (SwapRequest, address));

        SwapParams memory params = SwapParams({
            zeroForOne: req.zeroForOne,
            amountSpecified: -int256(uint256(req.amountIn)),
            sqrtPriceLimitX96: req.zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1
        });

        BalanceDelta delta = poolManager.swap(req.key, params, req.hookData);

        int128 amount0 = delta.amount0();
        int128 amount1 = delta.amount1();

        int128 rawAmountIn = req.zeroForOne ? amount0 : amount1;
        int128 rawAmountOut = req.zeroForOne ? amount1 : amount0;

        // Delta sign defence: handle both positive and negative sign conventions defensively
        uint128 actualAmountIn = rawAmountIn < 0 ? uint128(-rawAmountIn) : uint128(rawAmountIn);
        uint128 grossAmountOut = rawAmountOut < 0 ? uint128(-rawAmountOut) : uint128(rawAmountOut);

        uint128 protocolFee = uint128((uint256(grossAmountOut) * PROTOCOL_FEE_BPS) / 1_000_000);
        uint128 netAmountOut = grossAmountOut - protocolFee;

        if (netAmountOut < req.minAmountOut) revert SlippageExceeded();

        Currency currencyIn = req.zeroForOne ? req.key.currency0 : req.key.currency1;
        Currency currencyOut = req.zeroForOne ? req.key.currency1 : req.key.currency0;

        // 1. Settle the input token from the sender (Machine Account) to the PoolManager
        poolManager.sync(currencyIn);
        // forge-lint: disable-next-line(arbitrary-send-erc20)
        IERC20(Currency.unwrap(currencyIn)).safeTransferFrom(sender, address(poolManager), actualAmountIn);
        // forge-lint: disable-next-line(unused-return)
        poolManager.settle();

        // 2. Take the output token (stablecoin) straight to the Machine Account and the fee recipients
        poolManager.take(currencyOut, sender, netAmountOut);

        if (protocolFee > 0) {
            uint256 burnFee = (uint256(protocolFee) * 2000) / 10000; // 20% to the BurnVault
            uint256 treasuryFee = uint256(protocolFee) - burnFee; // 80% to the Treasury

            address burnVault = IPinelyHook(pinelyHook).burnVault();
            address treasury = IPinelyHook(pinelyHook).treasury();

            if (burnFee > 0 && burnVault != address(0)) {
                poolManager.take(currencyOut, burnVault, burnFee);
            }
            if (treasuryFee > 0 && treasury != address(0)) {
                poolManager.take(currencyOut, treasury, treasuryFee);
            }
        }

        (SwapIntent memory intent,) = abi.decode(req.hookData, (SwapIntent, bytes));
        // forge-lint: disable-next-line(reentrancy-events)
        emit MachineSwap(intent.machineId, sender, intent.tokenIn, actualAmountIn, netAmountOut, protocolFee);

        return abi.encode(uint256(netAmountOut));
    }
}
