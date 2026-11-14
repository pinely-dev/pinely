"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useConfig, useSendTransaction, useSwitchChain } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { supportedChains, type SupportedChainId } from "@pinely/shared/chains";
import { findContractName } from "@pinely/shared/contracts";
import { activeChain, stablecoinSymbol } from "@/lib/chain";
import type { PreparedAction, PreparedTransaction } from "@pinely/shared/types";
import { describeWalletError } from "@pinely/shared/wallet-errors";
import { useWallet } from "@/providers/WalletContext";
import { isApiError } from "@/lib/http";

/**
 * Steps of an operator action. The backend only prepares calldata; the operator's wallet signs
 * and sends it, and the UI reports success only after the chain (and then the indexer) agree.
 *
 * `cancelled` is the user closing or rejecting a wallet prompt. It is neutral, not a failure.
 */
export type TxPhase =
  | "idle"
  | "preparing"
  | "approval-signature"
  | "approval-confirming"
  | "signature"
  | "confirming"
  | "indexing"
  | "done"
  | "cancelled"
  | "error";

export interface TxState {
  phase: TxPhase;
  /** Hash of the main transaction, once the wallet has sent it. */
  txHash?: `0x${string}`;
  /** Short, human message for `error`. */
  error?: string;
  /** Short, neutral message for `cancelled`. */
  notice?: string;
  /** Which wallet step is running, when an action needs more than one. */
  step?: { current: number; total: number };
  /** `false` when the transaction is mined but the indexer has not caught up within the wait. */
  indexed?: boolean;
}

export interface RunOptions {
  /** Query keys to refetch once the action is mined (and, if given, indexed). */
  invalidate?: QueryKey[];
  /**
   * Polls the backend until it reflects the change. Resolve `true` when it does. When omitted the
   * action is reported as done right after the receipt.
   */
  waitForIndexer?: () => Promise<boolean>;
}

const INDEXER_POLL_MS = 2_000;
const INDEXER_WAIT_MS = 30_000;
/** A cancellation clears itself; there is nothing for the user to act on. */
const CANCELLED_CLEAR_MS = 5_000;

const IDLE: TxState = { phase: "idle" };

export function explorerTxUrl(chainId: number, hash: string): string | undefined {
  const chain = supportedChains.find((c) => c.id === chainId);
  const base = chain?.blockExplorers?.default.url;
  return base ? `${base}/tx/${hash}` : undefined;
}

/** A failure whose message is already written for the user. */
class TxFailure extends Error {}

/** The user declined the notice that comes before the wallet prompt. */
class TxCancelled extends Error {}

/** Names the contract a transaction calls. An address that is not in the address book is never given a name. */
function contractLabel(chainId: number, address: string): string {
  const name = findContractName(chainId, address);
  const label =
    name === "STABLECOIN" || name === "MockUSDG"
      ? `${stablecoinSymbol} token`
      : name === "PINELY"
        ? "$PINELY token"
        : name;
  return `${label ?? "A contract that is not in the PINELY address book"} · ${address}`;
}

/** Fail closed: a prepared transaction for a chain this build does not support is never sent. */
function asSupportedChainId(chainId: number): SupportedChainId {
  const match = supportedChains.find((c) => c.id === chainId);
  if (!match) throw new TxFailure("This action targets a network this site does not support.");
  return match.id;
}

type Outcome = { phase: "cancelled"; notice: string } | { phase: "error"; error: string };

/** Maps anything thrown during an action to a short message. Raw error text never reaches the UI. */
function toOutcome(error: unknown, networkName: string): Outcome {
  if (error instanceof TxCancelled) {
    return { phase: "cancelled", notice: "Cancelled. Nothing was sent." };
  }
  if (error instanceof TxFailure || isApiError(error)) {
    // Both carry text written for people: backend messages and our own failures.
    return { phase: "error", error: error.message };
  }
  const info = describeWalletError(error, { networkName });
  console.error("Wallet action failed:", error);
  return info.severity === "info"
    ? { phase: "cancelled", notice: info.message }
    : { phase: "error", error: info.message };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Runs one operator action end to end: prepare calldata, switch to the right chain, send the
 * approval step (if any), send the transaction, wait for the receipt, then wait for the indexer.
 */
export function usePreparedTx() {
  const { isConnected, isAuthenticated, chainId, confirmBeforeSign } = useWallet();
  const config = useConfig();
  const queryClient = useQueryClient();
  const { sendTransactionAsync } = useSendTransaction();
  const { switchChainAsync } = useSwitchChain();
  const [state, setState] = useState<TxState>(IDLE);
  const running = useRef(false);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopClearTimer = useCallback(() => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = null;
  }, []);
  useEffect(() => stopClearTimer, [stopClearTimer]);

  const reset = useCallback(() => {
    stopClearTimer();
    setState(IDLE);
  }, [stopClearTimer]);

  const send = useCallback(
    async (tx: Pick<PreparedTransaction, "to" | "data" | "value">, chain: SupportedChainId) => {
      const hash = await sendTransactionAsync({
        to: tx.to,
        data: tx.data,
        value: BigInt(tx.value || "0"),
        chainId: chain,
      });
      return hash;
    },
    [sendTransactionAsync],
  );

  const run = useCallback(
    async (prepare: () => Promise<PreparedAction>, options: RunOptions = {}): Promise<boolean> => {
      if (running.current) return false; // one action at a time
      stopClearTimer();
      if (!isConnected) {
        setState({ phase: "error", error: "Connect your wallet first." });
        return false;
      }
      if (!isAuthenticated) {
        setState({ phase: "error", error: "Sign in with your wallet first." });
        return false;
      }

      running.current = true;
      let networkName: string = activeChain.name;
      try {
        setState({ phase: "preparing" });
        const prepared = await prepare();
        const target = asSupportedChainId(prepared.chainId);
        networkName = supportedChains.find((c) => c.id === target)?.name ?? networkName;
        const total = prepared.approvalStep ? 2 : 1;

        // Before the wallet asks: which network, which contract, and what the signature allows.
        const approved = await confirmBeforeSign({
          title: "Confirm before signing",
          network: `${networkName} (${target})`,
          steps: [
            ...(prepared.approvalStep
              ? [
                  {
                    contract: contractLabel(target, prepared.approvalStep.to),
                    permission: prepared.approvalStep.description,
                  },
                ]
              : []),
            { contract: contractLabel(target, prepared.to), permission: prepared.description },
          ],
        });
        if (!approved) throw new TxCancelled();

        if (chainId !== target) {
          await switchChainAsync({ chainId: target });
        }

        if (prepared.approvalStep) {
          setState({ phase: "approval-signature", step: { current: 1, total } });
          const approvalHash = await send(prepared.approvalStep, target);
          setState({
            phase: "approval-confirming",
            txHash: approvalHash,
            step: { current: 1, total },
          });
          const approval = await waitForTransactionReceipt(config, {
            hash: approvalHash,
            chainId: target,
          });
          if (approval.status !== "success") {
            throw new TxFailure("Step 1 failed onchain. Nothing else was sent.");
          }
        }

        setState({ phase: "signature", step: { current: total, total } });
        const hash = await send(prepared, target);
        setState({ phase: "confirming", txHash: hash, step: { current: total, total } });
        const receipt = await waitForTransactionReceipt(config, { hash, chainId: target });
        if (receipt.status !== "success") throw new TxFailure("The transaction failed onchain.");

        let indexed = true;
        if (options.waitForIndexer) {
          setState({ phase: "indexing", txHash: hash });
          indexed = false;
          const deadline = Date.now() + INDEXER_WAIT_MS;
          while (Date.now() < deadline) {
            try {
              if (await options.waitForIndexer()) {
                indexed = true;
                break;
              }
            } catch {
              // The indexer may be briefly unavailable; keep polling until the deadline.
            }
            await sleep(INDEXER_POLL_MS);
          }
        }

        await Promise.all(
          (options.invalidate ?? []).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
        );
        setState({ phase: "done", txHash: hash, indexed });
        return true;
      } catch (error) {
        const outcome = toOutcome(error, networkName);
        setState((prev) => ({ ...outcome, txHash: prev.txHash }));
        if (outcome.phase === "cancelled") {
          clearTimer.current = setTimeout(() => {
            setState((prev) => (prev.phase === "cancelled" ? IDLE : prev));
          }, CANCELLED_CLEAR_MS);
        }
        return false;
      } finally {
        running.current = false;
      }
    },
    [
      config,
      chainId,
      confirmBeforeSign,
      isAuthenticated,
      isConnected,
      queryClient,
      send,
      stopClearTimer,
      switchChainAsync,
    ],
  );

  return {
    state,
    run,
    reset,
    busy:
      state.phase !== "idle" &&
      state.phase !== "done" &&
      state.phase !== "error" &&
      state.phase !== "cancelled",
  };
}
