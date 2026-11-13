"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { isAddress, isHex, parseUnits, type Address, type Hash } from "viem";
import { Navbar } from "@/components/pinely/Navbar";
import { PageBackground } from "@/components/pinely/PageBackground";
import { Footer } from "@/components/pinely/Footer";
import { Select } from "@/components/pinely/Select";
import { DataState } from "@/components/pinely/DataState";
import { TextScramble } from "@/components/pinely/TextScramble";
import { CyberToggle } from "@/components/pinely/CyberToggle";
import { FleetBillingCard } from "@/components/pinely/FleetBillingCard";
import { FleetKeyControls } from "@/components/pinely/FleetKeyControls";
import { FleetViolationsCard } from "@/components/pinely/FleetViolationsCard";
import { RegisterMachineModal } from "@/components/pinely/RegisterMachineModal";
import { TxStatus } from "@/components/pinely/TxStatus";
import { usePreparedTx } from "@/hooks/usePreparedTx";
import { useScrollLock } from "@/lib/useScrollLock";
import { buildFleetCsv, downloadCsv, fetchAllOperatorMachines } from "@/lib/fleet-export";
import {
  computeMachineId,
  fetchFleetSummary,
  fetchMachineDetail,
  prepareFreezeAction,
  prepareUnfreezeAction,
  prepareRegisterAction,
  preparePolicyAction,
  prepareSweeperAction,
  useFleetSummary,
  useMachinesList,
  type BackendMachine,
} from "@/lib/api";
import { formatCount, formatStable, percentOf, shortHex, tierOf } from "@/lib/machine-view";
import { useWallet } from "@/providers/WalletContext";
import { stablecoinSymbol, blockTimeLabel } from "@/lib/chain";

/** Parses a stablecoin amount typed as dollars ("12.5") into 6-decimal base units, or null when invalid. */
function stableUnits(value: string): bigint | null {
  if (!/^\d+(\.\d{1,6})?$/.test(value.trim())) return null;
  return parseUnits(value.trim(), 6);
}

const SCOPE_OPTIONS = [
  { value: "fleet", label: "Whole fleet" },
  { value: "machine", label: "Single machine" },
] as const;

function machineIdOf(m: BackendMachine): Hash {
  return (m.machineId ?? m.id ?? "") as Hash;
}

export default function FleetPage() {
  const wallet = useWallet();
  const operator = wallet.isConnected ? wallet.address : undefined;
  const ready = Boolean(operator) && wallet.isAuthenticated;

  const summary = useFleetSummary(ready ? operator : undefined);
  const machinesQuery = useMachinesList(1, 100, { operator: ready ? operator : undefined });
  const machines = useMemo(() => machinesQuery.data?.data ?? [], [machinesQuery.data]);
  const machineOptions = useMemo(
    () => machines.map((m) => ({ value: machineIdOf(m), label: shortHex(machineIdOf(m), 8, 6) })),
    [machines],
  );
  const tx = usePreparedTx();

  const [mounted, setMounted] = useState(false);
  const [registerModalOpen, setRegisterModalOpen] = useState(false);
  const confirmInputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<{ id: Hash | "fleet"; freeze: boolean } | null>(null);
  const [confirmKeyword, setConfirmKeyword] = useState<string>("");

  useEffect(() => {
    setMounted(true);
  }, []);

  useScrollLock(Boolean(pending));

  useEffect(() => {
    if (pending) {
      confirmInputRef.current?.focus({ preventScroll: true });
    }
  }, [pending]);

  // Daily quota across the machines that have an enabled spend policy (amounts are 6-decimal stablecoin).
  const dailyQuota = useMemo(() => {
    let used = 0;
    let cap = 0;
    for (const m of machines) {
      if (!m.policyEnabled) continue;
      used += Number(m.usedToday ?? 0);
      cap += Number(m.dailyStableOutCap ?? 0);
    }
    return { used, cap, percent: percentOf(used, cap) };
  }, [machines]);
  const totalMachines = Number(machinesQuery.data?.meta.total ?? machines.length);

  // CSV export covers the whole fleet, not only the machines loaded on this page.
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const exportCsv = async () => {
    if (!operator) return;
    setExporting(true);
    setExportError(null);
    try {
      const all = await fetchAllOperatorMachines(operator);
      const day = new Date().toISOString().slice(0, 10);
      downloadCsv(`pinely-fleet-${day}.csv`, buildFleetCsv(all));
    } catch {
      setExportError("Could not export the fleet. Check your connection and try again.");
    } finally {
      setExporting(false);
    }
  };

  // Policy form
  const [policyMachine, setPolicyMachine] = useState("");
  const [perSwap, setPerSwap] = useState("");
  const [dailyCap, setDailyCap] = useState("");
  const [policyEnabled, setPolicyEnabled] = useState(true);
  const [policyError, setPolicyError] = useState<string | null>(null);

  // Sweeper form
  const [sweeperScope, setSweeperScope] = useState<"fleet" | "machine">("fleet");
  const [sweeperMachine, setSweeperMachine] = useState("");
  const [sweeperDestination, setSweeperDestination] = useState("");
  const [sweeperReserve, setSweeperReserve] = useState("");
  const [sweeperEnabled, setSweeperEnabled] = useState(true);
  const [sweeperError, setSweeperError] = useState<string | null>(null);

  // Register form
  const [account, setAccount] = useState("");
  const [signer, setSigner] = useState("");
  const [attestation, setAttestation] = useState("");
  const [regPerSwap, setRegPerSwap] = useState("10");
  const [regDaily, setRegDaily] = useState("50");
  const [registerError, setRegisterError] = useState<string | null>(null);

  const invalidate = [["machinesList"], ["fleetSummary"], ["ecosystemStats"]];

  const targetKeyword = pending?.freeze ? "FREEZE" : "UNFREEZE";

  const confirmFreeze = async () => {
    if (!pending || !operator) return;
    if (confirmKeyword.trim() !== targetKeyword) return;
    const { id, freeze } = pending;
    setPending(null);
    setConfirmKeyword("");
    if (id === "fleet") {
      await tx.run(
        () =>
          freeze
            ? prepareFreezeAction({ freezeFleet: true })
            : prepareUnfreezeAction({ unfreezeFleet: true }),
        {
          invalidate,
          waitForIndexer: async () =>
            (await fetchFleetSummary(operator)).profile?.fleetFrozen === freeze,
        },
      );
      return;
    }
    await tx.run(
      () =>
        freeze ? prepareFreezeAction({ machineId: id }) : prepareUnfreezeAction({ machineId: id }),
      { invalidate, waitForIndexer: async () => (await fetchMachineDetail(id)).frozen === freeze },
    );
  };

  const submitPolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    const max = stableUnits(perSwap);
    const daily = stableUnits(dailyCap);
    if (!isHex(policyMachine, { strict: true }) || policyMachine.length !== 66) {
      return setPolicyError("Select a machine.");
    }
    if (max === null || daily === null || max === 0n || daily === 0n) {
      return setPolicyError(
        `Enter both limits as positive ${stablecoinSymbol} amounts (up to 6 decimals).`,
      );
    }
    if (max > daily) return setPolicyError("The per-swap limit cannot exceed the daily cap.");
    setPolicyError(null);
    const id = policyMachine as Hash;
    await tx.run(
      () =>
        preparePolicyAction({
          machineId: id,
          maxStableOutPerSwap: max.toString(),
          dailyStableOutCap: daily.toString(),
          enabled: policyEnabled,
        }),
      {
        invalidate,
        waitForIndexer: async () => {
          const m = await fetchMachineDetail(id);
          return (
            BigInt(m.maxStableOutPerSwap) === max &&
            BigInt(m.dailyStableOutCap) === daily &&
            m.policyEnabled === policyEnabled
          );
        },
      },
    );
  };

  const submitSweeper = async (e: React.FormEvent) => {
    e.preventDefault();
    const reserve = stableUnits(sweeperReserve);
    if (!isAddress(sweeperDestination))
      return setSweeperError("Enter a valid destination address.");
    if (reserve === null)
      return setSweeperError(`Enter the reserve as a ${stablecoinSymbol} amount.`);
    if (sweeperScope === "machine" && !isHex(sweeperMachine, { strict: true })) {
      return setSweeperError("Select a machine.");
    }
    setSweeperError(null);
    // The sweeper is configured onchain and read back from the chain, so there is no indexer wait.
    await tx.run(() =>
      prepareSweeperAction({
        fleet: sweeperScope === "fleet",
        machineId: sweeperScope === "machine" ? (sweeperMachine as Hash) : undefined,
        reserveThreshold: reserve.toString(),
        destination: sweeperDestination as Address,
        enabled: sweeperEnabled,
      }),
    );
  };

  const submitRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const max = stableUnits(regPerSwap);
    const daily = stableUnits(regDaily);
    if (!isAddress(account) || !isAddress(signer)) {
      return setRegisterError("Enter valid account and session key addresses.");
    }
    if (attestation && !(isHex(attestation, { strict: true }) && attestation.length === 66)) {
      return setRegisterError("The attestation hash must be 0x followed by 64 hex characters.");
    }
    if (max === null || daily === null || max === 0n || daily === 0n || max > daily) {
      return setRegisterError(
        "Enter valid limits; the per-swap limit cannot exceed the daily cap.",
      );
    }
    setRegisterError(null);
    const id = computeMachineId(account as Address);
    const ok = await tx.run(
      () =>
        prepareRegisterAction({
          account: account as Address,
          signer: signer as Address,
          attestationHash: attestation ? (attestation as Hash) : undefined,
          maxStableOutPerSwap: max.toString(),
          dailyStableOutCap: daily.toString(),
        }),
      {
        invalidate,
        waitForIndexer: async () => {
          await fetchMachineDetail(id);
          return true;
        },
      },
    );
    if (ok) {
      setAccount("");
      setSigner("");
      setAttestation("");
    }
  };

  const fleetFrozen = summary.data?.profile?.fleetFrozen ?? false;
  const fleet = summary.data?.fleet;

  return (
    <div className="frame">
      <PageBackground word="FLEET" variant="desk" />
      <Navbar />
      <main id="main-content">
        <section className="ph ph-haze ph-haze-fleet page-reveal-hero">
          <span className="tag">
            <b className="dot" aria-hidden="true" />
            <TextScramble
              text="OPERATOR COMMAND DESK · STAGE 1"
              scrambleSpeed={22}
              revealSpeed={32}
            />
          </span>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              flexWrap: "wrap",
              gap: "16px",
            }}
          >
            <div>
              <h1 style={{ margin: "0 0 8px" }}>Fleet Control</h1>
              <p style={{ margin: 0, maxWidth: "640px" }}>
                Manage your registered machines. Every change is a transaction you sign with your
                wallet; this page shows the state the indexer reports after it is mined.
              </p>
            </div>
            {ready && (
              <button
                type="button"
                className="btn red"
                onClick={() => setRegisterModalOpen(true)}
                style={{
                  minHeight: "44px",
                  padding: "10px 22px",
                  fontSize: "13px",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                  whiteSpace: "nowrap",
                }}
              >
                <span>+</span>
                <span>Register Machine</span>
              </button>
            )}
          </div>
        </section>

        <section className="sec page-reveal-1" style={{ paddingTop: "20px" }}>
          {!wallet.isConnected ? (
            <div className="card" style={{ padding: "32px 28px", textAlign: "center" }}>
              <h2>Connect your operator wallet</h2>
              <p className="note" style={{ maxWidth: "480px", margin: "8px auto 20px" }}>
                Connect the wallet that registered and owns your physical hardware fleet on
                Robinhood Chain.
              </p>
              <button
                type="button"
                className="btn red"
                onClick={() => wallet.connectWallet()}
                style={{ minHeight: "44px", padding: "12px 28px" }}
              >
                Connect wallet
              </button>
            </div>
          ) : !wallet.isAuthenticated ? (
            <div className="card" style={{ padding: "32px 28px", textAlign: "center" }}>
              <h2>Sign in with Ethereum</h2>
              <p className="note" style={{ maxWidth: "480px", margin: "8px auto 20px" }}>
                Sign a cryptographic message to prove ownership of <b>{shortHex(wallet.address)}</b>
                . No gas or transaction fee is incurred.
              </p>
              <button
                type="button"
                className="btn red"
                disabled={wallet.isAuthenticating}
                onClick={() => wallet.signInWithEthereum()}
                style={{ minHeight: "44px", padding: "12px 28px" }}
              >
                {wallet.isAuthenticating ? "Waiting for signature…" : "Sign in with Ethereum"}
              </button>
              {wallet.authNotice && (
                <p role="status" style={{ color: "var(--mut-light)", marginTop: "12px" }}>
                  {wallet.authNotice}
                </p>
              )}
              {wallet.authError && (
                <p
                  role="alert"
                  style={{ color: "#ff8fa3", marginTop: "12px", overflowWrap: "anywhere" }}
                >
                  {wallet.authError}
                </p>
              )}
            </div>
          ) : (
            <>
              <TxStatus state={tx.state} busy={tx.busy} onDismiss={tx.reset} />

              {/* SECTION 01: COMMAND TELEMETRY */}
              <div className="section-hairline">
                <span>SECTION 01 · COMMAND TELEMETRY</span>
              </div>

              <DataState
                isLoading={summary.isPending}
                error={summary.error}
                onRetry={() => summary.refetch()}
              >
                {/* Top Command Status Strip */}
                <div
                  className={`fleet-command-banner card ${fleetFrozen ? "is-frozen" : "is-operational"}`}
                >
                  <div className="fleet-banner-left">
                    <div className="fleet-banner-status">
                      <span className="fleet-status-text font-mono">
                        {fleetFrozen
                          ? "FLEET STATUS: HALTED · KILL SWITCH ENGAGED"
                          : "FLEET STATUS: RUNNING"}
                      </span>
                    </div>
                    <div className="fleet-banner-meta font-mono">
                      <span>
                        OPERATOR: <b>{shortHex(operator ?? "", 6, 4)}</b>
                      </span>
                      <span className="meta-sep">/</span>
                      <span>
                        BLOCK TIME: <b>{blockTimeLabel}</b>
                      </span>
                      <span className="meta-sep">/</span>
                      <span>
                        STAGE 1: <b>ACTIVE</b>
                      </span>
                    </div>
                  </div>

                  <div className="fleet-banner-actions">
                    <button
                      type="button"
                      className="btn dark banner-export-btn"
                      disabled={exporting || machines.length === 0}
                      onClick={exportCsv}
                      title="Download full fleet inventory as CSV"
                    >
                      <span className="export-icon">⬇</span>
                      <span>{exporting ? "Exporting…" : "Export CSV"}</span>
                    </button>
                  </div>
                </div>

                {exportError && (
                  <p role="alert" style={{ color: "#ff8fa3", margin: "-12px 0 20px" }}>
                    {exportError}
                  </p>
                )}

                {/* Symmetrical 4-Card Metric Ledger */}
                <div className="metric-ledger-strip" style={{ margin: "0 0 36px" }}>
                  <div className="ledger-grid">
                    <div className="ledger-cell">
                      <span className="ledger-label font-mono">Registered Machines</span>
                      <span className="ledger-value">{formatCount(fleet?.totalMachines ?? 0)}</span>
                      <span className="ledger-sub font-mono">
                        {formatCount(fleet?.activeMachines ?? 0)} active ·{" "}
                        {formatCount(fleet?.frozenMachines ?? 0)} frozen
                      </span>
                    </div>

                    <div className="ledger-cell">
                      <span className="ledger-label font-mono">Reputation Tiers</span>
                      <span className="ledger-value">
                        {formatCount(fleet?.goldCount ?? 0)} /{" "}
                        {formatCount(fleet?.silverCount ?? 0)} /{" "}
                        {formatCount(fleet?.bronzeCount ?? 0)}
                      </span>
                      <span className="ledger-sub font-mono">Gold / Silver / Bronze</span>
                    </div>

                    <div className="ledger-cell">
                      <span className="ledger-label font-mono">Settled Volume</span>
                      <span className="ledger-value">
                        {formatStable(summary.data?.volume.totalStableOut)}
                      </span>
                      <span className="ledger-sub font-mono">
                        {formatCount(summary.data?.volume.totalSwaps ?? 0)} swaps executed
                      </span>
                    </div>

                    <div className="ledger-cell">
                      <span className="ledger-label font-mono">Daily Quota Used</span>
                      <span className="ledger-value">
                        {dailyQuota.cap > 0 ? `${dailyQuota.percent.toFixed(1)}%` : "n/a"}
                      </span>
                      <span className="ledger-sub font-mono">
                        {dailyQuota.cap > 0
                          ? `${formatStable(dailyQuota.used)} of ${formatStable(dailyQuota.cap)}`
                          : "No active spend limit"}
                        {machines.length < totalMachines ? ` (${machines.length} nodes)` : ""}
                      </span>
                    </div>
                  </div>
                </div>
              </DataState>

              {/* Tactical Emergency Kill Switch Console (2-Column Bay) */}
              <div className="kill-switch-console-card" style={{ marginBottom: "48px" }}>
                <div className="kill-switch-console-grid">
                  <div className="kill-switch-dossier">
                    <div className="card-top-badge-row" style={{ marginBottom: "12px" }}>
                      <span className="security-badge hazard font-mono">
                        <svg
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{
                            display: "inline-block",
                            verticalAlign: "middle",
                            marginRight: "6px",
                          }}
                          aria-hidden="true"
                        >
                          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                          <line x1="12" y1="9" x2="12" y2="13" />
                          <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                        SUB-SECOND CIRCUIT BREAKER
                      </span>
                      <span className="font-mono text-xs" style={{ color: "var(--mut-light)" }}>
                        MachineRegistry.sol
                      </span>
                    </div>
                    <h2 style={{ fontSize: "24px", margin: "0 0 10px", letterSpacing: "-0.01em" }}>
                      Emergency Fleet Kill Switch
                    </h2>
                    <p
                      className="note"
                      style={{ fontSize: "14px", lineHeight: "1.6", margin: "0 0 16px" }}
                    >
                      {fleetFrozen
                        ? "The entire fleet is currently halted. Session keys cannot execute UserOperations onchain. Disengaging the switch will submit a single transaction to restore normal operations."
                        : "Fires a single-transaction contract freeze across every registered rover in your fleet. Instantly halts session execution before field hardware or compromised credentials can cause capital loss."}
                    </p>
                    <div className="kill-switch-spec-list font-mono text-xs">
                      <div>
                        • AFFECTED SCOPE: <b>{formatCount(totalMachines)} hardware accounts</b>
                      </div>
                      <div>
                        • EXECUTION TIME: <b>{blockTimeLabel} block time</b>
                      </div>
                      <div>
                        • AUTHORIZATION: <b>Signed by Operator or Safe Multisig Guardian</b>
                      </div>
                    </div>
                  </div>

                  <div className="kill-switch-bezel">
                    <div className="kill-switch-hazard-frame">
                      <button
                        type="button"
                        className={`big-emergency-btn ${fleetFrozen ? "is-disengage" : "is-armed"}`}
                        disabled={tx.busy}
                        onClick={() => {
                          setConfirmKeyword("");
                          setPending({ id: "fleet", freeze: !fleetFrozen });
                        }}
                      >
                        <span className="big-btn-sub font-mono">
                          {fleetFrozen ? "[ STATUS: FROZEN ]" : "[ ARMED & STANDBY ]"}
                        </span>
                        <span className="big-btn-title">
                          {fleetFrozen ? "DISENGAGE KILL SWITCH" : "PRESS TO FREEZE FLEET"}
                        </span>
                        <span className="big-btn-caption font-mono">
                          {fleetFrozen
                            ? "RESTORE SESSION SIGNING RIGHTS"
                            : "HALT ALL MACHINE OPERATIONS"}
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* SECTION 02: HARDWARE FLEET ROSTER */}
              <div className="section-hairline">
                <span>SECTION 02 · HARDWARE FLEET ROSTER</span>
              </div>

              <div style={{ marginBottom: "48px" }}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "12px",
                    flexWrap: "wrap",
                    marginBottom: "16px",
                  }}
                >
                  <div>
                    <h2 style={{ fontSize: "22px", margin: "0 0 4px" }}>Registered Rover Nodes</h2>
                    <p className="note" style={{ margin: 0, fontSize: "13px" }}>
                      Detailed telemetry and spend consumption of hardware accounts owned by your
                      operator wallet.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn red"
                    onClick={() => setRegisterModalOpen(true)}
                    style={{
                      minHeight: "44px",
                      fontSize: "12px",
                      padding: "8px 18px",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                      fontWeight: 600,
                    }}
                  >
                    <span>+</span>
                    <span>Register Machine</span>
                  </button>
                </div>

                <DataState
                  isLoading={machinesQuery.isPending}
                  error={machinesQuery.error}
                  isEmpty={machines.length === 0}
                  emptyContent={
                    <div
                      style={{
                        padding: "36px 20px",
                        textAlign: "center",
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "12px",
                      }}
                    >
                      <div
                        style={{
                          width: "56px",
                          height: "56px",
                          borderRadius: "12px",
                          background: "rgba(255, 51, 102, 0.1)",
                          border: "1px solid rgba(255, 51, 102, 0.3)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: "var(--red)",
                        }}
                      >
                        <svg
                          width="28"
                          height="28"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
                          <line x1="8" y1="21" x2="16" y2="21" />
                          <line x1="12" y1="17" x2="12" y2="21" />
                        </svg>
                      </div>
                      <div>
                        <h3 style={{ fontSize: "18px", margin: "0 0 6px", color: "#ffffff" }}>
                          Your Hardware Fleet is Empty
                        </h3>
                        <p
                          className="note"
                          style={{ maxWidth: "460px", margin: "0 auto", fontSize: "13px" }}
                        >
                          No physical rovers or edge nodes are registered under this operator on
                          Robinhood Chain yet. Commission your first device to activate autonomous
                          session keys and spend limits.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn red"
                        onClick={() => setRegisterModalOpen(true)}
                        style={{ minHeight: "44px", padding: "10px 24px", marginTop: "8px" }}
                      >
                        + Register Your First Machine
                      </button>
                    </div>
                  }
                  onRetry={() => machinesQuery.refetch()}
                >
                  <div className="tw" role="region" aria-label="Your machines table" tabIndex={0}>
                    <table className="tbl font-mono">
                      <thead>
                        <tr>
                          <th scope="col">Rover Node ID</th>
                          <th scope="col">Reputation Tier</th>
                          <th scope="col">Daily Spend Limit</th>
                          <th scope="col">Status</th>
                          <th scope="col">Quick Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {machines.map((m) => {
                          const id = machineIdOf(m);
                          const tier = tierOf(m.tier);
                          return (
                            <tr key={id}>
                              <td>
                                <Link
                                  href={`/machines/${id}`}
                                  style={{ color: "var(--bl)", fontWeight: 600 }}
                                >
                                  {shortHex(id, 8, 6)}
                                </Link>
                                <div style={{ fontSize: "12px", color: "var(--mut)" }}>
                                  {shortHex(m.account)}
                                </div>
                              </td>
                              <td>
                                <span className={`tier-pill ${tier.css}`}>
                                  {tier.name} ({tier.fee})
                                </span>
                              </td>
                              <td>
                                <div style={{ fontSize: "12px" }}>
                                  {formatStable(m.usedToday)} /{" "}
                                  {m.policyEnabled ? formatStable(m.dailyStableOutCap) : "no limit"}
                                </div>
                                <div className="spend-bar-track" style={{ marginTop: "4px" }}>
                                  <div
                                    className="spend-bar-fill"
                                    style={{
                                      width: `${percentOf(m.usedToday, m.dailyStableOutCap)}%`,
                                    }}
                                  />
                                </div>
                              </td>
                              <td>
                                <span className={`status-badge ${m.frozen ? "frozen" : "active"}`}>
                                  <span className={`pulse-beacon ${m.frozen ? "red" : "green"}`} />
                                  {m.frozen ? "Frozen" : "Active"}
                                </span>
                              </td>
                              <td>
                                <button
                                  type="button"
                                  className="btn dark action-btn-compact"
                                  disabled={tx.busy}
                                  onClick={() => {
                                    setConfirmKeyword("");
                                    setPending({ id, freeze: !m.frozen });
                                  }}
                                  style={{
                                    minHeight: "36px",
                                    fontSize: "12px",
                                    padding: "6px 14px",
                                  }}
                                >
                                  {m.frozen ? "Unfreeze" : "Freeze"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </DataState>
              </div>

              {/* SECTION 03: FLEET INTELLIGENCE & SENTINEL AUDIT */}
              <div className="section-hairline">
                <span>SECTION 03 · FLEET INTELLIGENCE &amp; AUDIT</span>
              </div>

              <div className="grid bento-grid-2" style={{ marginBottom: "48px" }}>
                {operator && <FleetBillingCard operator={operator} />}
                {operator && <FleetViolationsCard operator={operator} />}
              </div>

              {/* SECTION 04: PROTOCOL ENFORCEMENT & PROVISIONING */}
              <div className="section-hairline">
                <span>SECTION 04 · PROTOCOL ENFORCEMENT &amp; PROVISIONING</span>
              </div>

              <div className="grid bento-grid-3" style={{ marginBottom: "48px" }}>
                {/* SPEND POLICY CARD */}
                <form
                  className="card bento-card"
                  onSubmit={submitPolicy}
                  style={{ padding: "28px 26px" }}
                >
                  <div className="card-top-badge-row">
                    <span className="security-badge routine font-mono">POLICY ENFORCEMENT</span>
                    <span className="font-mono text-xs" style={{ color: "var(--mut-light)" }}>
                      ERC-4337 CAP
                    </span>
                  </div>

                  <div style={{ marginTop: "12px", marginBottom: "16px" }}>
                    <h3 style={{ margin: "0 0 6px", fontSize: "20px" }}>Spend Policy</h3>
                    <p className="note" style={{ margin: 0, fontSize: "13px" }}>
                      Restricts individual swap volume and daily aggregate expenditure per machine.
                    </p>
                  </div>

                  <label
                    style={{ display: "flex", flexDirection: "column", width: "100%", gap: "6px" }}
                  >
                    <span
                      className="font-mono text-xs"
                      style={{ color: "var(--mut)", textTransform: "uppercase" }}
                    >
                      Target Rover Node
                    </span>
                    <Select
                      value={policyMachine}
                      onChange={setPolicyMachine}
                      options={machineOptions}
                      ariaLabel="Machine"
                      placeholder="Select a machine…"
                      mono
                    />
                  </label>

                  {/* Quick Preset Quota Chips */}
                  <div style={{ margin: "10px 0 6px" }}>
                    <span
                      className="font-mono text-xs"
                      style={{ color: "var(--mut)", display: "block", marginBottom: "6px" }}
                    >
                      QUICK QUOTA PRESETS
                    </span>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="chip-btn font-mono"
                        onClick={() => {
                          setPerSwap("10");
                          setDailyCap("50");
                        }}
                      >
                        $10 / $50
                      </button>
                      <button
                        type="button"
                        className="chip-btn font-mono"
                        onClick={() => {
                          setPerSwap("25");
                          setDailyCap("100");
                        }}
                      >
                        $25 / $100
                      </button>
                      <button
                        type="button"
                        className="chip-btn font-mono"
                        onClick={() => {
                          setPerSwap("50");
                          setDailyCap("250");
                        }}
                      >
                        $50 / $250
                      </button>
                    </div>
                  </div>

                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      width: "100%",
                      gap: "6px",
                      marginTop: "10px",
                    }}
                  >
                    <span
                      className="font-mono text-xs"
                      style={{ color: "var(--mut)", textTransform: "uppercase" }}
                    >
                      Max Per-Swap Limit ({stablecoinSymbol})
                    </span>
                    <input
                      className="fleet-input"
                      inputMode="decimal"
                      value={perSwap}
                      onChange={(e) => setPerSwap(e.target.value)}
                      placeholder="10"
                    />
                  </label>

                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      width: "100%",
                      gap: "6px",
                      marginTop: "10px",
                    }}
                  >
                    <span
                      className="font-mono text-xs"
                      style={{ color: "var(--mut)", textTransform: "uppercase" }}
                    >
                      Max Daily Aggregate Cap ({stablecoinSymbol})
                    </span>
                    <input
                      className="fleet-input"
                      inputMode="decimal"
                      value={dailyCap}
                      onChange={(e) => setDailyCap(e.target.value)}
                      placeholder="50"
                    />
                  </label>

                  {/* Cyber Hardware Toggle Switch */}
                  <div style={{ marginTop: "16px" }}>
                    <CyberToggle
                      checked={policyEnabled}
                      onChange={setPolicyEnabled}
                      label="Spend Policy Enforced"
                      description="Onchain rejection of any transaction exceeding limits"
                    />
                  </div>

                  {policyError && (
                    <p
                      role="alert"
                      style={{ color: "#ff8fa3", fontSize: "13px", marginTop: "12px" }}
                    >
                      {policyError}
                    </p>
                  )}

                  <button
                    type="submit"
                    className="btn red"
                    disabled={tx.busy}
                    style={{ minHeight: "44px", width: "100%", marginTop: "20px" }}
                  >
                    Save policy onchain
                  </button>
                </form>

                {/* SURPLUS SWEEPER CARD */}
                <form
                  className="card bento-card"
                  onSubmit={submitSweeper}
                  style={{ padding: "28px 26px" }}
                >
                  <div className="card-top-badge-row">
                    <span className="security-badge pass font-mono">TREASURY VALVE</span>
                    <span className="font-mono text-xs" style={{ color: "var(--mut-light)" }}>
                      AUTO-SWEEP
                    </span>
                  </div>

                  <div style={{ marginTop: "12px", marginBottom: "16px" }}>
                    <h3 style={{ margin: "0 0 6px", fontSize: "20px" }}>Surplus Sweeper</h3>
                    <p className="note" style={{ margin: 0, fontSize: "13px" }}>
                      Automated treasury valve: forwards rover balance exceeding reserve to your
                      Safe vault.
                    </p>
                  </div>

                  {/* Visual Valve Schematic */}
                  <div className="treasury-schematic font-mono text-xs">
                    <span>Node Balance</span>
                    <span className="schematic-arrow">──(excess &gt; reserve)──▶</span>
                    <span>Safe Multisig</span>
                  </div>

                  <label
                    style={{ display: "flex", flexDirection: "column", width: "100%", gap: "6px" }}
                  >
                    <span
                      className="font-mono text-xs"
                      style={{ color: "var(--mut)", textTransform: "uppercase" }}
                    >
                      Sweeper Scope
                    </span>
                    <Select
                      value={sweeperScope}
                      onChange={setSweeperScope}
                      options={SCOPE_OPTIONS}
                      ariaLabel="Scope"
                    />
                  </label>

                  {sweeperScope === "machine" && (
                    <label
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        width: "100%",
                        gap: "6px",
                        marginTop: "10px",
                      }}
                    >
                      <span
                        className="font-mono text-xs"
                        style={{ color: "var(--mut)", textTransform: "uppercase" }}
                      >
                        Target Rover Node
                      </span>
                      <Select
                        value={sweeperMachine}
                        onChange={setSweeperMachine}
                        options={machineOptions}
                        ariaLabel="Machine"
                        placeholder="Select a machine…"
                        mono
                      />
                    </label>
                  )}

                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      width: "100%",
                      gap: "6px",
                      marginTop: "10px",
                    }}
                  >
                    <span
                      className="font-mono text-xs"
                      style={{ color: "var(--mut)", textTransform: "uppercase" }}
                    >
                      Reserve Balance to Keep ({stablecoinSymbol})
                    </span>
                    <input
                      className="fleet-input"
                      inputMode="decimal"
                      value={sweeperReserve}
                      onChange={(e) => setSweeperReserve(e.target.value)}
                      placeholder="20"
                    />
                  </label>

                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      width: "100%",
                      gap: "6px",
                      marginTop: "10px",
                    }}
                  >
                    <span
                      className="font-mono text-xs"
                      style={{ color: "var(--mut)", textTransform: "uppercase" }}
                    >
                      Treasury Destination Address
                    </span>
                    <input
                      className="fleet-input font-mono"
                      value={sweeperDestination}
                      onChange={(e) => setSweeperDestination(e.target.value)}
                      placeholder="0x… (Safe Multisig / Cold Wallet)"
                      spellCheck={false}
                    />
                  </label>

                  {/* Cyber Hardware Toggle Switch */}
                  <div style={{ marginTop: "16px" }}>
                    <CyberToggle
                      checked={sweeperEnabled}
                      onChange={setSweeperEnabled}
                      label="Sweeper Active"
                      description="Enables automated sweeping during settlement ticks"
                    />
                  </div>

                  {sweeperError && (
                    <p
                      role="alert"
                      style={{ color: "#ff8fa3", fontSize: "13px", marginTop: "12px" }}
                    >
                      {sweeperError}
                    </p>
                  )}

                  <button
                    type="submit"
                    className="btn red"
                    disabled={tx.busy}
                    style={{ minHeight: "44px", width: "100%", marginTop: "20px" }}
                  >
                    Save sweeper onchain
                  </button>
                </form>

                {/* REGISTER A MACHINE CARD */}
                <form
                  className="card bento-card"
                  onSubmit={submitRegister}
                  style={{ padding: "28px 26px" }}
                >
                  <div className="card-top-badge-row">
                    <span className="security-badge sentinel font-mono">PROVISIONING DOCK</span>
                    <button
                      type="button"
                      className="copy-hash-btn font-mono"
                      onClick={() => setRegisterModalOpen(true)}
                      style={{
                        minHeight: "36px",
                        fontSize: "11px",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "4px",
                      }}
                    >
                      ⚡ Open Modal Wizard
                    </button>
                  </div>

                  <div style={{ marginTop: "12px", marginBottom: "16px" }}>
                    <h3 style={{ margin: "0 0 6px", fontSize: "20px" }}>Register a Machine</h3>
                    <p className="note" style={{ margin: 0, fontSize: "13px" }}>
                      Binds a physical node account to your operator registry on Robinhood Chain.
                    </p>
                  </div>

                  <label
                    style={{ display: "flex", flexDirection: "column", width: "100%", gap: "6px" }}
                  >
                    <span
                      className="font-mono text-xs"
                      style={{ color: "var(--mut)", textTransform: "uppercase" }}
                    >
                      STEP 1 · Machine Account Address
                    </span>
                    <input
                      className="fleet-input font-mono"
                      value={account}
                      onChange={(e) => setAccount(e.target.value)}
                      placeholder="0x… (Deterministic CREATE2 Address)"
                      spellCheck={false}
                    />
                  </label>

                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      width: "100%",
                      gap: "6px",
                      marginTop: "10px",
                    }}
                  >
                    <span
                      className="font-mono text-xs"
                      style={{ color: "var(--mut)", textTransform: "uppercase" }}
                    >
                      STEP 2 · Session Key Address (TPM Signer)
                    </span>
                    <input
                      className="fleet-input font-mono"
                      value={signer}
                      onChange={(e) => setSigner(e.target.value)}
                      placeholder="0x… (Hardware Key EOA)"
                      spellCheck={false}
                    />
                  </label>

                  <label
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      width: "100%",
                      gap: "6px",
                      marginTop: "10px",
                    }}
                  >
                    <span
                      className="font-mono text-xs"
                      style={{ color: "var(--mut)", textTransform: "uppercase" }}
                    >
                      STEP 3 · Hardware Attestation Hash (Optional)
                    </span>
                    <input
                      className="fleet-input font-mono"
                      value={attestation}
                      onChange={(e) => setAttestation(e.target.value)}
                      placeholder="0x… (32 bytes cryptographic proof)"
                      spellCheck={false}
                    />
                  </label>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr",
                      gap: "10px",
                      marginTop: "10px",
                    }}
                  >
                    <label
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        width: "100%",
                        gap: "6px",
                      }}
                    >
                      <span
                        className="font-mono text-xs"
                        style={{ color: "var(--mut)", textTransform: "uppercase" }}
                      >
                        Per-Swap ({stablecoinSymbol})
                      </span>
                      <input
                        className="fleet-input"
                        inputMode="decimal"
                        value={regPerSwap}
                        onChange={(e) => setRegPerSwap(e.target.value)}
                        placeholder="10"
                      />
                    </label>
                    <label
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        width: "100%",
                        gap: "6px",
                      }}
                    >
                      <span
                        className="font-mono text-xs"
                        style={{ color: "var(--mut)", textTransform: "uppercase" }}
                      >
                        Daily Cap ({stablecoinSymbol})
                      </span>
                      <input
                        className="fleet-input"
                        inputMode="decimal"
                        value={regDaily}
                        onChange={(e) => setRegDaily(e.target.value)}
                        placeholder="50"
                      />
                    </label>
                  </div>

                  {registerError && (
                    <p
                      role="alert"
                      style={{ color: "#ff8fa3", fontSize: "13px", marginTop: "12px" }}
                    >
                      {registerError}
                    </p>
                  )}

                  <button
                    type="submit"
                    className="btn red"
                    disabled={tx.busy}
                    style={{ minHeight: "44px", width: "100%", marginTop: "20px" }}
                  >
                    Commission machine
                  </button>
                </form>
              </div>

              {/* SECTION 05: CRYPTOGRAPHIC SECURITY VAULT */}
              <div className="section-hairline">
                <span>SECTION 05 · CRYPTOGRAPHIC SECURITY VAULT</span>
              </div>

              <FleetKeyControls
                operator={operator as string}
                machines={machines}
                tx={tx}
                guardian={summary.data?.profile?.guardian}
                invalidate={invalidate}
              />
            </>
          )}
        </section>
      </main>
      <Footer />

      {/* Centered Modal Pop-up with Keyword Confirmation (Portal avoids stacking context & auto-scroll) */}
      {mounted && pending && typeof document !== "undefined"
        ? createPortal(
            <div
              className="emergency-modal-backdrop"
              role="dialog"
              aria-modal="true"
              aria-labelledby="emergency-dialog-title"
            >
              <div className="emergency-modal-box">
                <div className="card-top-badge-row">
                  <span className="security-badge hazard font-mono">
                    CIRCUIT BREAKER SECURITY CHECK
                  </span>
                  <span className="font-mono text-xs" style={{ color: "var(--mut)" }}>
                    ONE-TX PROTOCOL FREEZE
                  </span>
                </div>

                <div>
                  <h3 id="emergency-dialog-title" style={{ fontSize: "20px", margin: "0 0 8px" }}>
                    {pending.freeze ? "Halt and Freeze" : "Resume and Unfreeze"}{" "}
                    {pending.id === "fleet"
                      ? "Entire Operator Fleet"
                      : `Machine ${shortHex(pending.id, 8, 6)}`}
                    ?
                  </h3>
                  <p className="note" style={{ margin: 0, fontSize: "13px", lineHeight: "1.6" }}>
                    {pending.freeze
                      ? "Freezing immediately revokes UserOp signing permissions across all target hardware nodes on MachineRegistry.sol. All automated swaps will be rejected."
                      : "Unfreezing restores UserOp signing authority for valid, non-expired session keys."}
                  </p>
                </div>

                <div style={{ marginTop: "4px" }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                    <span className="font-mono text-xs" style={{ color: "var(--mut)" }}>
                      TYPE <b style={{ color: "#ffffff" }}>{targetKeyword}</b> IN UPPERCASE TO
                      CONFIRM:
                    </span>
                    <input
                      ref={confirmInputRef}
                      className="emergency-keyword-input font-mono"
                      value={confirmKeyword}
                      onChange={(e) => setConfirmKeyword(e.target.value.toUpperCase())}
                      placeholder={targetKeyword}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </label>
                </div>

                <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
                  <button
                    type="button"
                    className="btn red"
                    disabled={tx.busy || confirmKeyword.trim() !== targetKeyword}
                    onClick={confirmFreeze}
                    style={{ minHeight: "44px", flex: 1 }}
                  >
                    {tx.busy ? "Confirming onchain…" : `Confirm ${targetKeyword}`}
                  </button>
                  <button
                    type="button"
                    className="btn dark"
                    onClick={() => {
                      setPending(null);
                      setConfirmKeyword("");
                    }}
                    style={{ minHeight: "44px" }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}

      <RegisterMachineModal
        isOpen={registerModalOpen}
        onClose={() => setRegisterModalOpen(false)}
        operator={operator}
        tx={tx}
        invalidate={invalidate}
      />
    </div>
  );
}
