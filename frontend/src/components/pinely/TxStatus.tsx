"use client";

import { activeChain } from "@/lib/chain";
import { explorerTxUrl, type TxState } from "@/hooks/usePreparedTx";

/** The line shown while an action runs. Actions with two wallet steps say "step 1 of 2". */
function progressLabel(state: TxState): string {
  const { step } = state;
  const multi = step !== undefined && step.total > 1;
  switch (state.phase) {
    case "preparing":
      return "Preparing transaction…";
    case "approval-signature":
    case "signature":
      return multi
        ? `Confirm step ${step.current} of ${step.total} in your wallet…`
        : "Confirm the transaction in your wallet…";
    case "approval-confirming":
    case "confirming":
      return multi
        ? `Waiting for step ${step.current} of ${step.total} to be mined…`
        : "Waiting for the transaction to be mined…";
    case "indexing":
      return "Mined onchain. Waiting for the indexer…";
    default:
      return "";
  }
}

interface TxStatusProps {
  state: TxState;
  busy: boolean;
  onDismiss: () => void;
}

/**
 * Floating status of the operator action in progress. It stays in view while you scroll, so an action
 * started from any card on a long page reports where you are looking. Success is shown only after the
 * chain (and then the indexer) agree. A cancelled wallet prompt is shown as a neutral note, never in
 * the error colour.
 */
export function TxStatus({ state, busy, onDismiss }: TxStatusProps) {
  if (state.phase === "idle") return null;
  const url = state.txHash ? explorerTxUrl(activeChain.id, state.txHash) : undefined;

  return (
    <div
      className="card"
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        right: "16px",
        bottom: "76px",
        zIndex: 45,
        width: "min(420px, calc(100vw - 32px))",
        padding: "16px 18px",
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.6)",
        overflowWrap: "anywhere",
      }}
    >
      {busy && <p>{progressLabel(state)}</p>}
      {state.phase === "cancelled" && <p style={{ color: "var(--mut-light)" }}>{state.notice}</p>}
      {state.phase === "error" && (
        <p role="alert" style={{ color: "#ff8fa3" }}>
          {state.error}
        </p>
      )}
      {state.phase === "done" && (
        <p>
          {state.indexed
            ? "Confirmed onchain and indexed."
            : "Confirmed onchain. The indexer has not caught up yet; the page updates shortly."}
        </p>
      )}
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          style={{ color: "var(--bl)", display: "inline-block", marginRight: "12px" }}
        >
          View transaction ↗
        </a>
      )}
      {!busy && (
        <button
          type="button"
          className="btn dark"
          onClick={onDismiss}
          style={{ minHeight: "44px", fontSize: "12px", marginTop: "8px" }}
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
