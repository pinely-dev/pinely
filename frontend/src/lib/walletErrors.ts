import { stablecoinSymbol, nativeSymbol } from "@/lib/chain";
/**
 * Sanitizer for Web3/viem/wagmi wallet transaction errors.
 * Ensures short, human-readable error messages without raw stack traces,
 * calldata hex dump, or library versioning, and provides neutral cancellation handling.
 */
export function formatWalletError(err: unknown): { message: string; isCancelled: boolean } {
  if (!err) {
    return { message: "An unknown error occurred.", isCancelled: false };
  }

  const errObj = err as Record<string, unknown>;
  const msg = err instanceof Error ? err.message : String(err);
  const shortMsg = typeof errObj.shortMessage === "string" ? errObj.shortMessage : msg;
  const lower = (shortMsg + " " + msg).toLowerCase();

  // 1. User rejection / cancellation (EIP-1193 code 4001 or UserRejectedRequestError)
  if (
    errObj.code === 4001 ||
    errObj.code === "ACTION_REJECTED" ||
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("rejected the request") ||
    lower.includes("transaction rejected") ||
    lower.includes("cancelled by user")
  ) {
    return { message: "Transaction cancelled by operator.", isCancelled: true };
  }

  // 2. Insufficient balance checks
  if (
    lower.includes("insufficient") &&
    (lower.includes("funds") || lower.includes("balance") || lower.includes("gas"))
  ) {
    if (
      lower.includes(stablecoinSymbol.toLowerCase()) ||
      lower.includes("transferfrom") ||
      lower.includes("transfer amount")
    ) {
      return {
        message: `Insufficient ${stablecoinSymbol} balance for the registration fee.`,
        isCancelled: false,
      };
    }
    return {
      message: `Insufficient ${nativeSymbol} balance to cover network gas fee.`,
      isCancelled: false,
    };
  }

  // 3. Contract spend policy reverts
  if (
    lower.includes("daily cap") ||
    lower.includes("spendcap") ||
    lower.includes("cap exceeded") ||
    lower.includes("dailycap")
  ) {
    return {
      message: "Transaction rejected: daily spend cap exceeded under Spend Policy.",
      isCancelled: false,
    };
  }

  if (lower.includes("frozen") || lower.includes("freeze")) {
    return {
      message: "Transaction blocked: machine or fleet is currently frozen.",
      isCancelled: false,
    };
  }

  if (
    lower.includes("network") ||
    lower.includes("rpc") ||
    lower.includes("timeout") ||
    lower.includes("disconnected")
  ) {
    return {
      message: "RPC network request timed out. Please check your connection and retry.",
      isCancelled: false,
    };
  }

  // 4. Clean up raw viem/ethers traces
  let clean = shortMsg;
  // Strip "Version: viem@..."
  clean = clean.split(/Version:\s*viem/i)[0];
  // Strip "Details:"
  clean = clean.split(/Details:/i)[0];
  // Strip raw long hex strings
  clean = clean.replace(/0x[a-fA-F0-9]{10,}/g, "0x...");
  clean = clean.replace(/\s+/g, " ").trim();

  // Avoid sentence-ending colons or dangling prefixes
  clean = clean.replace(/[:.-]+$/, "").trim();

  if (clean.length > 90) {
    clean = clean.substring(0, 87) + "...";
  }

  return {
    message: clean || "Transaction execution reverted on-chain.",
    isCancelled: false,
  };
}
