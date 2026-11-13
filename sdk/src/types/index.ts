import type { Address, Hash, Hex, PublicClient, WalletClient } from "viem";

export type { Address, Hash, Hex, PublicClient, WalletClient };

export type KeyStoreType = "tpm" | "secure-element" | "file-dev-only";

export type KeyStoreConfig =
  | {
      type: "tpm";
      pcrList?: number[];
      devicePath?: string;
      simulatedEnclave?: boolean;
      deviceUniqueSalt?: string;
    }
  | {
      type: "secure-element";
      slot?: number;
      devicePath?: string;
      simulatedEnclave?: boolean;
      deviceUniqueSalt?: string;
    }
  | { type: "file-dev-only"; privateKey: Hex };

export interface PinelyConfig {
  chain: "robinhoodTestnet" | "robinhoodMainnet";
  registryAddress: Address;
  /** Stage 2 only: undefined until PinelyRouter is deployed. */
  routerAddress?: Address;
  /** Stage 2 only: undefined until PinelyHook is deployed. */
  hookAddress?: Address;
  factoryAddress?: Address;
  paymasterAddress?: Address | null;
  stablecoinAddress?: Address;
  keyStore: KeyStoreConfig;
  rpcUrl?: string;
  entryPointAddress?: Address;
}

export interface AttestationData {
  algorithm: string;
  quote: Hex;
  firmwareHash: Hash;
  timestamp: number;
}

export interface MachinePolicy {
  maxStableOutPerSwap?: bigint;
  dailyStableOutCap?: bigint;
  enabled: boolean;
  allowedAssets?: Address[];
}

export interface MachineOnboardParams {
  name: string;
  operator: Address;
  account?: Address;
  salt?: bigint;
  policy?: MachinePolicy;
  attestation?: AttestationData;
}

export interface MachineRegistrationPayload {
  machineId: Hash;
  account: Address;
  operator: Address;
  signer: Address;
  attestationHash: Hash;
  policy: {
    maxStableOutPerSwap: bigint;
    dailyStableOutCap: bigint;
    enabled: boolean;
  };
}

export interface MachineInfo {
  machineId: Hash;
  account: Address;
  operator: Address;
  signer: Address;
  attestationHash: Hash;
  tier: number;
  frozen: boolean;
  registeredAt: number;
  lastActiveAt: number;
  lastViolationAt: number;
  attestationValid: boolean;
}

export interface SwapIntent {
  machineId: Hash;
  poolId: Hash;
  tokenIn: Address;
  tokenOut: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  nonce: bigint;
  deadline: bigint;
  chainId: bigint;
}

export interface SwapQuoteParams {
  tokenIn: Address;
  amountIn: bigint;
  tokenOut?: Address;
}

export interface SwapQuote {
  amountIn: bigint;
  amountOut: bigint;
  lpFee: bigint;
  protocolFee: bigint;
  estimatedTier: number;
}

export interface SwapParams {
  tokenIn: Address;
  amountIn: bigint;
  minAmountOut: bigint;
  tokenOut?: Address;
  poolKey?: {
    currency0: Address;
    currency1: Address;
    fee: number;
    tickSpacing: number;
    hooks: Address;
  };
  zeroForOne?: boolean;
  deadlineSeconds?: number;
  nonce?: bigint;
}

export interface SwapPrepared {
  intent: SwapIntent;
  signature: Hex;
  hookData: Hex;
  swapRequest: {
    key: {
      currency0: Address;
      currency1: Address;
      fee: number;
      tickSpacing: number;
      hooks: Address;
    };
    zeroForOne: boolean;
    amountIn: bigint;
    minAmountOut: bigint;
    hookData: Hex;
  };
}

export interface SwapResult {
  txHash?: Hash;
  amountIn: bigint;
  amountOut: bigint;
  prepared: SwapPrepared;
}

export interface Payment402Params {
  url: string;
  maxAmount: bigint;
  facilitatorUrl?: string;
  /** Highest facilitator fee accepted, in basis points of the payment. Default 100 (1.00%). */
  maxFeeBps?: number;
}

export interface Payment402Result {
  status: "settled" | "failed";
  resource: string;
  amountStable?: bigint;
  txHash?: Hash;
  accessToken?: string;
  error?: string;
}
