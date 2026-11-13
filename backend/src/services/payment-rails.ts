import {
  type Address,
  type Hash,
  type Hex,
  concat,
  createPublicClient,
  http,
  isAddress,
  keccak256,
  recoverMessageAddress,
  recoverTypedDataAddress,
  toBytes,
} from "viem";
import { getActiveChain } from "@pinely/shared/chains";
import { machineRegistryAbi } from "@pinely/shared/contracts";
import {
  buildSettlementUserOp,
  computeMachineId,
  deserializeUserOperation,
  getPinelyFacilitatorDomain,
  getUserOpHash,
  PAYMENT_402_TYPES,
  serializeUserOperation,
  type PackedUserOperation,
  type SerializedUserOperation,
} from "@pinely-protocol/sdk";
import { APP_SCHEMA, pool } from "../db/connection";
import { issueAccessToken } from "../lib/access-token";
import { getBackendChainId, resolveAddress } from "../lib/config";

export { serializeUserOperation };
export type { PackedUserOperation, SerializedUserOperation };

/**
 * Settlement rail.
 *
 * The only rail is an ERC-4337 UserOperation whose gas is sponsored by the PinelyPaymaster. The
 * settlement stablecoin may also expose EIP-3009 `transferWithAuthorization`; the capability probe
 * only reports it, and this service does not use it: the machine funds sit in a contract account, which
 * a UserOperation spends from directly. A separate EIP-3009 rail is a follow-up (RH-90 in
 * docs/plans/09-robinhood-chain-migration.md).
 *
 * Flow (nothing is stored on the server between the two calls):
 *   1. POST /v1/settle/prepare: the facilitator verifies the machine and builds the unsigned UserOperation.
 *   2. The machine checks the operation itself, then signs its hash with its session key.
 *   3. POST /v1/settle: the facilitator rebuilds the operation, requires it to be identical to the one the
 *      machine signed, verifies the signature, submits it, and answers only after on-chain confirmation.
 */
export type PaymentRail = "erc4337-paymaster";

export interface PaymentCapability {
  rail: PaymentRail;
  tokenAddress: Address;
  chainId: number;
  /** Informational: whether the settlement token exposes EIP-3009. It does not change the rail. */
  supportsEip3009: boolean;
}

const settledPaymentNonces = new Set<string>();

export function isPaymentNonceSettled(machineId: Hash, nonce: bigint): boolean {
  return settledPaymentNonces.has(`${machineId.toLowerCase()}:${nonce.toString()}`);
}

/**
 * Distributed nonce check: local cache first, then PostgreSQL, so that multiple instances cannot
 * settle the same intent twice.
 */
export async function isPaymentNonceSettledAsync(machineId: Hash, nonce: bigint): Promise<boolean> {
  const key = `${machineId.toLowerCase()}:${nonce.toString()}`;
  if (settledPaymentNonces.has(key)) return true;

  try {
    const res = await pool.query<{ id: string }>(
      `select id from "${APP_SCHEMA}".facilitator_settlements where id = $1 limit 1`,
      [key],
    );
    if (res.rowCount && res.rowCount > 0) {
      settledPaymentNonces.add(key);
      return true;
    }
  } catch {
    // Database offline or not ready: fall back to the in-memory cache.
  }

  return false;
}

export async function recordSettledPaymentNonce(
  machineId: Hash,
  nonce: bigint,
  extra?: {
    recipient?: Address;
    amount?: bigint;
    rail?: PaymentRail;
    txHash?: Hash;
  },
): Promise<void> {
  const key = `${machineId.toLowerCase()}:${nonce.toString()}`;
  settledPaymentNonces.add(key);

  try {
    await pool.query(
      `insert into "${APP_SCHEMA}".facilitator_settlements
       (id, machine_id, nonce, recipient, amount, rail, tx_hash, status, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, 'settled', now())
       on conflict (id) do nothing`,
      [
        key,
        machineId.toLowerCase(),
        nonce.toString(),
        extra?.recipient?.toLowerCase() ?? "0x0000000000000000000000000000000000000000",
        (extra?.amount ?? 0n).toString(),
        extra?.rail ?? "erc4337-paymaster",
        extra?.txHash ?? null,
      ],
    );
  } catch {
    // Database offline or not ready.
  }
}

/** Loads previously settled nonces from PostgreSQL into memory at startup. */
export async function loadSettledPaymentNoncesFromDb(): Promise<void> {
  try {
    const res = await pool.query<{ machine_id: string; nonce: string }>(
      `select machine_id, nonce from "${APP_SCHEMA}".facilitator_settlements`,
    );
    for (const row of res.rows) {
      settledPaymentNonces.add(`${row.machine_id.toLowerCase()}:${row.nonce}`);
    }
  } catch {
    // Database offline or not ready.
  }
}

const authorizationStateAbi = [
  {
    name: "authorizationState",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

/**
 * Reports the settlement rail and, informationally, whether the token supports EIP-3009.
 *
 * The probe calls the view `authorizationState(address,bytes32)` instead of scanning the token's
 * bytecode: most stablecoins are proxies, whose own bytecode never contains the selector.
 * Without an RPC URL the answer is "not supported" (fail-closed).
 */
export async function detectPaymentRailCapability(
  tokenAddress: Address,
  rpcUrl?: string,
): Promise<PaymentCapability> {
  const chain = getActiveChain(getBackendChainId());
  const base = {
    rail: "erc4337-paymaster" as const,
    tokenAddress,
    chainId: chain.id as number,
  };
  if (!rpcUrl) return { ...base, supportsEip3009: false };

  try {
    const client = createPublicClient({
      chain,
      transport: http(rpcUrl, { timeout: 1500, retryCount: 0 }),
    });
    await client.readContract({
      address: tokenAddress,
      abi: authorizationStateAbi,
      functionName: "authorizationState",
      args: ["0x0000000000000000000000000000000000000001", `0x${"00".repeat(32)}`],
    });
    return { ...base, supportsEip3009: true };
  } catch {
    return { ...base, supportsEip3009: false };
  }
}

export interface PaymentIntent {
  machineId: Hash;
  resource: string;
  amountStable: bigint;
  nonce: bigint;
  deadline: bigint;
}

/**
 * Verifies the EIP-712 Payment402Intent signature and returns the recovered signer.
 *
 * This only proves who signed. Whether that signer is the machine's registered session key is
 * checked separately by {@link assertMachineAuthorized}.
 */
export async function verifyPayment402Intent(payload: {
  intent: PaymentIntent;
  signature: Hex;
  verifyingContract: Address;
  chainId?: bigint;
}): Promise<{ valid: boolean; recoveredAddress?: Address; error?: string }> {
  try {
    if (Date.now() / 1000 > Number(payload.intent.deadline)) {
      return { valid: false, error: "Payment intent has expired (deadline passed)" };
    }

    const activeChainId = payload.chainId ?? BigInt(getBackendChainId());
    const domain = getPinelyFacilitatorDomain(payload.verifyingContract, activeChainId);

    const recoveredAddress = await recoverTypedDataAddress({
      domain,
      types: PAYMENT_402_TYPES,
      primaryType: "Payment402Intent",
      message: payload.intent,
      signature: payload.signature,
    });

    return { valid: true, recoveredAddress };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Failed to verify payment intent",
    };
  }
}

export interface SettlementResult {
  status: "settled";
  txHash: Hash;
  accessToken: string;
  facilitatorFee: string;
  netMerchantAmount: string;
  /** True only when a bundler confirmed that the UserOperation executed successfully. */
  onChain: boolean;
  /** True when the result came from the explicit local simulation mode. Never set in production. */
  simulated: boolean;
  rail: PaymentRail;
  userOp?: SerializedUserOperation;
}

export interface PreparedSettlementBody {
  userOp: SerializedUserOperation;
  userOpHash: Hash;
  entryPoint: Address;
  chainId: number;
  amountStable: string;
  facilitatorFee: string;
  netMerchantAmount: string;
  feeRecipient?: Address;
}

function simulationEnabled(): boolean {
  return process.env.FACILITATOR_SIMULATION === "true" && process.env.NODE_ENV !== "production";
}

function publicClientFor(rpcUrl: string) {
  const chain = getActiveChain(getBackendChainId());
  return createPublicClient({ chain, transport: http(rpcUrl) });
}

/**
 * Confirms on-chain that `signer` is the registered session key of `machineId`, that the machine
 * account matches, and that neither the machine nor its fleet is frozen.
 */
export async function assertMachineAuthorized(params: {
  machineId: Hash;
  machineAccount: Address;
  signer: Address;
  rpcUrl: string;
}): Promise<void> {
  const registry = resolveAddress("MachineRegistry");
  if (!registry) throw new Error("CONTRACT_NOT_DEPLOYED: MachineRegistry");

  if (computeMachineId(params.machineAccount) !== params.machineId.toLowerCase()) {
    throw new Error("MACHINE_NOT_AUTHORIZED: machineId does not match the machine account.");
  }

  const client = publicClientFor(params.rpcUrl);
  const [machine, frozen] = await Promise.all([
    client.readContract({
      address: registry,
      abi: machineRegistryAbi,
      functionName: "getMachine",
      args: [params.machineId],
    }),
    client.readContract({
      address: registry,
      abi: machineRegistryAbi,
      functionName: "isFrozen",
      args: [params.machineId],
    }),
  ]);

  if (machine.account.toLowerCase() !== params.machineAccount.toLowerCase()) {
    throw new Error("MACHINE_NOT_AUTHORIZED: account is not registered for this machineId.");
  }
  if (machine.signer.toLowerCase() !== params.signer.toLowerCase()) {
    throw new Error("MACHINE_NOT_AUTHORIZED: signature is not from the registered machine signer.");
  }
  if (frozen) {
    throw new Error("MACHINE_NOT_AUTHORIZED: machine or fleet is frozen.");
  }
}

const entryPointNonceAbi = [
  {
    name: "getNonce",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "sender", type: "address" },
      { name: "key", type: "uint192" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

async function fetchEntryPointNonce(
  rpcUrl: string,
  entryPoint: Address,
  sender: Address,
): Promise<bigint> {
  return publicClientFor(rpcUrl).readContract({
    address: entryPoint,
    abi: entryPointNonceAbi,
    functionName: "getNonce",
    args: [sender, 0n],
  });
}

type BundlerReceipt = { success?: boolean; receipt?: { transactionHash?: Hash } } | null;

async function bundlerRpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
  } catch (fetchErr) {
    throw new Error(
      `BUNDLER_CONNECTION_ERROR: could not reach the bundler RPC (${fetchErr instanceof Error ? fetchErr.message : String(fetchErr)})`,
    );
  }
  const body = (await res.json()) as { result?: T; error?: unknown };
  if (body.result === undefined || body.result === null) {
    if (method === "eth_getUserOperationReceipt") return null as T;
    throw new Error(
      `BUNDLER_REJECTED_USEROP: ${method} failed (${JSON.stringify(body.error ?? "unknown error")})`,
    );
  }
  return body.result;
}

/** Polls the bundler until the UserOperation has a receipt, or fails closed on timeout. */
async function waitForUserOpReceipt(bundlerUrl: string, userOpHash: Hash): Promise<Hash> {
  const timeoutMs = Number(process.env.BUNDLER_RECEIPT_TIMEOUT_MS ?? 20_000);
  const intervalMs = Number(process.env.BUNDLER_RECEIPT_POLL_MS ?? 500);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const receipt = await bundlerRpc<BundlerReceipt>(bundlerUrl, "eth_getUserOperationReceipt", [
      userOpHash,
    ]);
    if (receipt) {
      if (receipt.success !== true || !receipt.receipt?.transactionHash) {
        throw new Error("BUNDLER_REJECTED_USEROP: the UserOperation was included but reverted.");
      }
      return receipt.receipt.transactionHash;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error("BUNDLER_TIMEOUT: no UserOperation receipt before the deadline.");
}

interface SettlementPlan {
  userOp: PackedUserOperation;
  userOpHash: Hash;
  entryPoint: Address;
  chainId: number;
  merchantAddress: Address;
  machineAccount: Address;
  feeRecipient?: Address;
  facilitatorFee: bigint;
  netMerchantAmount: bigint;
}

/**
 * Builds the unsigned UserOperation for a payment. Deterministic for a given intent, fee configuration
 * and EntryPoint nonce, which is what lets `/v1/settle` rebuild and compare it.
 *
 * The facilitator fee is only charged when a recipient is configured, and is then really transferred in
 * the same operation. It is never reported without being collected.
 */
async function planSettlement(params: {
  intent: PaymentIntent;
  machineAccount?: Address;
  merchantAddress?: Address;
  simulated: boolean;
  rpcUrl?: string;
}): Promise<SettlementPlan> {
  if (!params.merchantAddress || !isAddress(params.merchantAddress)) {
    throw new Error("MERCHANT_ADDRESS_REQUIRED: a valid merchant address is required.");
  }
  if (!params.machineAccount || !isAddress(params.machineAccount)) {
    throw new Error("MACHINE_ACCOUNT_REQUIRED: the machine smart account address is required.");
  }

  const stablecoin = resolveAddress("STABLECOIN");
  if (!stablecoin) throw new Error("CONTRACT_NOT_DEPLOYED: stablecoin");
  const paymaster = resolveAddress("PinelyPaymaster");
  if (!paymaster) throw new Error("CONTRACT_NOT_DEPLOYED: PinelyPaymaster");
  const entryPoint = resolveAddress("EntryPoint");
  if (!entryPoint) throw new Error("CONTRACT_NOT_DEPLOYED: EntryPoint");

  const configuredRecipient = process.env.FACILITATOR_FEE_RECIPIENT as Address | undefined;
  const feeRecipient =
    configuredRecipient && isAddress(configuredRecipient) ? configuredRecipient : undefined;
  const feeBps = feeRecipient ? BigInt(process.env.FACILITATOR_FEE_BPS ?? "10") : 0n;
  const facilitatorFee = (params.intent.amountStable * feeBps) / 10_000n;
  const netMerchantAmount = params.intent.amountStable - facilitatorFee;

  let nonce: bigint;
  if (params.simulated) {
    nonce = params.intent.nonce;
  } else {
    if (!params.rpcUrl) {
      throw new Error("BUNDLER_UNAVAILABLE: RPC_URL is required to read machine and nonce state.");
    }
    nonce = await fetchEntryPointNonce(params.rpcUrl, entryPoint, params.machineAccount);
  }

  const userOp = buildSettlementUserOp({
    sender: params.machineAccount,
    nonce,
    stablecoin,
    merchant: params.merchantAddress,
    amount: netMerchantAmount,
    paymaster,
    feeRecipient: facilitatorFee > 0n ? feeRecipient : undefined,
    feeAmount: facilitatorFee,
  });
  const chainId = getBackendChainId();

  return {
    userOp,
    userOpHash: getUserOpHash(userOp, entryPoint, chainId),
    entryPoint,
    chainId,
    merchantAddress: params.merchantAddress,
    machineAccount: params.machineAccount,
    feeRecipient: facilitatorFee > 0n ? feeRecipient : undefined,
    facilitatorFee,
    netMerchantAmount,
  };
}

/**
 * Step 1 of settlement: verifies the machine and returns the unsigned UserOperation to sign.
 */
export async function prepareSettlement(params: {
  intent: PaymentIntent;
  signerAddress: Address;
  machineAccount?: Address;
  merchantAddress?: Address;
  rpcUrl?: string;
}): Promise<PreparedSettlementBody> {
  if (await isPaymentNonceSettledAsync(params.intent.machineId, params.intent.nonce)) {
    throw new Error("NONCE_REPLAYED");
  }

  const simulated = simulationEnabled();
  const rpcUrl = params.rpcUrl ?? process.env.RPC_URL;

  if (!simulated) {
    if (!rpcUrl) {
      throw new Error("BUNDLER_UNAVAILABLE: RPC_URL is required to read machine and nonce state.");
    }
    if (!params.machineAccount || !isAddress(params.machineAccount)) {
      throw new Error("MACHINE_ACCOUNT_REQUIRED: the machine smart account address is required.");
    }
    await assertMachineAuthorized({
      machineId: params.intent.machineId,
      machineAccount: params.machineAccount,
      signer: params.signerAddress,
      rpcUrl,
    });
  }

  const plan = await planSettlement({
    intent: params.intent,
    machineAccount: params.machineAccount,
    merchantAddress: params.merchantAddress,
    simulated,
    rpcUrl,
  });

  return {
    userOp: serializeUserOperation(plan.userOp),
    userOpHash: plan.userOpHash,
    entryPoint: plan.entryPoint,
    chainId: plan.chainId,
    amountStable: params.intent.amountStable.toString(),
    facilitatorFee: plan.facilitatorFee.toString(),
    netMerchantAmount: plan.netMerchantAmount.toString(),
    feeRecipient: plan.feeRecipient,
  };
}

const sameUserOp = (a: PackedUserOperation, b: PackedUserOperation): boolean =>
  a.sender.toLowerCase() === b.sender.toLowerCase() &&
  a.nonce === b.nonce &&
  a.initCode.toLowerCase() === b.initCode.toLowerCase() &&
  a.callData.toLowerCase() === b.callData.toLowerCase() &&
  a.accountGasLimits.toLowerCase() === b.accountGasLimits.toLowerCase() &&
  a.preVerificationGas === b.preVerificationGas &&
  a.gasFees.toLowerCase() === b.gasFees.toLowerCase() &&
  a.paymasterAndData.toLowerCase() === b.paymasterAndData.toLowerCase();

/**
 * Step 2 of settlement.
 *
 * Fail-closed: the access token is issued only after the bundler reports that the UserOperation was
 * executed successfully. A submitted-but-unconfirmed operation never unlocks the service.
 *
 * The UserOperation sent by the machine must be identical to the one the facilitator would build right
 * now (same recipient, amount, paymaster, gas and current EntryPoint nonce) and its signature must come
 * from the machine's registered session key. If the EntryPoint nonce moved since `prepare`, the machine
 * prepares again.
 */
export async function executePaymentSettlement(params: {
  intent: PaymentIntent;
  signature: Hex;
  signerAddress: Address;
  machineAccount?: Address;
  merchantAddress?: Address;
  userOp?: SerializedUserOperation;
  userOpSignature?: Hex;
  rpcUrl?: string;
  bundlerRpcUrl?: string;
}): Promise<SettlementResult> {
  const { intent, signature } = params;
  const rail: PaymentRail = "erc4337-paymaster";

  if (await isPaymentNonceSettledAsync(intent.machineId, intent.nonce)) {
    throw new Error("NONCE_REPLAYED");
  }

  const rpcUrl = params.rpcUrl ?? process.env.RPC_URL;
  const bundlerRpcUrl = params.bundlerRpcUrl ?? process.env.BUNDLER_RPC_URL;
  const simulated = simulationEnabled();

  let txHash: Hash;
  let onChain = false;
  let plan: SettlementPlan;

  if (simulated) {
    // Explicit local simulation (FACILITATOR_SIMULATION=true, never in production): no chain access.
    plan = await planSettlement({
      intent,
      machineAccount: params.machineAccount,
      merchantAddress: params.merchantAddress,
      simulated: true,
    });
    txHash = keccak256(
      concat([toBytes(signature), toBytes(intent.nonce), toBytes(intent.machineId)]),
    );
  } else {
    if (!bundlerRpcUrl) {
      throw new Error("BUNDLER_UNAVAILABLE: BUNDLER_RPC_URL is required for ERC-4337 settlement.");
    }
    if (!rpcUrl) {
      throw new Error("BUNDLER_UNAVAILABLE: RPC_URL is required to read machine and nonce state.");
    }
    if (!params.userOp || !params.userOpSignature) {
      throw new Error(
        "USEROP_SIGNATURE_REQUIRED: call /v1/settle/prepare, sign the returned userOpHash with the machine session key, then send userOp and userOpSignature.",
      );
    }
    if (!params.machineAccount || !isAddress(params.machineAccount)) {
      throw new Error("MACHINE_ACCOUNT_REQUIRED: the machine smart account address is required.");
    }

    await assertMachineAuthorized({
      machineId: intent.machineId,
      machineAccount: params.machineAccount,
      signer: params.signerAddress,
      rpcUrl,
    });

    // Rebuild with the current EntryPoint nonce and require the machine's operation to be identical.
    plan = await planSettlement({
      intent,
      machineAccount: params.machineAccount,
      merchantAddress: params.merchantAddress,
      simulated: false,
      rpcUrl,
    });

    let provided: PackedUserOperation;
    try {
      provided = deserializeUserOperation(params.userOp);
    } catch (err) {
      throw new Error(
        `USEROP_MISMATCH: malformed UserOperation (${err instanceof Error ? err.message : String(err)}).`,
      );
    }
    if (!sameUserOp(provided, plan.userOp)) {
      throw new Error(
        "USEROP_MISMATCH: the UserOperation differs from the one the facilitator would build now. Prepare the settlement again.",
      );
    }

    // The session key signs personal_sign over the raw 32-byte userOpHash (PinelyAccount.validateUserOp).
    let recovered: Address;
    try {
      recovered = await recoverMessageAddress({
        message: { raw: plan.userOpHash },
        signature: params.userOpSignature,
      });
    } catch {
      throw new Error("USEROP_SIGNATURE_INVALID: the UserOperation signature is malformed.");
    }
    if (recovered.toLowerCase() !== params.signerAddress.toLowerCase()) {
      throw new Error(
        "USEROP_SIGNATURE_INVALID: the UserOperation is not signed by the machine session key.",
      );
    }

    const signed: PackedUserOperation = { ...plan.userOp, signature: params.userOpSignature };
    const submittedHash = await bundlerRpc<Hash>(bundlerRpcUrl, "eth_sendUserOperation", [
      serializeUserOperation(signed),
      plan.entryPoint,
    ]);
    if (submittedHash.toLowerCase() !== plan.userOpHash.toLowerCase()) {
      // The bundler hashed a different operation than the one that was verified and signed.
      throw new Error("BUNDLER_REJECTED_USEROP: the bundler returned an unexpected userOpHash.");
    }
    txHash = await waitForUserOpReceipt(bundlerRpcUrl, plan.userOpHash);
    onChain = true;
  }

  await recordSettledPaymentNonce(intent.machineId, intent.nonce, {
    recipient: plan.merchantAddress,
    amount: intent.amountStable,
    rail,
    txHash,
  });

  return {
    status: "settled",
    txHash,
    accessToken: issueAccessToken({
      machineId: intent.machineId,
      resource: intent.resource,
      settlementRef: txHash,
    }),
    facilitatorFee: plan.facilitatorFee.toString(),
    netMerchantAmount: plan.netMerchantAmount.toString(),
    onChain,
    simulated,
    rail,
    userOp: serializeUserOperation(plan.userOp),
  };
}
