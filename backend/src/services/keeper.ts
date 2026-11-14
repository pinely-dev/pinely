import {
  type Address,
  type Hash,
  type Hex,
  createPublicClient,
  createWalletClient,
  http,
  isAddressEqual,
  parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getActiveChain } from "@pinely/shared/chains";
import { findContractAddress, surplusSweeperAbi } from "@pinely/shared/contracts";
import { pool } from "../db/connection";
import { getBackendChainId } from "../lib/config";

/** Machines checked and swept per page. `sweepBatch` handles one page per transaction. */
export const SWEEP_PAGE_SIZE = 50;
/** Upper bound on pages per cycle (10,000 machines), so one cycle can never run away. */
export const SWEEP_MAX_PAGES = 200;
/** How long to wait for a sweep transaction to be mined before reporting it as unconfirmed. */
export const SWEEP_RECEIPT_TIMEOUT_MS = 60_000;

export interface SweepCycleResult {
  /** Machines with a `SurplusSwept` event in a transaction that was mined successfully. */
  sweptCount: number;
  /** Surplus detected as sweepable, in stablecoin base units (detected, not necessarily moved). */
  totalSurplus: bigint;
  /** Transactions that were mined successfully. */
  txHashes: Hash[];
  skippedCount: number;
  /** Machines whose sweep transaction failed to send, reverted, or was not confirmed in time. */
  failedCount: number;
  /** True when surplus was detected but nothing was sent (no valid keeper key configured). */
  dryRun: boolean;
  /** True when the indexer could not be read, so the machine list was incomplete or empty. */
  indexerUnavailable: boolean;
  /** True when the page cap was reached before every machine was checked. */
  truncated: boolean;
}

export interface KeeperClients {
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient?: ReturnType<typeof createWalletClient>;
  sweeperAddress?: Address;
}

/** Test seams: the machine list and the chain clients can be replaced. */
export interface SweepDeps {
  /** Returns up to `limit` unfrozen machine ids greater than `afterId`, in ascending id order. */
  listMachinePage?: (afterId: string | null, limit: number) => Promise<string[]>;
  clients?: KeeperClients;
}

const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/**
 * Gets the Public & Wallet Client for the Keeper if the RPC and private key configuration is available.
 *
 * Only `KEEPER_PRIVATE_KEY` is read. The facilitator key is never reused for sweeps, so one hot key
 * never carries two roles. A missing or malformed key leaves the keeper in dry-run mode (fail-closed).
 */
export function getKeeperClients(): KeeperClients {
  const chainId = getBackendChainId();
  const targetChain = getActiveChain(chainId);
  // The public RPC is shared by every user: production must use a provider endpoint.
  if (!process.env.RPC_URL && process.env.NODE_ENV === "production") {
    throw new Error("[Keeper] RPC_URL must be set in production.");
  }
  const rpcUrl = process.env.RPC_URL ?? targetChain.rpcUrls.default.http[0];
  const sweeperAddress = findContractAddress(chainId, "SurplusSweeper");

  const publicClient = createPublicClient({
    chain: targetChain,
    transport: http(rpcUrl),
  });

  const rawKey = process.env.KEEPER_PRIVATE_KEY?.trim();
  if (!rawKey) {
    return { publicClient, sweeperAddress };
  }
  if (!PRIVATE_KEY_PATTERN.test(rawKey)) {
    // Never print the value: it may still be a real secret with a typo.
    console.error("[Keeper] KEEPER_PRIVATE_KEY is not a 32-byte hex key; running as a dry run.");
    return { publicClient, sweeperAddress };
  }

  const account = privateKeyToAccount(rawKey as Hex);
  const walletClient = createWalletClient({
    account,
    chain: targetChain,
    transport: http(rpcUrl),
  });

  return { publicClient, walletClient, sweeperAddress };
}

/** Default machine source: unfrozen machines from the indexer, keyset-paginated by id. */
async function listMachinePageFromIndexer(
  afterId: string | null,
  limit: number,
): Promise<string[]> {
  const res = await pool.query<{ id: string }>(
    `select id from ponder.machines
       where frozen = false and ($1::text is null or id > $1::text)
       order by id
       limit $2`,
    [afterId, limit],
  );
  return res.rows.map((row) => row.id);
}

/**
 * Runs 1 cycle of auditing and sweeping on-chain machine revenue surplus.
 *
 * Every unfrozen machine is checked, one page at a time (bounded by {@link SWEEP_MAX_PAGES}). A
 * machine counts as swept only after its transaction is mined successfully and the sweeper emitted
 * `SurplusSwept` for it, never merely because a transaction was submitted.
 */
export async function runSurplusSweepCycle(
  targetMachineId?: string,
  deps: SweepDeps = {},
): Promise<SweepCycleResult> {
  const result: SweepCycleResult = {
    sweptCount: 0,
    totalSurplus: 0n,
    txHashes: [],
    skippedCount: 0,
    failedCount: 0,
    dryRun: false,
    indexerUnavailable: false,
    truncated: false,
  };

  const { publicClient, walletClient, sweeperAddress } = deps.clients ?? getKeeperClients();
  if (!sweeperAddress) {
    console.log("[Keeper] SurplusSweeper address not found on active chain; skipping cycle.");
    return result;
  }

  const fetchPage: NonNullable<SweepDeps["listMachinePage"]> = targetMachineId
    ? async (afterId) => (afterId === null ? [targetMachineId] : [])
    : (deps.listMachinePage ?? listMachinePageFromIndexer);

  let cursor: string | null = null;
  let pages = 0;
  for (;;) {
    if (pages >= SWEEP_MAX_PAGES) {
      result.truncated = true;
      console.warn(
        `[Keeper] Reached the page cap (${SWEEP_MAX_PAGES} pages of ${SWEEP_PAGE_SIZE}); remaining machines are checked next cycle.`,
      );
      break;
    }

    let ids: string[];
    try {
      ids = await fetchPage(cursor, SWEEP_PAGE_SIZE);
    } catch (err) {
      // Not "no machines": the indexer cannot be read (not deployed, still backfilling, or down).
      result.indexerUnavailable = true;
      console.warn(
        `[Keeper] Indexer unavailable (${err instanceof Error ? err.message : String(err)}); ` +
          `skipping the rest of this sweep cycle.`,
      );
      break;
    }
    if (ids.length === 0) break;

    pages++;
    cursor = ids[ids.length - 1];
    await sweepPage(ids as Hash[], { publicClient, walletClient, sweeperAddress }, result);
    if (ids.length < SWEEP_PAGE_SIZE) break;
  }

  if (result.dryRun) {
    // No valid keeper key is configured, so nothing was sent and sweptCount stays 0.
    console.log(
      `[Keeper Dry-run] Detected surplus ready to sweep: ${result.totalSurplus.toString()} stablecoin base units.`,
    );
  }
  return result;
}

/** Checks one page of machines, then sweeps the ones with surplus (or records a dry run). */
async function sweepPage(
  machineIds: Hash[],
  clients: Required<Pick<KeeperClients, "publicClient" | "sweeperAddress">> &
    Pick<KeeperClients, "walletClient">,
  result: SweepCycleResult,
): Promise<void> {
  const { publicClient, walletClient, sweeperAddress } = clients;

  // 1. Check each machine's surplus in a batch via multicall to prevent DoS/429
  const sweepableMachines: Hash[] = [];

  try {
    const contracts = machineIds.map((mid) => ({
      address: sweeperAddress,
      abi: surplusSweeperAbi,
      functionName: "getSweepableSurplus" as const,
      args: [mid],
    }));

    const multicallResults = await publicClient.multicall({
      contracts,
      allowFailure: true,
    });

    for (let i = 0; i < machineIds.length; i++) {
      const res = multicallResults[i];
      if (res && res.status === "success" && Array.isArray(res.result)) {
        const surplus = res.result[0] as bigint;
        if (surplus > 0n) {
          sweepableMachines.push(machineIds[i]);
          result.totalSurplus += surplus;
        } else {
          result.skippedCount++;
        }
      } else {
        result.skippedCount++;
      }
    }
  } catch {
    // Serial fallback if multicall is not supported by the RPC
    for (const mid of machineIds) {
      try {
        const [surplus] = await publicClient.readContract({
          address: sweeperAddress,
          abi: surplusSweeperAbi,
          functionName: "getSweepableSurplus",
          args: [mid],
        });

        if (surplus > 0n) {
          sweepableMachines.push(mid);
          result.totalSurplus += surplus;
        } else {
          result.skippedCount++;
        }
      } catch {
        result.skippedCount++;
      }
    }
  }

  if (sweepableMachines.length === 0) return;

  // 2. Execute the on-chain sweep transaction if the keeper wallet is active
  if (!walletClient) {
    result.dryRun = true;
    return;
  }

  const count = sweepableMachines.length;
  let txHash: Hash;
  try {
    if (count === 1) {
      txHash = await walletClient.writeContract({
        chain: walletClient.chain,
        account: walletClient.account!,
        address: sweeperAddress,
        abi: surplusSweeperAbi,
        functionName: "sweep",
        args: [sweepableMachines[0]],
      });
    } else {
      txHash = await walletClient.writeContract({
        chain: walletClient.chain,
        account: walletClient.account!,
        address: sweeperAddress,
        abi: surplusSweeperAbi,
        functionName: "sweepBatch",
        args: [sweepableMachines],
      });
    }
  } catch (err) {
    result.failedCount += count;
    console.error(
      "[Keeper] Failed to send on-chain sweep:",
      err instanceof Error ? err.message : err,
    );
    return;
  }

  // 3. Count only what the chain confirms. Waiting here also keeps the next page's nonce ordered.
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
      timeout: SWEEP_RECEIPT_TIMEOUT_MS,
    });
    if (receipt.status !== "success") {
      result.failedCount += count;
      console.error(`[Keeper] Sweep transaction reverted (Tx: ${txHash}).`);
      return;
    }
    const swept = parseEventLogs({
      abi: surplusSweeperAbi,
      eventName: "SurplusSwept",
      logs: receipt.logs,
    }).filter((log) => isAddressEqual(log.address, sweeperAddress));
    result.sweptCount += swept.length;
    result.txHashes.push(txHash);
    console.log(
      `[Keeper] Swept surplus for ${swept.length} of ${count} machines (Tx: ${txHash}).` +
        (swept.length < count
          ? " The contract skipped the rest (frozen, disabled, or allowance too low)."
          : ""),
    );
  } catch (err) {
    result.failedCount += count;
    console.error(
      `[Keeper] Sweep transaction was not confirmed (Tx: ${txHash}); check it on the explorer:`,
      err instanceof Error ? err.message : err,
    );
  }
}

/**
 * Runs the cycle that resets operators' monthly quota at the start of the UTC month.
 */
export async function runBillingQuotaResetCycle(): Promise<{ resetCount: number }> {
  const now = new Date();
  // Monthly spend is computed per calendar month from indexed swaps (see routes/billing.ts), so there
  // is no stored counter to reset. The job exists as a hook and honestly reports that it reset nothing.
  console.log(`[Keeper] Monthly quota cycle at ${now.toISOString()}: no stored counters to reset.`);
  return { resetCount: 0 };
}
