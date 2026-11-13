// SPDX-License-Identifier: MIT
pragma solidity 0.8.34;

import {PoolKey} from "@uniswap/v4-core/src/types/PoolKey.sol";

/**
 * @title IPinelyRouter
 * @notice Single swap entry point dedicated to machines in the PINELY ecosystem.
 */
interface IPinelyRouter {
    struct SwapIntent {
        bytes32 machineId;
        bytes32 poolId;
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint256 minAmountOut;
        uint256 nonce;
        uint64 deadline;
        uint256 chainId;
    }

    struct SwapRequest {
        PoolKey key;
        bool zeroForOne;
        uint128 amountIn;
        uint128 minAmountOut;
        bytes hookData; // abi.encode(SwapIntent, bytes signature)
    }

    event MachineSwap(
        bytes32 indexed machineId,
        address indexed account,
        address tokenIn,
        uint256 amountIn,
        uint256 amountOut,
        uint256 protocolFee
    );

    error NotAuthorized();
    error IntentExpired();
    error InvalidChainId();
    error MachineIdMismatch();
    error HookMismatch();
    error PoolMismatch();
    error TokenMismatch();
    error AmountMismatch();
    error SlippageExceeded();
    error ZeroAddress();
    error PoolNotUnlocked();

    function swap(SwapRequest calldata req) external returns (uint256 amountOut);
}
