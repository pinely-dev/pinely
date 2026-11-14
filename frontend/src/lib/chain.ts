import {
  defaultChain,
  getActiveChain,
  getChainProfile,
  supportedChains,
  type SupportedChain,
} from "@pinely/shared/chains";

/**
 * The network this build talks to.
 *
 * It comes from `NEXT_PUBLIC_CHAIN_ID`, which Next.js inlines at build time. Switching between
 * the testnet and the mainnet therefore means a new build with a different environment, never a
 * code change.
 *
 * Only the public variable is read, so the server render and the browser always agree. A hosted
 * production build without an explicit chain id fails instead of silently falling back to testnet.
 */
function resolveActiveChain(): SupportedChain {
  const explicit = process.env.NEXT_PUBLIC_CHAIN_ID?.trim();
  if (!explicit) {
    if (process.env.NODE_ENV === "production" && process.env.VERCEL) {
      throw new Error(
        `[PINELY] NEXT_PUBLIC_CHAIN_ID must be set for a hosted production build (${supportedChains.map((c) => c.id).join(" or ")}).`,
      );
    }
    // Local development only.
    return defaultChain;
  }
  const id = Number(explicit);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error(`[PINELY] NEXT_PUBLIC_CHAIN_ID must be a chain id (got "${explicit}").`);
  }
  // Throws for any chain that is not a supported network.
  return getActiveChain(id);
}

export const activeChain: SupportedChain = resolveActiveChain();

/** Labels for the network this build talks to: gas token, stablecoin, name and block time. */
export const chainProfile = getChainProfile(activeChain.id);

/** Symbol of the settlement stablecoin. The interface must never spell it as a literal. */
export const stablecoinSymbol = chainProfile.stablecoinSymbol;

/** Symbol of the gas token. The interface must never spell it as a literal. */
export const nativeSymbol = chainProfile.nativeSymbol;
