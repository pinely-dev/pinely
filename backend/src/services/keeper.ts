import {
  type Address,
  type Hash,
  type Hex,
  createPublicClient,
  createWalletClient,
  http,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getActiveChain } from "@pinely/shared/chains";
import { findContractAddress, surplusSweeperAbi } from "@pinely/shared/contracts";
import { pool } from "../db/connection";
import { getBackendChainId } from "../lib/config";

export interface SweepCycleResult {
  sweptCount: number;
  totalSurplus: bigint;
  txHashes: Hash[];
  skippedCount: number;
  /** True when surplus was detected but nothing was sent (no keeper key configured). */
  dryRun: boolean;
}

/**
 * Gets the Public & Wallet Client for the Keeper if the RPC and private key configuration is available.
 */
function getKeeperClients(): {
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient?: ReturnType<typeof createWalletClient>;
  sweeperAddress?: Address;
} {
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

  const rawKey = process.env.KEEPER_PRIVATE_KEY ?? process.env.FACILITATOR_PRIVATE_KEY;
  if (!rawKey) {
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

/**
 * Runs 1 cycle of auditing and sweeping on-chain machine revenue surplus.
 */
export async function runSurplusSweepCycle(targetMachineId?: string): Promise<SweepCycleResult> {
  const result: SweepCycleResult = {
    sweptCount: 0,
    totalSurplus: 0n,
    txHashes: [],
    skippedCount: 0,
    dryRun: false,
  };

  const { publicClient, walletClient, sweeperAddress } = getKeeperClients();
  if (!sweeperAddress) {
    console.log("[Keeper] SurplusSweeper address not found on active chain; skipping cycle.");
    return result;
  }

  // 1. Get the list of machineIds to check
  let machineIds: Hash[] = [];
  if (targetMachineId) {
    machineIds = [targetMachineId as Hash];
  } else {
    try {
      const res = await pool.query<{ id: string }>(
        `select id from ponder.machines where frozen = false limit 50`,
      );
      machineIds = res.rows.map((row) => row.id as Hash);
    } catch {
      // If the ponder indexer has no rows in the database yet, use an empty array
      machineIds = [];
    }
  }

  if (machineIds.length === 0) {
    return result;
  }

  // 2. Check each machine's surplus in a batch via multicall to prevent DoS/429
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

  if (sweepableMachines.length === 0) {
    return result;
  }

  // 3. Execute the on-chain sweep transaction if the keeper wallet is active
  if (walletClient) {
    try {
      let txHash: Hash;
      if (sweepableMachines.length === 1) {
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

      result.sweptCount = sweepableMachines.length;
      result.txHashes.push(txHash);
      console.log(
        `[Keeper] Successfully swept surplus for ${sweepableMachines.length} machines (Tx: ${txHash}).`,
      );
    } catch (err) {
      console.error(
        "[Keeper] Failed to execute on-chain sweep:",
        err instanceof Error ? err.message : err,
      );
    }
  } else {
    // Dry run: no keeper key is configured, so nothing is sent and sweptCount stays 0.
    result.dryRun = true;
    console.log(
      `[Keeper Dry-run] Detected surplus ready to sweep for ${sweepableMachines.length} machines: ${result.totalSurplus.toString()} stablecoin base units`,
    );
  }

  return result;
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
