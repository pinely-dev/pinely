"use client";

import { use, useState } from "react";
import Link from "next/link";
import { activeChain, stablecoinSymbol } from "@/lib/chain";
import { Navbar } from "@/components/pinely/Navbar";
import { PageBackground } from "@/components/pinely/PageBackground";
import { Footer } from "@/components/pinely/Footer";
import { DataState } from "@/components/pinely/DataState";
import { TextScramble } from "@/components/pinely/TextScramble";
import { TxStatus } from "@/components/pinely/TxStatus";
import { explorerTxUrl, usePreparedTx } from "@/hooks/usePreparedTx";
import {
  fetchMachineDetail,
  prepareFreezeAction,
  prepareUnfreezeAction,
  useMachineActivity,
  useMachineDetail,
} from "@/lib/api";
import { formatCount, formatStable, percentOf, shortHex, tierOf } from "@/lib/machine-view";
import { useWallet } from "@/providers/WalletContext";
import type { Hash } from "viem";

interface MachineDetailPageProps {
  params: Promise<{ machineId: string }>;
}

function formatTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "medium",
  });
}

export default function MachineDetailPage({ params }: MachineDetailPageProps) {
  const { machineId } = use(params);
  const detail = useMachineDetail(machineId);
  const activity = useMachineActivity(machineId, 10);
  const { address, isConnected } = useWallet();
  const tx = usePreparedTx();
  const [confirming, setConfirming] = useState(false);

  const machine = detail.data;
  const isOperator =
    isConnected && !!machine && address?.toLowerCase() === machine.operator.toLowerCase();

  const toggleFreeze = async () => {
    if (!machine) return;
    const freeze = !machine.frozen;
    setConfirming(false);
    await tx.run(
      () =>
        freeze
          ? prepareFreezeAction({ machineId: machineId as Hash })
          : prepareUnfreezeAction({ machineId: machineId as Hash }),
      {
        invalidate: [["machineDetail", machineId], ["machinesList"], ["ecosystemStats"]],
        // The change is real for the UI only once the indexer reports the new state.
        waitForIndexer: async () => (await fetchMachineDetail(machineId)).frozen === freeze,
      },
    );
  };

  const tier = machine ? tierOf(machine.tier) : null;

  return (
    <div className="frame">
      <PageBackground word="MACHINE" variant="desk" />
      <Navbar />
      <main id="main-content">
        <TxStatus state={tx.state} busy={tx.busy} onDismiss={tx.reset} />

        <section className="ph ph-haze ph-haze-machine-detail page-reveal-hero">
          <span className="tag">
            <b className="dot" aria-hidden="true" />
            <TextScramble text="MACHINE TELEMETRY DOSSIER" scrambleSpeed={22} revealSpeed={32} />
          </span>
          <h1 className="font-mono" style={{ wordBreak: "break-all" }}>
            {shortHex(machineId, 10, 8)}
          </h1>
          <p>
            <Link href="/machines" style={{ color: "var(--bl)" }}>
              ← Back to Registered Machines
            </Link>
          </p>
        </section>

        <section className="sec page-reveal-1" style={{ paddingTop: "12px" }}>
          <DataState
            isLoading={detail.isPending}
            error={detail.error}
            isEmpty={!machine}
            emptyMessage="Machine not found."
            onRetry={() => detail.refetch()}
          >
            {machine && tier && (
              <>
                <div className="fleet-header-strip" style={{ margin: "0 0 20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <span className={`pulse-beacon ${machine.frozen ? "red" : "green"}`} />
                    <span>
                      Status: <b>{machine.frozen ? "FROZEN" : "ACTIVE"}</b>
                    </span>
                  </div>
                  <span className={`tier-pill ${tier.css}`}>
                    {tier.name} ({tier.fee})
                  </span>
                </div>

                <div className="grid">
                  <div className="card">
                    <h3>Identity</h3>
                    <div className="kv">
                      <div>
                        Machine ID<b style={{ wordBreak: "break-all" }}>{machineId}</b>
                      </div>
                      <div>
                        Account<b style={{ wordBreak: "break-all" }}>{machine.account}</b>
                      </div>
                      <div>
                        Session Key<b style={{ wordBreak: "break-all" }}>{machine.signer}</b>
                      </div>
                      <div>
                        Operator<b style={{ wordBreak: "break-all" }}>{machine.operator}</b>
                      </div>
                      <div>
                        Attestation
                        <b>
                          {machine.attestationHash
                            ? `${shortHex(machine.attestationHash, 10, 8)} (${machine.attestationValid ? "valid" : "not valid"})`
                            : "None submitted"}
                        </b>
                      </div>
                      <div>
                        Registered
                        <b>
                          {machine.registeredAt ? formatTime(Number(machine.registeredAt)) : "n/a"}
                        </b>
                      </div>
                    </div>
                  </div>

                  <div className="card">
                    <h3>Spend Policy</h3>
                    <div className="kv">
                      <div>
                        Policy<b>{machine.policyEnabled ? "Enabled" : "Not set"}</b>
                      </div>
                      <div>
                        Per-swap cap
                        <b>
                          {formatStable(machine.maxStableOutPerSwap)} {stablecoinSymbol}
                        </b>
                      </div>
                      <div>
                        Daily cap
                        <b>
                          {formatStable(machine.dailyStableOutCap)} {stablecoinSymbol}
                        </b>
                      </div>
                      <div>
                        Used today
                        <b>
                          {formatStable(machine.usedToday)} {stablecoinSymbol}
                        </b>
                      </div>
                      <div>
                        Violations<b>{formatCount(machine.violations ?? 0)}</b>
                      </div>
                    </div>
                    <div className="spend-bar-track" style={{ marginTop: "10px" }}>
                      <div
                        className="spend-bar-fill"
                        style={{
                          width: `${percentOf(machine.usedToday, machine.dailyStableOutCap)}%`,
                          background: machine.frozen ? "#ff3333" : "var(--bl)",
                        }}
                      />
                    </div>
                  </div>

                  <div className="card">
                    <h3>Lifetime Totals</h3>
                    <div className="kv">
                      <div>
                        {stablecoinSymbol} settled
                        <b>
                          {formatStable(machine.totals?.totalStableOut ?? machine.totalStableOut)}
                        </b>
                      </div>
                      <div>
                        Swaps<b>{formatCount(machine.totals?.totalSwaps ?? machine.totalSwaps)}</b>
                      </div>
                      <div>
                        Facilitator payments<b>{formatStable(machine.totalFacilitatorSpent)}</b>
                      </div>
                    </div>
                  </div>
                </div>

                {isOperator && (
                  <div className="card" style={{ padding: "20px 22px", marginTop: "20px" }}>
                    <h3>Kill Switch</h3>
                    <p className="note">
                      {machine.frozen
                        ? "This machine is frozen. Unfreezing sends a transaction from your wallet."
                        : "Freezing makes every future UserOp from this machine revert. It sends a transaction from your wallet."}
                    </p>
                    {confirming ? (
                      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="btn red"
                          onClick={toggleFreeze}
                          style={{ minHeight: "44px" }}
                        >
                          {machine.frozen ? "Confirm unfreeze" : "Confirm freeze"}
                        </button>
                        <button
                          type="button"
                          className="btn dark"
                          onClick={() => setConfirming(false)}
                          style={{ minHeight: "44px" }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className={machine.frozen ? "btn dark" : "btn red"}
                        disabled={tx.busy}
                        onClick={() => setConfirming(true)}
                        style={{ minHeight: "44px" }}
                      >
                        {machine.frozen ? "Unfreeze machine" : "Freeze machine"}
                      </button>
                    )}
                  </div>
                )}

                <h2 style={{ marginTop: "32px", fontSize: "22px" }}>Recent Settlements</h2>
                <DataState
                  isLoading={activity.isPending}
                  error={activity.error}
                  isEmpty={(activity.data ?? []).length === 0}
                  emptyMessage="No settlements recorded for this machine yet."
                  onRetry={() => activity.refetch()}
                >
                  <div
                    className="tw"
                    role="region"
                    aria-label="Recent settlements table"
                    tabIndex={0}
                  >
                    <table className="tbl font-mono">
                      <thead>
                        <tr>
                          <th scope="col">Time</th>
                          <th scope="col">{stablecoinSymbol} out</th>
                          <th scope="col">Protocol fee</th>
                          <th scope="col">Transaction</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(activity.data ?? []).map((item) => {
                          const url = explorerTxUrl(activeChain.id, item.txHash);
                          return (
                            <tr key={item.id}>
                              <td>{formatTime(Number(item.blockTimestamp))}</td>
                              <td>{formatStable(item.stableOut)}</td>
                              <td>{formatStable(item.protocolFee)}</td>
                              <td>
                                {url ? (
                                  <a
                                    href={url}
                                    target="_blank"
                                    rel="noreferrer"
                                    style={{ color: "var(--bl)" }}
                                  >
                                    {shortHex(item.txHash)} ↗
                                  </a>
                                ) : (
                                  shortHex(item.txHash)
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </DataState>
              </>
            )}
          </DataState>
        </section>
      </main>
      <Footer />
    </div>
  );
}
