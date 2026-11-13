import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  http,
  type Address,
  type Hash,
} from "viem";
import { getActiveChain } from "@pinely/shared/chains";
import { machineRegistryAbi, pinelyAccountAbi } from "@pinely/shared/contracts";
import { ContractNotDeployedError, getBackendChainId, requireDeployed } from "./config";

/**
 * Thrown when an authoritative onchain read cannot be completed (RPC unreachable, bad response).
 * Mapped to HTTP 503 so a caller can tell "the chain could not be read" from "the answer is no".
 */
export class ChainUnavailableError extends Error {
  constructor() {
    super("chain_unavailable");
    this.name = "ChainUnavailableError";
  }
}

export function chainUnavailableBody() {
  return {
    error: "chain_unavailable",
    message: "The chain could not be read right now. Try again shortly.",
  } as const;
}

export function readClient() {
  return createPublicClient({
    chain: getActiveChain(getBackendChainId()),
    transport: http(process.env.RPC_URL || undefined, { timeout: 8_000, retryCount: 1 }),
  });
}

function revertedWith(error: unknown, errorName: string): boolean {
  if (!(error instanceof BaseError)) return false;
  const reverted = error.walk((e) => e instanceof ContractFunctionRevertedError);
  return (
    reverted instanceof ContractFunctionRevertedError && reverted.data?.errorName === errorName
  );
}

export function logFailure(what: string, error: unknown): void {
  console.error(
    `[PINELY Backend] Onchain read failed (${what}):`,
    error instanceof Error ? error.message.split("\n")[0] : error,
  );
}

export interface OnchainMachine {
  account: Address;
  operator: Address;
  signer: Address;
}

/** Reads a machine from the MachineRegistry. Returns null when the registry says it does not exist. */
export async function readMachine(machineId: Hash): Promise<OnchainMachine | null> {
  try {
    const machine = (await readClient().readContract({
      address: requireDeployed("MachineRegistry"),
      abi: machineRegistryAbi,
      functionName: "getMachine",
      args: [machineId],
    })) as unknown as OnchainMachine;
    return { account: machine.account, operator: machine.operator, signer: machine.signer };
  } catch (error) {
    if (revertedWith(error, "MachineNotFound")) return null;
    // A missing deployment is its own, already-handled condition; do not hide it as a chain outage.
    if (error instanceof ContractNotDeployedError) throw error;
    logFailure("getMachine", error);
    throw new ChainUnavailableError();
  }
}

/** Reads the owner of a machine's smart account (the only address that may manage its session key). */
export async function readAccountOwner(account: Address): Promise<Address> {
  try {
    return (await readClient().readContract({
      address: account,
      abi: pinelyAccountAbi,
      functionName: "owner",
    })) as Address;
  } catch (error) {
    logFailure("account owner", error);
    throw new ChainUnavailableError();
  }
}

/** Reads whether `asset` is on a machine's asset allowlist. */
export async function readAssetAllowed(machineId: Hash, asset: Address): Promise<boolean> {
  try {
    return (await readClient().readContract({
      address: requireDeployed("MachineRegistry"),
      abi: machineRegistryAbi,
      functionName: "isAssetAllowed",
      args: [machineId, asset],
    })) as boolean;
  } catch (error) {
    if (error instanceof ContractNotDeployedError) throw error;
    logFailure("isAssetAllowed", error);
    throw new ChainUnavailableError();
  }
}
