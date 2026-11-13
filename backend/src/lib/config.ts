import type { Address } from "viem";
import { getActiveChain } from "@pinely/shared/chains";
import { findContractAddress } from "@pinely/shared/contracts";

/**
 * Chain selection for the backend.
 *
 * - `CHAIN_ID` must name a supported network (see shared/chains); anything else throws.
 * - In production `CHAIN_ID` is mandatory so a missing variable can never silently select testnet.
 */
export function getBackendChainId(): number {
  const raw = process.env.CHAIN_ID;
  if (!raw && process.env.NODE_ENV === "production") {
    throw new Error("[PINELY] CHAIN_ID must be set explicitly in production.");
  }
  return getActiveChain(raw ? Number(raw) : undefined).id;
}

/**
 * Resolves a deployed or external contract address from the SSOT, or `undefined` when it is not
 * available on the active chain. There are no dummy fallbacks: callers must answer honestly
 * (see {@link notDeployedBody}) instead of inventing an address.
 */
export function resolveAddress(name: string): Address | undefined {
  return findContractAddress(getBackendChainId(), name);
}

/** Honest error body for requests that need a contract which is not deployed on the active chain. */
export function notDeployedBody(name: string): {
  error: string;
  code: "CONTRACT_NOT_DEPLOYED";
  chainId: number;
} {
  const chainId = getBackendChainId();
  return {
    error: `${name} is not deployed on chain ${chainId}.`,
    code: "CONTRACT_NOT_DEPLOYED",
    chainId,
  };
}

/** Thrown when a route needs a contract that is not deployed on the active chain. */
export class ContractNotDeployedError extends Error {
  constructor(readonly contract: string) {
    super(`${contract} is not deployed on chain ${getBackendChainId()}.`);
    this.name = "ContractNotDeployedError";
  }
}

/** Like {@link resolveAddress}, but throws {@link ContractNotDeployedError} (mapped to HTTP 503). */
export function requireDeployed(name: string): Address {
  const address = resolveAddress(name);
  if (!address) throw new ContractNotDeployedError(name);
  return address;
}
