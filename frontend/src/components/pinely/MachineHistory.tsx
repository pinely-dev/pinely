"use client";

import { useMemo } from "react";
import { activeChain, stablecoinSymbol } from "@/lib/chain";
import { DataState } from "@/components/pinely/DataState";
import { explorerTxUrl } from "@/hooks/usePreparedTx";
import { useMachineActivity, useMachinePayments } from "@/lib/api";
import { formatStable, shortHex } from "@/lib/machine-view";

const HISTORY_LIMIT = 20;
/** The merged list shows at most this many rows, newest first. */
const VISIBLE_ROWS = 25;

interface HistoryRow {
  id: string;
  kind: "Revenue swap" | "Service payment";
  /** Unix seconds. */
  time: number;
  /** What moved: a stablecoin amount, signed by direction. */
  amount: string;
  detail: string;
  txHash: string;
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "n/a";
  return new Date(seconds * 1000).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Transaction history of one machine: revenue swaps from the indexer and service payments made
 * through the Facilitator, merged newest first. Both sources are real records with a transaction
 * hash; nothing is estimated or filled in.
 */
export function MachineHistory({ machineId }: { machineId: string }) {
  const swaps = useMachineActivity(machineId, HISTORY_LIMIT);
  const payments = useMachinePayments(machineId, HISTORY_LIMIT);

  const rows = useMemo<HistoryRow[]>(() => {
    const swapRows: HistoryRow[] = (swaps.data ?? []).map((s) => ({
      id: `swap:${s.id}`,
      kind: "Revenue swap",
      time: Number(s.blockTimestamp),
      amount: `+${formatStable(s.stableOut)}`,
      detail: `Protocol fee ${formatStable(s.protocolFee)}`,
      txHash: s.txHash,
    }));
    const paymentRows: HistoryRow[] = (payments.data ?? []).map((p) => ({
      id: `payment:${p.id}`,
      kind: "Service payment",
      time: Number(p.createdAt),
      amount: `−${formatStable(p.amount)}`,
      detail: `To ${shortHex(p.recipient)}`,
      txHash: p.txHash,
    }));
    return [...swapRows, ...paymentRows].sort((a, b) => b.time - a.time).slice(0, VISIBLE_ROWS);
  }, [swaps.data, payments.data]);

  return (
    <div className="card" style={{ padding: "20px 22px", marginTop: "20px" }}>
      <h3>Transaction History</h3>
      <DataState
        isLoading={swaps.isPending || payments.isPending}
        error={swaps.error ?? payments.error}
        isEmpty={rows.length === 0}
        emptyMessage="This machine has no transactions yet."
        onRetry={() => {
          swaps.refetch();
          payments.refetch();
        }}
      >
        <p className="note">
          Latest {rows.length} of this machine&apos;s revenue swaps and service payments.
        </p>
        <div className="tw" role="region" aria-label="Transaction history table" tabIndex={0}>
          <table className="tbl font-mono">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Type</th>
                <th scope="col">Amount ({stablecoinSymbol})</th>
                <th scope="col">Detail</th>
                <th scope="col">Transaction</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const url = explorerTxUrl(activeChain.id, row.txHash);
                return (
                  <tr key={row.id}>
                    <td>{formatTime(row.time)}</td>
                    <td>{row.kind}</td>
                    <td>{row.amount}</td>
                    <td>{row.detail}</td>
                    <td>
                      {url ? (
                        <a
                          href={url}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "var(--bl)" }}
                        >
                          {shortHex(row.txHash)} ↗
                        </a>
                      ) : (
                        shortHex(row.txHash)
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </DataState>
    </div>
  );
}
