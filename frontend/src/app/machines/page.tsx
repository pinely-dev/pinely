"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { findContractAddress } from "@pinely/shared/contracts";
import { activeChain, stablecoinSymbol, blockTimeLabel } from "@/lib/chain";
import { Navbar } from "@/components/pinely/Navbar";
import { PageBackground } from "@/components/pinely/PageBackground";
import { Footer } from "@/components/pinely/Footer";
import { DataState } from "@/components/pinely/DataState";
import { TextScramble } from "@/components/pinely/TextScramble";
import { useEcosystemStats, useMachinesList, type BackendMachine } from "@/lib/api";
import { formatCount, formatStable, percentOf, shortHex, tierOf } from "@/lib/machine-view";

const PAGE_SIZE = 20;

type StatusFilter = "all" | "active" | "frozen";

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "frozen", label: "Frozen" },
];

function machineKey(m: BackendMachine): string {
  return m.machineId ?? m.id ?? m.account;
}

function getPageWindow(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  if (current <= 4) {
    return [1, 2, 3, 4, 5, "ellipsis", total];
  }
  if (current >= total - 3) {
    return [1, "ellipsis", total - 4, total - 3, total - 2, total - 1, total];
  }
  return [1, "ellipsis", current - 1, current, current + 1, "ellipsis", total];
}

export default function MachinesPage() {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);

  // Search runs on the server, so wait for a pause in typing before asking.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const stats = useEcosystemStats();
  const list = useMachinesList(page, PAGE_SIZE, {
    frozen: status === "all" ? undefined : status === "frozen",
    search: debouncedSearch,
  });

  const registry = findContractAddress(activeChain.id, "MachineRegistry");
  const machines = list.data?.data ?? [];
  const total = list.data?.meta.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const startItem = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const endItem = Math.min(page * PAGE_SIZE, total);

  const totalMachinesCount = stats.data?.totalMachines ?? 0;
  const activeMachinesCount = stats.data?.activeMachines ?? 0;
  const frozenMachinesCount = Math.max(0, Number(totalMachinesCount) - Number(activeMachinesCount));

  const getFilterCount = (key: StatusFilter): number | string => {
    if (!stats.data) return "…";
    if (key === "all") return formatCount(totalMachinesCount);
    if (key === "active") return formatCount(activeMachinesCount);
    if (key === "frozen") return formatCount(frozenMachinesCount);
    return "0";
  };

  const changeStatus = (next: StatusFilter) => {
    setStatus(next);
    setPage(1);
  };

  return (
    <div className="frame">
      <PageBackground word="EXPLORER" variant="desk" />
      <Navbar />
      <main id="main-content">
        {/* Page Header */}
        <section className="ph ph-haze ph-haze-machines page-reveal-hero">
          <span className="tag">
            <b className="dot" aria-hidden="true" />
            <TextScramble
              text="HARDWARE REGISTRY · ON-CHAIN LEDGER"
              scrambleSpeed={22}
              revealSpeed={32}
            />
          </span>
          <h1>Registered Machines Explorer</h1>
          <p>
            Public ledger of machines registered on Robinhood Chain. Inspect operators, active spend
            policies, and settlement totals read from the PINELY indexer.
          </p>
        </section>

        {/* Operator Callout: Directs users looking to register machines to Fleet Command Desk */}
        <section className="sec page-reveal-1" style={{ paddingTop: "0", paddingBottom: "16px" }}>
          <div
            className="card"
            style={{
              padding: "16px 20px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "14px",
              background: "rgba(255, 51, 102, 0.04)",
              border: "1px solid rgba(255, 51, 102, 0.22)",
              borderRadius: "10px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
              <span
                style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  background: "var(--red)",
                  boxShadow: "0 0 10px var(--red)",
                  flexShrink: 0,
                }}
                aria-hidden="true"
              />
              <div>
                <span
                  style={{ fontSize: "14px", fontWeight: 600, color: "#ffffff", display: "block" }}
                >
                  Looking to onboard new hardware?
                </span>
                <span style={{ fontSize: "12px", color: "var(--mut-light)" }}>
                  Machine registration and TPM session key provisioning is managed from the Operator
                  Command Desk.
                </span>
              </div>
            </div>
            <Link
              href="/fleet"
              className="btn red"
              style={{
                minHeight: "44px",
                padding: "8px 20px",
                fontSize: "12px",
                fontWeight: 600,
                whiteSpace: "nowrap",
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              <span>Go to Fleet Desk</span>
              <span>→</span>
            </Link>
          </div>
        </section>

        {/* Metric summary: values come from the indexer, never from a static list */}
        <section className="sec page-reveal-1" style={{ paddingTop: "0", paddingBottom: "12px" }}>
          <div className="metric-ledger-strip" style={{ margin: "0 0 20px" }}>
            <div className="ledger-grid">
              <div className="ledger-cell">
                <span className="ledger-label">Registered Nodes</span>
                <span className="ledger-value">
                  {stats.data ? formatCount(stats.data.totalMachines) : "n/a"}
                </span>
                <span className="ledger-sub">
                  {stats.data
                    ? `${formatCount(stats.data.activeMachines)} not frozen`
                    : "Unavailable"}
                </span>
              </div>
              <div className="ledger-cell">
                <span className="ledger-label">Operators</span>
                <span className="ledger-value">
                  {stats.data ? formatCount(stats.data.totalOperators) : "n/a"}
                </span>
                <span className="ledger-sub">Distinct fleet owners</span>
              </div>
              <div className="ledger-cell">
                <span className="ledger-label">Lifetime Swap Volume</span>
                <span className="ledger-value">
                  {stats.data ? formatStable(stats.data.totalStableSwapped) : "n/a"}
                </span>
                <span className="ledger-sub">{stablecoinSymbol} (6 decimals)</span>
              </div>
              <div className="ledger-cell">
                <span className="ledger-label">Total Swaps</span>
                <span className="ledger-value">
                  {stats.data ? formatCount(stats.data.totalSwaps) : "n/a"}
                </span>
                <span className="ledger-sub">Settled through PinelyHook</span>
              </div>
            </div>
          </div>

          {/* Registry telemetry strip */}
          <div className="registry-telemetry-banner font-mono">
            <div className="telemetry-banner-left">
              <span className={`status-pill ${registry ? "active" : "standby"}`}>
                <span className={`pulse-beacon ${registry ? "green" : "red"}`} />
                <span>{registry ? "ONLINE · DEPLOYED" : "STANDBY · NOT DEPLOYED"}</span>
              </span>
              <div className="telemetry-contract-info">
                <span className="telemetry-label">REGISTRY CONTRACT:</span>
                {registry ? (
                  <a
                    href={`${activeChain.blockExplorers?.default.url}/address/${registry}`}
                    target="_blank"
                    rel="noreferrer"
                    className="telemetry-contract-link"
                  >
                    <b>MachineRegistry ({shortHex(registry)})</b>
                    <span className="external-link-icon" aria-hidden="true">
                      ↗
                    </span>
                  </a>
                ) : (
                  <span className="telemetry-contract-offline">
                    <b>MachineRegistry not deployed</b>
                    <span className="telemetry-chain-note">
                      {" "}
                      on {activeChain.name} ({activeChain.id})
                    </span>
                  </span>
                )}
              </div>
            </div>

            <div className="telemetry-banner-right">
              <span className="telemetry-chip">
                <span className="telemetry-chip-dot" />
                <span>Block time {blockTimeLabel}</span>
              </span>
              <span className="telemetry-chip network">
                <span>
                  {activeChain.name} ({activeChain.id})
                </span>
              </span>
            </div>
          </div>
        </section>

        <section className="sec" style={{ paddingTop: "12px" }}>
          {/* Search & filter bar */}
          <div className="table-toolbar">
            <div className="search-input-wrap">
              <svg
                className="search-icon-svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                placeholder="Search by machine ID, account, or operator address..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="search-input font-mono"
                aria-label="Search registered machines"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => {
                    setSearch("");
                    setPage(1);
                  }}
                  className="search-clear-btn"
                  aria-label="Clear search query"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="filter-group">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => changeStatus(f.key)}
                  className={`filter-btn ${status === f.key ? "active" : ""}`}
                >
                  <span>{f.label}</span>
                  <span className="filter-count-badge font-mono">{getFilterCount(f.key)}</span>
                </button>
              ))}
            </div>
          </div>

          <DataState
            isLoading={list.isPending}
            error={list.error}
            isEmpty={machines.length === 0}
            emptyMessage={
              debouncedSearch || status !== "all"
                ? "No registered machines match this filter."
                : "No machines are registered yet."
            }
            onRetry={() => list.refetch()}
          >
            <div className="tw" role="region" aria-label="Registered machines table" tabIndex={0}>
              <table className="tbl font-mono">
                <thead>
                  <tr>
                    <th scope="col">Machine ID</th>
                    <th scope="col">Account & Session Key</th>
                    <th scope="col">Operator</th>
                    <th scope="col">Fee Tier</th>
                    <th scope="col">Daily Spend Quota</th>
                    <th scope="col">Onchain Status</th>
                    <th scope="col" style={{ minWidth: "160px" }}>
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {machines.map((m) => {
                    const id = machineKey(m);
                    const tier = tierOf(m.tier);
                    const spendPercent = percentOf(m.usedToday, m.dailyStableOutCap);
                    return (
                      <tr key={id}>
                        <td>
                          <Link
                            href={`/machines/${id}`}
                            style={{
                              fontWeight: 600,
                              color: "var(--bl)",
                              textDecoration: "underline",
                              textUnderlineOffset: "3px",
                            }}
                          >
                            {shortHex(id, 8, 6)}
                          </Link>
                        </td>
                        <td>
                          <div style={{ fontWeight: 500, color: "#ffffff" }}>
                            {shortHex(m.account)}
                          </div>
                          <div style={{ fontSize: "12px", color: "var(--mut-light)" }}>
                            Signer {shortHex(m.signer)}
                          </div>
                        </td>
                        <td>
                          <div style={{ fontWeight: 500, color: "#ffffff" }}>
                            {shortHex(m.operator)}
                          </div>
                        </td>
                        <td>
                          <span className={`tier-pill ${tier.css}`}>
                            {tier.name} ({tier.fee})
                          </span>
                        </td>
                        <td>
                          <div className="spend-bar-container">
                            <div
                              style={{
                                display: "flex",
                                justifyContent: "space-between",
                                fontSize: "12px",
                              }}
                            >
                              <span>{formatStable(m.usedToday)}</span>
                              <span style={{ color: "var(--mut)" }}>
                                {m.policyEnabled ? formatStable(m.dailyStableOutCap) : "No policy"}
                              </span>
                            </div>
                            <div className="spend-bar-track">
                              <div
                                className="spend-bar-fill"
                                style={{
                                  width: `${spendPercent}%`,
                                  background: m.frozen ? "#ff3333" : "var(--bl)",
                                }}
                              />
                            </div>
                            <div
                              style={{ fontSize: "12px", color: "var(--mut)", marginTop: "2px" }}
                            >
                              Max/swap: {formatStable(m.maxStableOutPerSwap)} {stablecoinSymbol}
                            </div>
                          </div>
                        </td>
                        <td>
                          <span className={`status-badge ${m.frozen ? "frozen" : "active"}`}>
                            <span className={`pulse-beacon ${m.frozen ? "red" : "green"}`} />
                            {m.frozen ? "Frozen" : "Active"}
                          </span>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                            <Link
                              href={`/machines/${id}`}
                              className="registry-action-btn inspect"
                              aria-label={`Inspect machine ${id}`}
                            >
                              Inspect →
                            </Link>
                            <Link
                              href={`/passport?id=${id}`}
                              className="registry-action-btn passport"
                              aria-label={`View machine passport for ${id}`}
                            >
                              Passport ↗
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* High-End Registry Pagination Cockpit */}
            <div className="registry-pagination-bar font-mono">
              <div className="pagination-range-info text-xs">
                <span>
                  Showing{" "}
                  <b>
                    {startItem}–{endItem}
                  </b>{" "}
                  of <b>{formatCount(total)}</b> registered machine{total === 1 ? "" : "s"}
                </span>
              </div>

              <div className="pagination-controls">
                <button
                  type="button"
                  className="pagination-btn nav"
                  disabled={page <= 1 || list.isFetching}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  ← Prev
                </button>

                {pageCount > 1 && (
                  <div className="pagination-pages-group">
                    {getPageWindow(page, pageCount).map((item, idx) =>
                      item === "ellipsis" ? (
                        <span key={`ellipsis-${idx}`} className="pagination-ellipsis">
                          …
                        </span>
                      ) : (
                        <button
                          key={item}
                          type="button"
                          className={`pagination-page-btn ${item === page ? "active" : ""}`}
                          onClick={() => setPage(item)}
                          disabled={list.isFetching}
                          aria-label={`Go to page ${item}`}
                          aria-current={item === page ? "page" : undefined}
                        >
                          {item}
                        </button>
                      ),
                    )}
                  </div>
                )}

                <button
                  type="button"
                  className="pagination-btn nav"
                  disabled={page >= pageCount || list.isFetching}
                  onClick={() => setPage((p) => p + 1)}
                  aria-label="Next page"
                >
                  Next →
                </button>
              </div>
            </div>
          </DataState>

          <p className="note" style={{ marginTop: "16px" }}>
            Data is read from the PINELY indexer on {activeChain.name} ({activeChain.id}).
          </p>
        </section>
      </main>
      <Footer />
    </div>
  );
}
