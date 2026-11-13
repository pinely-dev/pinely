"use client";

import { activeChain, stablecoinSymbol } from "@/lib/chain";
import type { BurnInflow } from "@pinely/shared/types";
import { DataState } from "@/components/pinely/DataState";
import { explorerTxUrl } from "@/hooks/usePreparedTx";
import { useBurnEvents, useBurnSources } from "@/lib/api";
import { formatCount, formatPinely, formatStable, shortHex } from "@/lib/machine-view";

const REASON_TEXT: Record<NonNullable<BurnInflow["reason"]>, string> = {
  not_indexed: "The indexer does not read this contract yet.",
  no_event_amount: "The contract emits no event with the amount.",
};

function formatTime(value: number | string): string {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return "n/a";
  return new Date(seconds * 1000).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatInflow(inflow: BurnInflow): string {
  if (!inflow.tracked || inflow.amount === undefined) return "Not tracked yet";
  return inflow.token === "PINELY"
    ? formatPinely(inflow.amount)
    : `${formatStable(inflow.amount)} ${inflow.token}`;
}

/**
 * Where the BurnVault's money comes from, and what it has burned. Amounts come from the indexer;
 * a source the indexer cannot measure says so instead of showing zero.
 */
export function BurnTracker() {
  const sources = useBurnSources();
  const burns = useBurnEvents();
  const recent = burns.data?.recentBurns ?? [];

  return (
    <div style={{ marginBottom: "36px" }}>
      <div className="card" style={{ padding: "20px 22px", marginBottom: "20px" }}>
        <h3>Burn Tracker</h3>
        <p className="note">
          The vault turns fee income into $PINELY and burns it. Fee income arrives in{" "}
          {stablecoinSymbol}, so the amounts below are what was routed to the vault, not what was
          burned.
        </p>
        <DataState
          isLoading={sources.isPending}
          error={sources.error}
          onRetry={() => sources.refetch()}
        >
          {sources.data && (
            <>
              <div className="kv">
                <div>
                  Total burned<b>{formatPinely(sources.data.burnedPinely)}</b>
                </div>
              </div>
              <div
                className="tw"
                role="region"
                aria-label="Burn sources table"
                tabIndex={0}
                style={{ marginTop: "12px" }}
              >
                <table className="tbl font-mono">
                  <thead>
                    <tr>
                      <th scope="col">Source</th>
                      <th scope="col">Routed to BurnVault</th>
                      <th scope="col">Events</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sources.data.inflows.map((inflow) => (
                      <tr key={inflow.key}>
                        <td>{inflow.label}</td>
                        <td>
                          {formatInflow(inflow)}
                          {!inflow.tracked && inflow.reason && (
                            <div style={{ fontSize: "12px", color: "var(--mut)" }}>
                              {REASON_TEXT[inflow.reason]}
                            </div>
                          )}
                        </td>
                        <td>{inflow.tracked ? formatCount(inflow.count ?? 0) : "n/a"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </DataState>
      </div>

      <div className="card" style={{ padding: "20px 22px" }}>
        <h3>Recent Burns</h3>
        <DataState
          isLoading={burns.isPending}
          error={burns.error}
          isEmpty={recent.length === 0}
          emptyMessage="No burns recorded yet."
          onRetry={() => burns.refetch()}
        >
          <div className="tw" role="region" aria-label="Recent burns table" tabIndex={0}>
            <table className="tbl font-mono">
              <thead>
                <tr>
                  <th scope="col">Time</th>
                  <th scope="col">Amount burned</th>
                  <th scope="col">Transaction</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((burn) => {
                  const url = explorerTxUrl(activeChain.id, burn.txHash);
                  return (
                    <tr key={burn.id}>
                      <td>{formatTime(burn.blockTimestamp)}</td>
                      <td>{formatPinely(burn.amountPinely)}</td>
                      <td>
                        {url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: "var(--bl)" }}
                          >
                            {shortHex(burn.txHash)} ↗
                          </a>
                        ) : (
                          shortHex(burn.txHash)
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
    </div>
  );
}
