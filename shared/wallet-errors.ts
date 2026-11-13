/**
 * Turns anything a wallet, wagmi or viem can throw into one short sentence for the user.
 *
 * The result never contains addresses, calldata, library names or versions: those belong in the
 * console, not in the interface. A user cancelling is a neutral outcome (`severity: "info"`), not an
 * error. Pure and dependency free, so it can be tested without a browser or a wallet.
 */
export type WalletErrorKind =
  | "user_rejected"
  | "request_pending"
  | "wrong_network"
  | "unknown_network"
  | "insufficient_funds"
  | "reverted"
  | "network_unreachable"
  | "wallet_disconnected"
  | "unknown";

export interface WalletErrorInfo {
  kind: WalletErrorKind;
  /** One short sentence, safe to show as is. */
  message: string;
  /** `info` is something the user chose (they cancelled); `error` is a real failure. */
  severity: "info" | "error";
}

export interface WalletErrorOptions {
  /** Name of the network the action needs, for example "Robinhood Chain Testnet". */
  networkName?: string;
  /** What the user was doing, used to word a cancellation: "Sign-in" gives "Sign-in cancelled." */
  action?: string;
}

/** Custom contract errors a user can reasonably cause, with a plain explanation. */
const KNOWN_REVERTS: Record<string, string> = {
  NotOperator: "Only the operator of this machine can do this.",
  NotGuardianOrOperator: "Only the operator or the guardian can do this.",
  NotOwner: "Only the owner of this account can do this.",
  MachineNotFound: "This machine is not registered.",
  MachineIsFrozen: "This machine is frozen.",
  InvalidSpendPolicy:
    "The spend limits are not valid. The per-swap limit cannot exceed the daily cap.",
  ZeroAmount: "The amount must be greater than zero.",
  ZeroAddress: "An address is missing or not valid.",
  InsufficientStake: "That amount is more than your active stake.",
  NoActiveUnbond: "You have no unstake in progress.",
  UnbondingNotMatured: "The unbonding period has not ended yet.",
};

interface ErrorShape {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  shortMessage?: unknown;
  data?: { errorName?: unknown } | null;
  cause?: unknown;
}

const MAX_DEPTH = 10;

/** The error and every `cause` below it, outermost first. */
function chain(error: unknown): ErrorShape[] {
  const out: ErrorShape[] = [];
  let current: unknown = error;
  for (let i = 0; i < MAX_DEPTH && typeof current === "object" && current !== null; i++) {
    out.push(current as ErrorShape);
    current = (current as ErrorShape).cause;
  }
  return out;
}

const text = (value: unknown): string => (typeof value === "string" ? value : "");

function names(errors: ErrorShape[]): Set<string> {
  return new Set(errors.map((e) => text(e.name)).filter(Boolean));
}

function codes(errors: ErrorShape[]): Set<number> {
  const found = new Set<number>();
  for (const e of errors) if (typeof e.code === "number") found.add(e.code);
  return found;
}

/** All message text of the chain, plus a bare string error. */
function messages(error: unknown, errors: ErrorShape[]): string {
  const parts = errors.flatMap((e) => [text(e.message), text(e.shortMessage)]);
  if (typeof error === "string") parts.push(error);
  return parts.join("\n");
}

function revertName(errors: ErrorShape[]): string | undefined {
  for (const e of errors) {
    const name = e.data && typeof e.data === "object" ? e.data.errorName : undefined;
    if (typeof name === "string" && name) return name;
  }
  return undefined;
}

export function isUserRejection(error: unknown): boolean {
  const errors = chain(error);
  return (
    names(errors).has("UserRejectedRequestError") ||
    codes(errors).has(4001) ||
    codes(errors).has(5750) ||
    /user (rejected|denied|cancel)|rejected the request|action[_ ]rejected/i.test(
      messages(error, errors),
    )
  );
}

export function describeWalletError(
  error: unknown,
  options: WalletErrorOptions = {},
): WalletErrorInfo {
  const network = options.networkName ?? "the PINELY network";
  const errors = chain(error);
  const errorNames = names(errors);
  const errorCodes = codes(errors);
  const all = messages(error, errors);

  if (isUserRejection(error)) {
    return {
      kind: "user_rejected",
      message: `${options.action ?? "Request"} cancelled.`,
      severity: "info",
    };
  }
  if (errorCodes.has(-32002) || /already (pending|processing)|request.*pending/i.test(all)) {
    return {
      kind: "request_pending",
      message: "A request is already open in your wallet. Finish or close it, then try again.",
      severity: "error",
    };
  }
  if (
    errorCodes.has(4902) ||
    /unrecognized chain|chain.*(not (been )?added|not configured)/i.test(all)
  ) {
    return {
      kind: "unknown_network",
      message: `Add ${network} to your wallet, then try again.`,
      severity: "error",
    };
  }
  if (
    errorNames.has("ChainMismatchError") ||
    /chain mismatch|does not match the target chain/i.test(all)
  ) {
    return {
      kind: "wrong_network",
      message: `Switch your wallet to ${network} to continue.`,
      severity: "error",
    };
  }
  if (
    errorNames.has("InsufficientFundsError") ||
    /insufficient (funds|balance)|exceeds the balance/i.test(all)
  ) {
    return {
      kind: "insufficient_funds",
      message: "Your wallet does not have enough balance for this, including network fees.",
      severity: "error",
    };
  }

  const revert = revertName(errors);
  if (
    revert ||
    errorNames.has("ContractFunctionRevertedError") ||
    /execution reverted|transaction (was )?reverted/i.test(all)
  ) {
    return {
      kind: "reverted",
      message: (revert && KNOWN_REVERTS[revert]) || "The contract rejected this transaction.",
      severity: "error",
    };
  }
  if (
    errorNames.has("HttpRequestError") ||
    errorNames.has("TimeoutError") ||
    errorNames.has("WebSocketRequestError") ||
    /failed to fetch|fetch failed|network ?error|timed? ?out|econnrefused/i.test(all)
  ) {
    return {
      kind: "network_unreachable",
      message: "The network is not responding. Try again in a moment.",
      severity: "error",
    };
  }
  if (
    errorNames.has("ConnectorNotConnectedError") ||
    errorNames.has("ConnectorNotFoundError") ||
    errorNames.has("ConnectorAccountNotFoundError")
  ) {
    return {
      kind: "wallet_disconnected",
      message: "Your wallet is not connected. Reconnect it and try again.",
      severity: "error",
    };
  }

  return { kind: "unknown", message: "Something went wrong. Please try again.", severity: "error" };
}
