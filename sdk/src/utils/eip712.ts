import { type Address, type Hash, type Hex, encodeAbiParameters, keccak256 } from "viem";
import type { SwapIntent } from "../types/index.js";

/**
 * Canonical EIP-712 domain for PINELY Hook on Robinhood Chain.
 */
export function getPinelyDomain(hookAddress: Address, chainId: bigint) {
  return {
    name: "PINELY",
    version: "1",
    chainId: Number(chainId),
    verifyingContract: hookAddress,
  } as const;
}

/**
 * Canonical EIP-712 domain for PINELY HTTP 402 Facilitator.
 */
export function getPinelyFacilitatorDomain(verifyingContract: Address, chainId: bigint) {
  return {
    name: "PINELYFacilitator",
    version: "1",
    chainId: Number(chainId),
    verifyingContract,
  } as const;
}

export const SWAP_INTENT_TYPES = {
  SwapIntent: [
    { name: "machineId", type: "bytes32" },
    { name: "poolId", type: "bytes32" },
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "minAmountOut", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "chainId", type: "uint256" },
  ],
} as const;

export const PAYMENT_402_TYPES = {
  Payment402Intent: [
    { name: "machineId", type: "bytes32" },
    { name: "resource", type: "string" },
    { name: "amountStable", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

export const SWAP_INTENT_ABI_PARAM = {
  type: "tuple",
  components: [
    { name: "machineId", type: "bytes32" },
    { name: "poolId", type: "bytes32" },
    { name: "tokenIn", type: "address" },
    { name: "tokenOut", type: "address" },
    { name: "amountIn", type: "uint256" },
    { name: "minAmountOut", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "chainId", type: "uint256" },
  ],
} as const;

/**
 * Encodes hookData to forward to PinelyRouter and PinelyHook:
 * abi.encode(SwapIntent intent, bytes signature)
 */
export function encodeHookData(intent: SwapIntent, signature: Hex): Hex {
  return encodeAbiParameters([SWAP_INTENT_ABI_PARAM, { type: "bytes" }], [intent, signature]);
}

/**
 * Computes canonical Uniswap v4 PoolId: keccak256(abi.encode(PoolKey))
 */
export function computePoolId(key: {
  currency0: Address;
  currency1: Address;
  fee: number;
  tickSpacing: number;
  hooks: Address;
}): Hash {
  return keccak256(
    encodeAbiParameters(
      [
        { type: "address" },
        { type: "address" },
        { type: "uint24" },
        { type: "int24" },
        { type: "address" },
      ],
      [key.currency0, key.currency1, key.fee, key.tickSpacing, key.hooks],
    ),
  );
}
