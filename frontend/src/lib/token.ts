import { robinhoodMainnet } from "@pinely/shared/chains";
import { resolvePinelyTokenCa } from "@pinely/shared/contracts";

/**
 * $PINELY exists on Robinhood Chain Mainnet only. Its address is therefore always read for that chain,
 * whatever network this build talks to: a testnet build must not claim the token is "TBA", and every page
 * must show the same address, taken from the single source of truth (`shared/contracts/external.ts`,
 * key `PINELY`). A malformed address fails the build.
 */
export const tokenChain = robinhoodMainnet;

export const tokenCa = resolvePinelyTokenCa(tokenChain.id);

/** Block explorer of the chain the token lives on. */
export const tokenExplorerUrl = tokenChain.blockExplorers?.default.url;
