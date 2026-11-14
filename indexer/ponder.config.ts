import "dotenv/config";
import { createConfig } from "@ponder/core";
import { http } from "viem";
import { supportedChains } from "@pinely/shared/chains";
import {
  burnVaultAbi,
  findContractAddress,
  fleetSubscriptionAbi,
  machineRegistryAbi,
  pinelyHookAbi,
  pinelyPaymasterAbi,
  pinelyRouterAbi,
  pinelyStakeAbi,
  surplusSweeperAbi,
} from "@pinely/shared/contracts";

/** Only the supported chains (shared/chains) are indexed. */
const SUPPORTED_CHAIN_IDS: number[] = supportedChains.map((chain) => chain.id);

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`[PINELY Ponder] ${name} must be set explicitly.`);
  }
  return value;
}

const chainId = Number(requireEnv("CHAIN_ID"));
if (!SUPPORTED_CHAIN_IDS.includes(chainId)) {
  throw new Error(
    `[PINELY Ponder] CHAIN_ID ${chainId} is not supported (expected ${SUPPORTED_CHAIN_IDS.join(" or ")}).`,
  );
}

// A zero or missing start block is forbidden: it would scan the chain from genesis.
// START_BLOCK must be the block of the deployment (see shared/contracts/addresses.ts / the deploy log).
const startBlock = Number(requireEnv("START_BLOCK"));
if (!Number.isInteger(startBlock) || startBlock <= 0) {
  throw new Error(`[PINELY Ponder] START_BLOCK must be a positive integer (got "${startBlock}").`);
}

// The Stage 2 contracts were deployed long after Stage 1 (mainnet: block 114059645, against 113448196 for Stage 1).
// Starting them at their own block keeps the backfill from scanning every block in between five more times.
// STAGE2_START_BLOCK must not be later than the first Stage 2 deployment block. When unset it is START_BLOCK:
// always correct, only slower.
const stage2StartBlock = Number(process.env.STAGE2_START_BLOCK ?? startBlock);
if (!Number.isInteger(stage2StartBlock) || stage2StartBlock < startBlock) {
  throw new Error(
    `[PINELY Ponder] STAGE2_START_BLOCK must be an integer of at least START_BLOCK (got "${process.env.STAGE2_START_BLOCK}").`,
  );
}

/** Stage 1 contracts: indexing cannot start without them. */
function requireDeployed(name: string): `0x${string}` {
  const address = findContractAddress(chainId, name);
  if (!address) {
    throw new Error(
      `[PINELY Ponder] "${name}" is not deployed on chain ${chainId}. Deploy and run \`bun run sync\` first.`,
    );
  }
  return address as `0x${string}`;
}

/**
 * Stage 2 contracts (router, hook, stake, burn vault, subscriptions) may not exist yet.
 * Ponder requires every declared contract to have an address, so an undeployed contract points at
 * the dead address: it emits no events and is therefore never indexed.
 */
const DEAD_ADDRESS = "0x000000000000000000000000000000000000dEaD" as const;
function optionalDeployed(name: string): `0x${string}` {
  const address = findContractAddress(chainId, name);
  if (address) return address as `0x${string}`;
  // Plain log, not a warning: an undeployed Stage 2 contract is the expected state, and Railway
  // paints anything on stderr red.
  console.log(
    `[PINELY Ponder] "${name}" is not deployed on chain ${chainId} (Stage 2). It will not be indexed.`,
  );
  return DEAD_ADDRESS;
}

/**
 * A Stage 2 contract with no address points at the dead address, so a full-range `eth_getLogs` scan
 * for it can never find anything. Limiting it to a single block (`endBlock = startBlock`) keeps the
 * handlers registered while removing that wasted work from the backfill, which matters on a
 * rate-limited RPC. Once the contract is deployed it has an address, this returns nothing, and it is
 * indexed normally.
 */
function undeployedRange(name: string): { endBlock?: number } {
  return findContractAddress(chainId, name) ? {} : { endBlock: stage2StartBlock };
}

// The schema of the indexed tables is decided by `ponder.schema.ts` (`onchainSchema`), not by this
// connection string. The `search_path` below only keeps any unqualified query on the `ponder` schema.
function getPonderConnectionString(): string {
  const base = requireEnv("DATABASE_URL");
  if (!base.includes("search_path=")) {
    const separator = base.includes("?") ? "&" : "?";
    return `${base}${separator}search_path=ponder`;
  }
  return base;
}

// Blocks arrive about every 100 ms (about 10 per second). Poll on a wall-clock interval instead of
// reacting to each block, and cap the request rate so a shared or metered RPC is not flooded.
const pollingInterval = Number(process.env.POLLING_INTERVAL_MS ?? 2_000);
const maxRequestsPerSecond = Number(process.env.MAX_REQUESTS_PER_SECOND ?? 25);

export default createConfig({
  database: {
    kind: "postgres",
    connectionString: getPonderConnectionString(),
  },
  networks: {
    chain: {
      chainId,
      // The public RPC is shared by every user: use a provider endpoint (and an archive
      // endpoint for backfills) in production.
      transport: http(requireEnv("RPC_URL"), {
        retryCount: 5,
        retryDelay: 1000,
        timeout: 30_000,
      }),
      pollingInterval,
      maxRequestsPerSecond,
    },
  },
  contracts: {
    MachineRegistry: {
      network: "chain",
      abi: machineRegistryAbi,
      address: requireDeployed("MachineRegistry"),
      startBlock,
    },
    PinelyPaymaster: {
      network: "chain",
      abi: pinelyPaymasterAbi,
      address: requireDeployed("PinelyPaymaster"),
      startBlock,
    },
    SurplusSweeper: {
      network: "chain",
      abi: surplusSweeperAbi,
      address: requireDeployed("SurplusSweeper"),
      startBlock,
    },
    PinelyRouter: {
      network: "chain",
      abi: pinelyRouterAbi,
      address: optionalDeployed("PinelyRouter"),
      ...undeployedRange("PinelyRouter"),
      startBlock: stage2StartBlock,
    },
    PinelyHook: {
      network: "chain",
      abi: pinelyHookAbi,
      address: optionalDeployed("PinelyHook"),
      ...undeployedRange("PinelyHook"),
      startBlock: stage2StartBlock,
    },
    BurnVault: {
      network: "chain",
      abi: burnVaultAbi,
      address: optionalDeployed("BurnVault"),
      ...undeployedRange("BurnVault"),
      startBlock: stage2StartBlock,
    },
    PinelyStake: {
      network: "chain",
      abi: pinelyStakeAbi,
      address: optionalDeployed("PinelyStake"),
      ...undeployedRange("PinelyStake"),
      startBlock: stage2StartBlock,
    },
    FleetSubscription: {
      network: "chain",
      abi: fleetSubscriptionAbi,
      address: optionalDeployed("FleetSubscription"),
      ...undeployedRange("FleetSubscription"),
      startBlock: stage2StartBlock,
    },
  },
});
