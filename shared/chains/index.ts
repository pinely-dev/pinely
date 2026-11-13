import { defineChain } from "viem";

/**
 * Robinhood Chain Testnet (46630). Native gas token: ETH (18 decimals).
 *
 * The values come from viem's chain definitions and were checked against the public RPC (chain id,
 * live blocks). Confirm them against the official Robinhood Chain documentation before a deployment
 * relies on them (docs/plans/09-robinhood-chain-migration.md, task RH-03).
 */
export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [
        process.env.RPC_URL_ROBINHOOD_TESTNET ||
          process.env.NEXT_PUBLIC_RPC_URL ||
          "https://rpc.testnet.chain.robinhood.com",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Chain Testnet Explorer",
      url: "https://explorer.testnet.chain.robinhood.com",
      apiUrl: "https://explorer.testnet.chain.robinhood.com/api",
    },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
  testnet: true,
});

/**
 * Robinhood Chain Mainnet (4663). Native gas token: ETH (18 decimals).
 *
 * Same provenance as the testnet definition. viem also lists a third-party RPC for this chain; it is
 * deliberately not used here.
 */
export const robinhoodMainnet = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: {
    name: "Ether",
    symbol: "ETH",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [
        process.env.RPC_URL_ROBINHOOD_MAINNET ||
          process.env.NEXT_PUBLIC_RPC_URL ||
          "https://rpc.mainnet.chain.robinhood.com",
      ],
    },
  },
  blockExplorers: {
    default: {
      name: "Robinhood Chain Explorer",
      url: "https://robinhoodchain.blockscout.com",
      apiUrl: "https://robinhoodchain.blockscout.com/api",
    },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
  testnet: false,
});

/**
 * Chains supported by the application (SSOT across all packages and scripts).
 * Scripts that cannot import TypeScript read this list through bun (see scripts/sync-contracts.mjs).
 */
export const supportedChains = [robinhoodTestnet, robinhoodMainnet] as const;

/** Default chain for local development only (Robinhood Chain Testnet, 46630). Production must choose explicitly. */
export const defaultChain = robinhoodTestnet;

export type SupportedChain = (typeof supportedChains)[number];
export type SupportedChainId = SupportedChain["id"];

/**
 * What the user interface and the API call things on a given chain. Every label that names the gas
 * token, the settlement stablecoin or the network comes from here, never from a literal in a component.
 */
export interface ChainProfile {
  /** Symbol of the gas token (the Paymaster sponsors gas in this token). */
  nativeSymbol: string;
  /** Symbol of the settlement stablecoin (6 decimals). */
  stablecoinSymbol: string;
  /** Short network name for headings and badges. */
  shortName: string;
  /** Block time in milliseconds, from viem's definition (observed blocks share a timestamp second). */
  blockTimeMs: number;
}

const chainProfiles: Record<SupportedChainId, ChainProfile> = {
  [robinhoodTestnet.id]: {
    nativeSymbol: "ETH",
    stablecoinSymbol: "USDG",
    shortName: "Robinhood Chain Testnet",
    blockTimeMs: 100,
  },
  [robinhoodMainnet.id]: {
    nativeSymbol: "ETH",
    stablecoinSymbol: "USDG",
    shortName: "Robinhood Chain",
    blockTimeMs: 100,
  },
};

/**
 * Returns the active chain from `explicitChainId`, or from `CHAIN_ID` / `NEXT_PUBLIC_CHAIN_ID`.
 *
 * Falls back to the default chain only when nothing is configured. A configured but unsupported
 * chain id throws: the application must never silently run on a different network than requested.
 */
export function getActiveChain(explicitChainId?: number): SupportedChain {
  const envRaw =
    typeof process !== "undefined" ? process.env.CHAIN_ID || process.env.NEXT_PUBLIC_CHAIN_ID : "";
  const requested = explicitChainId || (envRaw ? Number(envRaw) : 0);
  if (!requested) return defaultChain;

  const chain = supportedChains.find((c) => c.id === requested);
  if (!chain) {
    throw new Error(
      `[PINELY] Unsupported chain id ${String(envRaw || explicitChainId)}. ` +
        `Supported: ${supportedChains.map((c) => c.id).join(", ")}.`,
    );
  }
  return chain;
}

/** Returns the active chain id. */
export function getActiveChainId(explicitChainId?: number): SupportedChainId {
  return getActiveChain(explicitChainId).id;
}

/** Returns the labels for a chain (the active chain when no id is given). Throws for an unsupported id. */
export function getChainProfile(chainId?: number): ChainProfile {
  return chainProfiles[getActiveChain(chainId).id];
}

/**
 * True for a supported chain that is not a testnet. Used for fail-closed behaviour: on a public chain
 * a missing address or secret must throw instead of falling back to a development value. Unknown or
 * unset ids are not public here (they are rejected by `getActiveChain`).
 */
export function isPublicChainId(chainId: number | undefined): boolean {
  const chain = supportedChains.find((c) => c.id === chainId);
  return chain !== undefined && chain.testnet !== true;
}
