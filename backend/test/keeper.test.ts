import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { encodeAbiParameters, encodeEventTopics, type Address, type Hash, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { surplusSweeperAbi } from "@pinely/shared/contracts";
import {
  SWEEP_MAX_PAGES,
  SWEEP_PAGE_SIZE,
  getKeeperClients,
  runSurplusSweepCycle,
  type KeeperClients,
} from "../src/services/keeper";
import { FIXTURE_ADDRESSES, installFixtureDeployment } from "./fixtures";

/**
 * Surplus sweep cycle: machine paging, honest reporting, receipt-based counting, and key handling.
 * The chain clients and the machine list are fakes; nothing talks to a network.
 */

const SWEEPER = FIXTURE_ADDRESSES.SurplusSweeper as Address;
const TX: Hash = `0x${"ab".repeat(32)}`;
const OTHER_TOKEN: Address = "0x5555555555555555555555555555555555555555";

const machineId = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;
const ids = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => machineId(from + i));

/** A `SurplusSwept` log as the sweeper would emit it. */
function sweptLog(id: Hex, address: Address = SWEEPER) {
  const topics = encodeEventTopics({
    abi: surplusSweeperAbi,
    eventName: "SurplusSwept",
    args: { machineId: id, account: OTHER_TOKEN, destination: OTHER_TOKEN },
  });
  const data = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }, { type: "uint256" }],
    [OTHER_TOKEN, 5n, 0n],
  );
  return { address, topics, data, blockNumber: 1n, transactionHash: TX, logIndex: 0 };
}

interface FakeOptions {
  /** Surplus per machine id; defaults to `surplus` for every machine. */
  surplus?: (id: Hex) => bigint;
  receipt?: () => Promise<unknown>;
  write?: () => Promise<Hash>;
  wallet?: boolean;
}

function fakeClients(options: FakeOptions = {}) {
  const calls = {
    multicall: [] as Hex[][],
    writes: [] as { functionName: string; args: unknown[] }[],
  };
  const clients = {
    sweeperAddress: SWEEPER,
    publicClient: {
      multicall: async ({ contracts }: { contracts: { args: [Hex] }[] }) => {
        calls.multicall.push(contracts.map((c) => c.args[0]));
        return contracts.map((c) => ({
          status: "success",
          result: [(options.surplus ?? (() => 0n))(c.args[0]), OTHER_TOKEN, OTHER_TOKEN],
        }));
      },
      waitForTransactionReceipt: options.receipt ?? (async () => ({ status: "success", logs: [] })),
    },
    walletClient:
      options.wallet === false
        ? undefined
        : {
            chain: { id: 46630 },
            account: { address: OTHER_TOKEN },
            writeContract: async (call: { functionName: string; args: unknown[] }) => {
              calls.writes.push(call);
              return options.write ? options.write() : TX;
            },
          },
  };
  return { clients: clients as unknown as KeeperClients, calls };
}

/** An id source over a fixed, sorted list that honours the cursor like the SQL query does. */
function pagedSource(all: Hex[]) {
  const requested: (string | null)[] = [];
  return {
    requested,
    list: async (afterId: string | null, limit: number) => {
      requested.push(afterId);
      return all.filter((id) => afterId === null || id > afterId).slice(0, limit);
    },
  };
}

let warn: ReturnType<typeof spyOn>;
let error: ReturnType<typeof spyOn>;
let log: ReturnType<typeof spyOn>;
beforeEach(() => {
  installFixtureDeployment();
  warn = spyOn(console, "warn").mockImplementation(() => {});
  error = spyOn(console, "error").mockImplementation(() => {});
  log = spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  warn.mockRestore();
  error.mockRestore();
  log.mockRestore();
});

describe("surplus sweep cycle: machine list", () => {
  it("reports an unreadable indexer instead of treating it as 'no machines'", async () => {
    const { clients, calls } = fakeClients();
    const result = await runSurplusSweepCycle(undefined, {
      clients,
      listMachinePage: async () => {
        throw new Error('relation "ponder.machines" does not exist');
      },
    });
    expect(result.indexerUnavailable).toBe(true);
    expect(result.sweptCount).toBe(0);
    expect(calls.multicall).toHaveLength(0);
    expect(String(warn.mock.calls[0]?.[0])).toContain("Indexer unavailable");
    expect(String(warn.mock.calls[0]?.[0])).toContain("ponder.machines");
  });

  it("is not 'unavailable' when the indexer is healthy but has no machines", async () => {
    const { clients } = fakeClients();
    const result = await runSurplusSweepCycle(undefined, {
      clients,
      listMachinePage: async () => [],
    });
    expect(result.indexerUnavailable).toBe(false);
    expect(result.sweptCount).toBe(0);
  });

  it("checks every machine, not just the first 50", async () => {
    const all = ids(1, 121); // 120 machines: pages of 50, 50, 20
    const source = pagedSource(all);
    const { clients, calls } = fakeClients();
    const result = await runSurplusSweepCycle(undefined, { clients, listMachinePage: source.list });
    expect(calls.multicall.map((page) => page.length)).toEqual([50, 50, 20]);
    expect(calls.multicall.flat()).toEqual(all);
    expect(source.requested).toEqual([null, all[49], all[99]]);
    expect(result.skippedCount).toBe(120);
    expect(result.truncated).toBe(false);
  });

  it("stops at the page cap and says so", async () => {
    const endless = async (afterId: string | null, limit: number) => {
      const start = afterId === null ? 1 : Number(BigInt(afterId)) + 1;
      return ids(start, start + limit);
    };
    const { clients, calls } = fakeClients();
    const result = await runSurplusSweepCycle(undefined, { clients, listMachinePage: endless });
    expect(calls.multicall).toHaveLength(SWEEP_MAX_PAGES);
    expect(result.truncated).toBe(true);
    expect(SWEEP_PAGE_SIZE).toBe(50);
  });

  it("sweeps a single machine when one is named, without reading the indexer", async () => {
    const { clients, calls } = fakeClients({
      surplus: () => 7n,
      receipt: async () => ({ status: "success", logs: [sweptLog(machineId(9))] }),
    });
    const result = await runSurplusSweepCycle(machineId(9), {
      clients,
      listMachinePage: async () => {
        throw new Error("must not be called");
      },
    });
    expect(calls.writes.map((w) => w.functionName)).toEqual(["sweep"]);
    expect(result.sweptCount).toBe(1);
    expect(result.indexerUnavailable).toBe(false);
  });
});

describe("surplus sweep cycle: honest results", () => {
  it("runs as a dry run without a wallet and never reports a sweep", async () => {
    const { clients, calls } = fakeClients({ surplus: () => 5n, wallet: false });
    const result = await runSurplusSweepCycle(undefined, {
      clients,
      listMachinePage: pagedSource(ids(1, 4)).list,
    });
    expect(result.dryRun).toBe(true);
    expect(result.sweptCount).toBe(0);
    expect(result.totalSurplus).toBe(15n);
    expect(calls.writes).toHaveLength(0);
  });

  it("counts a machine as swept only from SurplusSwept events in a successful receipt", async () => {
    const all = ids(1, 4);
    const { clients, calls } = fakeClients({
      surplus: () => 5n,
      // The contract skipped machine 3 (for example its allowance is too low): two events for three.
      receipt: async () => ({
        status: "success",
        logs: [sweptLog(all[0]), sweptLog(all[1]), sweptLog(all[2], OTHER_TOKEN)],
      }),
    });
    const result = await runSurplusSweepCycle(undefined, {
      clients,
      listMachinePage: pagedSource(all).list,
    });
    expect(calls.writes.map((w) => w.functionName)).toEqual(["sweepBatch"]);
    // The third log came from another contract, so only two count.
    expect(result.sweptCount).toBe(2);
    expect(result.txHashes).toEqual([TX]);
    expect(result.failedCount).toBe(0);
    expect(result.dryRun).toBe(false);
  });

  it("reports a reverted transaction as failed, never as swept", async () => {
    const { clients } = fakeClients({
      surplus: () => 5n,
      receipt: async () => ({ status: "reverted", logs: [] }),
    });
    const result = await runSurplusSweepCycle(undefined, {
      clients,
      listMachinePage: pagedSource(ids(1, 4)).list,
    });
    expect(result.sweptCount).toBe(0);
    expect(result.failedCount).toBe(3);
    expect(result.txHashes).toEqual([]);
    expect(String(error.mock.calls[0]?.[0])).toContain("reverted");
  });

  it("reports an unconfirmed transaction as failed and names the hash", async () => {
    const { clients } = fakeClients({
      surplus: () => 5n,
      receipt: async () => {
        throw new Error("Timed out while waiting for transaction");
      },
    });
    const result = await runSurplusSweepCycle(undefined, {
      clients,
      listMachinePage: pagedSource(ids(1, 3)).list,
    });
    expect(result.sweptCount).toBe(0);
    expect(result.failedCount).toBe(2);
    expect(String(error.mock.calls[0]?.[0])).toContain(TX);
  });

  it("reports a send failure as failed and keeps going to the next page", async () => {
    let sends = 0;
    const { clients, calls } = fakeClients({
      surplus: () => 5n,
      write: async () => {
        sends++;
        if (sends === 1) throw new Error("insufficient funds for gas");
        return TX;
      },
      receipt: async () => ({ status: "success", logs: [sweptLog(machineId(60))] }),
    });
    const result = await runSurplusSweepCycle(undefined, {
      clients,
      listMachinePage: pagedSource(ids(1, 52)).list, // pages of 50 and 1
    });
    expect(calls.writes.map((w) => w.functionName)).toEqual(["sweepBatch", "sweep"]);
    expect(result.failedCount).toBe(50);
    expect(result.sweptCount).toBe(1);
  });
});

describe("keeper key handling", () => {
  const saved: Record<string, string | undefined> = {};
  const keys = ["CHAIN_ID", "RPC_URL", "KEEPER_PRIVATE_KEY", "FACILITATOR_PRIVATE_KEY", "NODE_ENV"];
  beforeEach(() => {
    for (const k of keys) saved[k] = process.env[k];
    process.env.CHAIN_ID = "46630";
    process.env.RPC_URL = "http://127.0.0.1:1";
    delete process.env.KEEPER_PRIVATE_KEY;
    delete process.env.FACILITATOR_PRIVATE_KEY;
  });
  afterEach(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("has no wallet when no keeper key is set", () => {
    expect(getKeeperClients().walletClient).toBeUndefined();
  });

  it("never falls back to the facilitator key", () => {
    process.env.FACILITATOR_PRIVATE_KEY = generatePrivateKey();
    expect(getKeeperClients().walletClient).toBeUndefined();
  });

  it("creates a wallet from a valid keeper key", () => {
    process.env.KEEPER_PRIVATE_KEY = generatePrivateKey();
    expect(getKeeperClients().walletClient).toBeDefined();
  });

  it("stays a dry run on a malformed key and never prints it", () => {
    const bad = "0x1234-not-a-key";
    process.env.KEEPER_PRIVATE_KEY = bad;
    expect(getKeeperClients().walletClient).toBeUndefined();
    const printed = error.mock.calls.map((call: unknown[]) => String(call[0])).join("\n");
    expect(printed).toContain("KEEPER_PRIVATE_KEY is not a 32-byte hex key");
    expect(printed).not.toContain(bad);
  });
});
