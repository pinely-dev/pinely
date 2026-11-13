import { describe, expect, it } from "bun:test";
import { HttpRequestError, TimeoutError, UserRejectedRequestError } from "viem";
import { describeWalletError, isUserRejection } from "@pinely/shared/wallet-errors";

/** What a wallet or library error can look like: a named error, a bare code, or nested causes. */
const named = (name: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(`${name} raw library text`), { name, ...extra });

describe("describeWalletError", () => {
  it("treats a rejection as a neutral cancellation, not an error", () => {
    const inputs = [
      new UserRejectedRequestError(new Error("User rejected the request.")),
      { code: 4001, message: "MetaMask Tx Signature: User denied transaction signature." },
      named("TransactionExecutionError", { cause: { code: 4001 } }),
      "User rejected the request.",
    ];
    for (const input of inputs) {
      expect(isUserRejection(input)).toBe(true);
      expect(describeWalletError(input)).toEqual({
        kind: "user_rejected",
        message: "Request cancelled.",
        severity: "info",
      });
    }
  });

  it("words a cancellation with the action the user was doing", () => {
    expect(describeWalletError({ code: 4001 }, { action: "Sign-in" }).message).toBe(
      "Sign-in cancelled.",
    );
  });

  it("explains a request that is already open in the wallet", () => {
    expect(describeWalletError({ code: -32002 }).kind).toBe("request_pending");
    expect(describeWalletError(new Error("Request already pending for origin")).kind).toBe(
      "request_pending",
    );
  });

  it("names the network when the wallet is on the wrong one", () => {
    const info = describeWalletError(named("ChainMismatchError"), {
      networkName: "Robinhood Chain Testnet",
    });
    expect(info.kind).toBe("wrong_network");
    expect(info.message).toBe("Switch your wallet to Robinhood Chain Testnet to continue.");
    expect(info.severity).toBe("error");
  });

  it("asks the user to add a network the wallet does not know", () => {
    const info = describeWalletError(
      { code: 4902, message: "Unrecognized chain ID 46630. Try adding the chain." },
      { networkName: "Robinhood Chain Testnet" },
    );
    expect(info.kind).toBe("unknown_network");
    expect(info.message).toBe("Add Robinhood Chain Testnet to your wallet, then try again.");
  });

  it("reports insufficient funds without any amounts or addresses", () => {
    for (const input of [
      named("InsufficientFundsError"),
      new Error("insufficient funds for gas * price + value: have 0 want 12345"),
    ]) {
      const info = describeWalletError(input);
      expect(info.kind).toBe("insufficient_funds");
      expect(info.message).not.toMatch(/\d{4}/);
    }
  });

  it("turns known contract reverts into plain explanations, even when nested", () => {
    const nested = named("TransactionExecutionError", {
      cause: named("ContractFunctionExecutionError", {
        cause: named("ContractFunctionRevertedError", {
          data: { errorName: "UnbondingNotMatured" },
        }),
      }),
    });
    const info = describeWalletError(nested);
    expect(info.kind).toBe("reverted");
    expect(info.message).toBe("The unbonding period has not ended yet.");
  });

  it("falls back to a generic message for a revert it does not know", () => {
    const info = describeWalletError(
      named("ContractFunctionRevertedError", { data: { errorName: "SomethingInternal" } }),
    );
    expect(info.kind).toBe("reverted");
    expect(info.message).toBe("The contract rejected this transaction.");
    expect(info.message).not.toContain("SomethingInternal");
  });

  it("reports an unreachable network for RPC failures", () => {
    const inputs = [
      new HttpRequestError({ url: "https://rpc.example", status: 502 }),
      new TimeoutError({ body: {}, url: "https://rpc.example" }),
      new TypeError("fetch failed"),
    ];
    for (const input of inputs) {
      expect(describeWalletError(input).kind).toBe("network_unreachable");
    }
  });

  it("reports a disconnected wallet", () => {
    expect(describeWalletError(named("ConnectorNotConnectedError")).kind).toBe(
      "wallet_disconnected",
    );
  });

  it("never leaks library text, hex data, versions or addresses", () => {
    const leaky = new Error(
      `The contract function "stake" reverted with the following signature: 0x08c379a0 ` +
        `Contract Call: address: 0x5555555555555555555555555555555555555555 ` +
        `data: 0xa694fc3a0000000000000000000000000000000000000000000000000de0b6b3a7640000 ` +
        `Docs: https://viem.sh/docs Version: viem@2.56.9`,
    );
    const inputs: unknown[] = [
      leaky,
      "boom",
      null,
      undefined,
      42,
      {},
      [],
      new Error("x".repeat(5000)),
    ];
    for (const input of inputs) {
      const { message } = describeWalletError(input);
      expect(message.length).toBeLessThanOrEqual(120);
      expect(message).not.toMatch(/0x[0-9a-f]{4,}/i);
      expect(message).not.toMatch(/viem|version|docs:|http/i);
    }
  });

  it("answers the generic message for something it cannot classify", () => {
    expect(describeWalletError(new Error("weird internal state"))).toEqual({
      kind: "unknown",
      message: "Something went wrong. Please try again.",
      severity: "error",
    });
  });

  it("survives a circular cause chain", () => {
    const a: { cause?: unknown } = {};
    a.cause = a;
    expect(describeWalletError(a).kind).toBe("unknown");
  });
});
