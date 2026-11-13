import {
  type Address,
  type Hash,
  type Hex,
  encodeFunctionData,
  isAddress,
  keccak256,
  toBytes,
  type PublicClient,
  type WalletClient,
} from "viem";
import {
  findContractAddress,
  pinelyRouterAbi,
  machineRegistryAbi,
  surplusSweeperAbi,
} from "@pinely/shared/contracts";
import type { IKeyStore } from "./keystore/index.js";
import type {
  MachineInfo,
  MachinePolicy,
  Payment402Params,
  Payment402Result,
  SwapParams,
  SwapPrepared,
  SwapQuote,
  SwapQuoteParams,
  SwapResult,
} from "./types/index.js";
import {
  computePoolId,
  encodeHookData,
  getPinelyDomain,
  getPinelyFacilitatorDomain,
  PAYMENT_402_TYPES,
  SWAP_INTENT_TYPES,
} from "./utils/eip712.js";
import { verifyPreparedSettlement, type PreparedSettlement } from "./utils/userop.js";

/** The subset of an x402 payment requirement this SDK reads. */
interface X402Accept {
  asset?: string;
  payTo?: string;
  maxAmountRequired?: string;
  resource?: string;
  extra?: { chainId?: number | string };
}

// Dynamic Uniswap v4 LP fee tiers (basis 1e6: 1_000_000 = 100%)
const FEE_BRONZE = 3000n; // 0.30%
const FEE_SILVER = 1500n; // 0.15%
const FEE_GOLD = 500n; // 0.05%
const PROTOCOL_FEE = 500n; // 0.05%

let monotonicNonceCounter = 0n;

function randomSeed32(): bigint {
  try {
    const g = globalThis as unknown as {
      crypto?: { getRandomValues?: (a: Uint32Array) => void };
    };
    const buf = new Uint32Array(1);
    g.crypto?.getRandomValues?.(buf);
    if (buf[0] !== 0) return BigInt(buf[0]);
  } catch {
    // fallback to Math.random below
  }
  return BigInt(Math.floor(Math.random() * 2 ** 32));
}

// Random seed at startup: prevents nonce collisions if two processes
// restart within the same microsecond with a counter starting at 0.
monotonicNonceCounter = randomSeed32() % 1000n;

function getMonotonicNonce(): bigint {
  const microNow = BigInt(Date.now()) * 1000n;
  monotonicNonceCounter = (monotonicNonceCounter + 1n) % 1000n;
  return microNow + monotonicNonceCounter;
}

/**
 * Fail-closed SSOT address resolution for MachineClient.
 * A missing address is a configuration error on every network: there are no dummy fallbacks.
 */
function resolveMachineAddress(chainId: bigint, name: "STABLECOIN"): Address {
  const found = findContractAddress(Number(chainId), name);
  if (found) return found as Address;
  throw new Error(
    `[PINELY] SSOT address "${name}" not found on chain ${chainId}. ` +
      `Pass it explicitly in the config, or deploy and run \`bun run sync\` (external addresses live in shared/contracts/external.ts).`,
  );
}

export class MachineClient {
  readonly machineId: Hash;
  readonly name: string;
  readonly operator: Address;
  readonly account: Address;
  readonly keyStore: IKeyStore;
  readonly routerAddress?: Address;
  readonly registryAddress: Address;
  readonly hookAddress?: Address;
  readonly stablecoinAddress: Address;
  readonly paymasterAddress?: Address;
  readonly chainId: bigint;
  readonly publicClient?: PublicClient;

  constructor(options: {
    machineId: Hash;
    name: string;
    operator: Address;
    account: Address;
    keyStore: IKeyStore;
    routerAddress?: Address;
    registryAddress: Address;
    hookAddress?: Address;
    stablecoinAddress?: Address;
    paymasterAddress?: Address | null;
    chainId: bigint;
    publicClient?: PublicClient;
  }) {
    this.machineId = options.machineId;
    this.name = options.name;
    this.operator = options.operator;
    this.account = options.account;
    this.keyStore = options.keyStore;
    this.routerAddress = options.routerAddress;
    this.registryAddress = options.registryAddress;
    this.hookAddress =
      options.hookAddress ?? findContractAddress(Number(options.chainId), "PinelyHook");
    this.stablecoinAddress =
      options.stablecoinAddress ?? resolveMachineAddress(options.chainId, "STABLECOIN");
    this.paymasterAddress =
      options.paymasterAddress === null
        ? undefined
        : (options.paymasterAddress ??
          findContractAddress(Number(options.chainId), "PinelyPaymaster"));
    this.chainId = options.chainId;
    this.publicClient = options.publicClient;
  }

  /** PinelyHook exists only from Stage 2; swaps are impossible before that. */
  private requireHook(): Address {
    if (!this.hookAddress) {
      throw new Error(
        `[PINELY] PinelyHook is not deployed on chain ${this.chainId} (Stage 2). Swaps are unavailable.`,
      );
    }
    return this.hookAddress;
  }

  private requireRouter(): Address {
    if (!this.routerAddress) {
      throw new Error(
        `[PINELY] PinelyRouter is not deployed on chain ${this.chainId} (Stage 2). Swaps are unavailable.`,
      );
    }
    return this.routerAddress;
  }

  /**
   * Returns machine session key address from the keystore module.
   */
  async getSigner(): Promise<Address> {
    return this.keyStore.getAddress();
  }

  /**
   * Computes expected swap output and dynamic PINELY fee tier.
   * Bronze: 0.30% LP + 0.05% Protocol
   * Silver: 0.15% LP + 0.05% Protocol
   * Gold:   0.05% LP + 0.05% Protocol
   */
  async quoteSwap(params: SwapQuoteParams): Promise<SwapQuote> {
    let tier = 0; // Default Bronze
    if (this.publicClient) {
      try {
        tier = (await this.publicClient.readContract({
          address: this.registryAddress,
          abi: machineRegistryAbi,
          functionName: "tierOf",
          args: [this.machineId],
        })) as number;
      } catch {
        tier = 0;
      }
    }

    let lpFeeBps = FEE_BRONZE;
    if (tier === 1) lpFeeBps = FEE_SILVER;
    if (tier === 2) lpFeeBps = FEE_GOLD;

    const lpFee = (params.amountIn * lpFeeBps) / 1_000_000n;
    const protocolFee = (params.amountIn * PROTOCOL_FEE) / 1_000_000n;
    const amountOut =
      params.amountIn > lpFee + protocolFee ? params.amountIn - lpFee - protocolFee : 0n;

    return {
      amountIn: params.amountIn,
      amountOut,
      lpFee,
      protocolFee,
      estimatedTier: tier,
    };
  }

  /**
   * Prepares and signs EIP-712 SwapIntent with session key in TPM/keystore,
   * encoding hookData ready for Uniswap v4 PinelyRouter.
   */
  async prepareSwap(params: SwapParams): Promise<SwapPrepared> {
    if (params.minAmountOut <= 0n) {
      throw new Error("minAmountOut must be greater than 0 for slippage protection.");
    }

    const hookAddress = this.requireHook();
    const tokenOut = params.tokenOut ?? this.stablecoinAddress;
    const deadline = BigInt(Math.floor(Date.now() / 1000) + (params.deadlineSeconds ?? 300));
    const nonce = params.nonce ?? getMonotonicNonce();

    // Build canonical PoolKey if not provided
    const poolKey = params.poolKey ?? {
      currency0: params.tokenIn.toLowerCase() < tokenOut.toLowerCase() ? params.tokenIn : tokenOut,
      currency1: params.tokenIn.toLowerCase() < tokenOut.toLowerCase() ? tokenOut : params.tokenIn,
      fee: 0x800000, // DYNAMIC_FEE_FLAG in Uniswap v4
      tickSpacing: 60,
      hooks: hookAddress,
    };

    const poolId = computePoolId(poolKey);
    const zeroForOne =
      params.zeroForOne !== undefined
        ? params.zeroForOne
        : poolKey.currency0.toLowerCase() === params.tokenIn.toLowerCase();

    const intent = {
      machineId: this.machineId,
      poolId,
      tokenIn: params.tokenIn,
      tokenOut,
      amountIn: params.amountIn,
      minAmountOut: params.minAmountOut,
      nonce,
      deadline,
      chainId: this.chainId,
    };

    // Sign EIP-712 with domain verifyingContract = hookAddress
    const signature = await this.keyStore.signTypedData({
      domain: getPinelyDomain(hookAddress, this.chainId),
      types: SWAP_INTENT_TYPES,
      primaryType: "SwapIntent",
      message: intent,
    });

    if (!signature) {
      throw new Error("Failed to sign swap intent with keystore.");
    }

    const hookData = encodeHookData(intent, signature);

    const swapRequest = {
      key: poolKey,
      zeroForOne,
      amountIn: params.amountIn,
      minAmountOut: params.minAmountOut,
      hookData,
    };

    return {
      intent,
      signature,
      hookData,
      swapRequest,
    };
  }

  /**
   * Complete swap execution:
   * Prepares signed SwapIntent, and if walletClient is provided, broadcasts transaction to PinelyRouter.
   */
  async swap(params: SwapParams, walletClient?: WalletClient): Promise<SwapResult> {
    const prepared = await this.prepareSwap(params);

    let txHash: Hash | undefined;
    if (walletClient) {
      const routerAddress = this.requireRouter();
      const client = walletClient as unknown as {
        writeContract: (args: Record<string, unknown>) => Promise<Hash>;
      };
      txHash = await client.writeContract({
        address: routerAddress,
        abi: pinelyRouterAbi,
        functionName: "swap",
        args: [
          {
            key: prepared.swapRequest.key,
            zeroForOne: prepared.swapRequest.zeroForOne,
            amountIn: prepared.swapRequest.amountIn,
            minAmountOut: prepared.swapRequest.minAmountOut,
            hookData: prepared.swapRequest.hookData,
          },
        ],
      });
    }

    return {
      txHash,
      amountIn: params.amountIn,
      amountOut: params.minAmountOut,
      prepared,
    };
  }

  /**
   * Executes the HTTP 402 (x402) payment protocol against a Facilitator.
   *
   * 1. Reads the payment requirements from the resource's HTTP 402 challenge.
   * 2. Validates them against what this machine is willing to pay: the asset must be the configured
   *    stablecoin, the network must match, and the amount must not exceed `maxAmount`.
   * 3. Signs an EIP-712 Payment402Intent, asks the Facilitator to prepare the sponsored
   *    UserOperation, verifies it field by field, signs its hash with the machine session key and
   *    submits it. A UserOperation that pays another recipient, a larger amount, uses another paymaster
   *    or inflated gas is never signed.
   *
   * Fail-closed: without a Facilitator URL, with an unexpected challenge, or without a Facilitator
   * confirmation carrying both a transaction reference and an access token, the result is `failed`.
   * Payments are never simulated.
   */
  async pay(params: Payment402Params): Promise<Payment402Result> {
    const fail = (error: string, amountStable?: bigint): Payment402Result => ({
      status: "failed",
      resource: params.url,
      amountStable,
      error,
    });

    if (!params.facilitatorUrl) {
      return fail("facilitatorUrl is required: payments are never simulated.");
    }

    // 1. HTTP 402 challenge
    let accept: X402Accept | undefined;
    try {
      const challenge = await fetch(params.url);
      if (challenge.status !== 402) {
        return fail(`Resource did not return HTTP 402 (got ${challenge.status}).`);
      }
      accept = ((await challenge.json()) as { accepts?: X402Accept[] }).accepts?.[0];
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Failed to read the payment requirements");
    }
    if (!accept) return fail("The 402 challenge contains no payment requirements.");

    // 2. Validate the requirements before signing anything
    if (!accept.asset || accept.asset.toLowerCase() !== this.stablecoinAddress.toLowerCase()) {
      return fail("The 402 challenge asks for an asset other than the configured stablecoin.");
    }
    if (Number(accept.extra?.chainId) !== Number(this.chainId)) {
      return fail("The 402 challenge is for a different network.");
    }
    if (!accept.payTo || !isAddress(accept.payTo)) {
      return fail("The 402 challenge has no valid payTo address.");
    }
    let amountStable: bigint;
    try {
      amountStable = BigInt(accept.maxAmountRequired ?? "");
    } catch {
      return fail("The 402 challenge has no valid amount.");
    }
    if (amountStable <= 0n || amountStable > params.maxAmount) {
      return fail("The 402 challenge asks for more than maxAmount.", amountStable);
    }

    // 3. What the machine independently expects for the sponsored UserOperation
    const paymaster = this.paymasterAddress;
    if (!paymaster) {
      return fail(
        "PinelyPaymaster address is required to verify the sponsored UserOperation.",
        amountStable,
      );
    }
    const entryPoint = findContractAddress(Number(this.chainId), "EntryPoint");
    if (!entryPoint) return fail("EntryPoint is not configured for this network.", amountStable);

    // 4. Sign the payment intent
    const paymentIntent = {
      machineId: this.machineId,
      resource: accept.resource ?? params.url,
      amountStable,
      nonce: getMonotonicNonce(),
      deadline: BigInt(Math.floor(Date.now() / 1000) + 300),
    };

    const signature = await this.keyStore.signTypedData({
      // The registry is deployed in Stage 1, so it is always available as verifying contract.
      domain: getPinelyFacilitatorDomain(this.registryAddress, this.chainId),
      types: PAYMENT_402_TYPES,
      primaryType: "Payment402Intent",
      message: paymentIntent,
    });

    const base = params.facilitatorUrl.replace(/\/$/, "");
    const request = {
      intent: {
        machineId: paymentIntent.machineId,
        resource: paymentIntent.resource,
        amountStable: paymentIntent.amountStable.toString(),
        nonce: paymentIntent.nonce.toString(),
        deadline: paymentIntent.deadline.toString(),
      },
      signature,
      machineAccount: this.account,
      merchantAddress: accept.payTo,
    };
    const post = (path: string, body: unknown) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    try {
      // 5. The facilitator builds the unsigned UserOperation
      const prepareRes = await post("/v1/settle/prepare", request);
      if (!prepareRes.ok) {
        return fail(`Facilitator returned HTTP ${prepareRes.status} while preparing`, amountStable);
      }
      const prepared = (await prepareRes.json()) as PreparedSettlement;

      // 6. Never sign blindly: rebuild what the UserOperation must contain and compare
      try {
        verifyPreparedSettlement(prepared, {
          sender: this.account,
          stablecoin: this.stablecoinAddress,
          merchant: accept.payTo,
          grossAmount: amountStable,
          paymaster,
          entryPoint,
          chainId: Number(this.chainId),
          maxFeeBps: params.maxFeeBps,
        });
      } catch (err) {
        return fail(
          `Refused to sign the UserOperation: ${err instanceof Error ? err.message : String(err)}`,
          amountStable,
        );
      }

      // 7. PinelyAccount.validateUserOp recovers the signer from personal_sign over the raw hash
      const userOpSignature = await this.keyStore.signMessage({ raw: prepared.userOpHash });

      // 8. Submit; the facilitator confirms on-chain before it answers
      const settleRes = await post("/v1/settle", {
        ...request,
        userOp: prepared.userOp,
        userOpSignature,
      });
      if (!settleRes.ok) {
        return fail(`Facilitator returned HTTP ${settleRes.status}`, amountStable);
      }

      const data = (await settleRes.json()) as {
        status?: string;
        txHash?: Hash;
        accessToken?: string;
      };
      if (data.status !== "settled" || !data.txHash || !data.accessToken) {
        return fail("Facilitator response did not confirm a settled payment.", amountStable);
      }

      return {
        status: "settled",
        resource: params.url,
        amountStable,
        txHash: data.txHash,
        accessToken: data.accessToken,
      };
    } catch (err) {
      return fail(err instanceof Error ? err.message : "Failed to reach facilitator", amountStable);
    }
  }

  /**
   * Retrieves machine profile information from MachineRegistry on-chain.
   */
  async getInfo(): Promise<MachineInfo | null> {
    if (!this.publicClient) return null;

    try {
      const data = (await this.publicClient.readContract({
        address: this.registryAddress,
        abi: machineRegistryAbi,
        functionName: "getMachine",
        args: [this.machineId],
      })) as {
        account: Address;
        operator: Address;
        signer: Address;
        attestationHash: Hash;
        registeredAt: bigint;
        lastActiveAt: bigint;
        lastViolationAt: bigint;
        attestationValid: boolean;
        frozen: boolean;
      };

      const tier = (await this.publicClient.readContract({
        address: this.registryAddress,
        abi: machineRegistryAbi,
        functionName: "tierOf",
        args: [this.machineId],
      })) as number;

      return {
        machineId: this.machineId,
        account: data.account,
        operator: data.operator,
        signer: data.signer,
        attestationHash: data.attestationHash,
        tier,
        frozen: data.frozen,
        registeredAt: Number(data.registeredAt),
        lastActiveAt: Number(data.lastActiveAt),
        lastViolationAt: Number(data.lastViolationAt),
        attestationValid: data.attestationValid,
      };
    } catch {
      return null;
    }
  }

  /**
   * Checks whether the machine or its fleet is frozen by the Kill Switch.
   *
   * Fail-closed: when the state cannot be read (no RPC, network error) this throws instead of
   * returning `false`, so a caller can never mistake "unknown" for "not frozen".
   */
  async isFrozen(): Promise<boolean> {
    if (!this.publicClient) {
      throw new Error("[PINELY] isFrozen() requires an rpcUrl: the kill-switch state is unknown.");
    }
    return (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: machineRegistryAbi,
      functionName: "isFrozen",
      args: [this.machineId],
    })) as boolean;
  }

  /**
   * Builds calldata transaction for operator to modify the Spend Policy.
   */
  buildSetPolicyTx(policy: MachinePolicy) {
    const maxSpend = policy.maxStableOutPerSwap ?? 10_000_000n;
    const dailyCap = policy.dailyStableOutCap ?? 50_000_000n;

    const spendPolicy = {
      maxStableOutPerSwap: maxSpend,
      dailyStableOutCap: dailyCap,
      enabled: policy.enabled,
    };

    const data = encodeFunctionData({
      abi: machineRegistryAbi,
      functionName: "setPolicy",
      args: [this.machineId, spendPolicy],
    });

    return {
      to: this.registryAddress,
      data,
      value: 0n,
    };
  }

  /**
   * Builds calldata transaction to freeze the machine (Kill Switch).
   */
  buildFreezeTx() {
    return {
      to: this.registryAddress,
      data: encodeFunctionData({
        abi: machineRegistryAbi,
        functionName: "freezeMachine",
        args: [this.machineId],
      }),
      value: 0n,
    };
  }

  /**
   * Builds calldata transaction to unfreeze the machine.
   */
  buildUnfreezeTx() {
    return {
      to: this.registryAddress,
      data: encodeFunctionData({
        abi: machineRegistryAbi,
        functionName: "unfreezeMachine",
        args: [this.machineId],
      }),
      value: 0n,
    };
  }

  /**
   * Builds calldata transaction to configure SurplusSweeper for this machine.
   */
  buildSetSweepConfigTx(
    sweeperAddress: Address,
    config: {
      token?: Address;
      reserveThreshold: bigint;
      destination: Address;
      enabled?: boolean;
    },
  ) {
    const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
    return {
      to: sweeperAddress,
      data: encodeFunctionData({
        abi: surplusSweeperAbi,
        functionName: "setMachineConfig",
        args: [
          this.machineId,
          config.token ?? ZERO_ADDRESS,
          config.reserveThreshold,
          config.destination,
          config.enabled ?? true,
        ],
      }),
      value: 0n,
    };
  }

  /**
   * Builds calldata transaction to execute sweep on this machine.
   */
  buildSweepTx(sweeperAddress: Address) {
    return {
      to: sweeperAddress,
      data: encodeFunctionData({
        abi: surplusSweeperAbi,
        functionName: "sweep",
        args: [this.machineId],
      }),
      value: 0n,
    };
  }

  /**
   * Builds calldata transaction to approve SurplusSweeper for token withdrawal.
   */
  buildApproveSweeperTx(tokenAddress: Address, sweeperAddress: Address, amount?: bigint) {
    const MAX_UINT256 = 2n ** 256n - 1n;
    const erc20ApproveAbi = [
      {
        type: "function",
        name: "approve",
        inputs: [
          { name: "spender", type: "address" },
          { name: "value", type: "uint256" },
        ],
        outputs: [{ name: "", type: "bool" }],
        stateMutability: "nonpayable",
      },
    ] as const;

    return {
      to: tokenAddress,
      data: encodeFunctionData({
        abi: erc20ApproveAbi,
        functionName: "approve",
        args: [sweeperAddress, amount ?? MAX_UINT256],
      }),
      value: 0n,
    };
  }
}
