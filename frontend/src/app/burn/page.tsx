"use client";

import { useState } from "react";
import Link from "next/link";
import { formatUnits } from "viem";
import { findContractAddress } from "@pinely/shared/contracts";
import { activeChain, stablecoinSymbol, nativeSymbol, blockTimeLabel } from "@/lib/chain";
import { useBurnEvents } from "@/lib/api";
import { shortHex } from "@/lib/machine-view";
import { TextScramble } from "@/components/pinely/TextScramble";
import { BurnTracker } from "@/components/pinely/BurnTracker";
import { Navbar } from "@/components/pinely/Navbar";
import { PageBackground } from "@/components/pinely/PageBackground";
import { Footer } from "@/components/pinely/Footer";
import { TokenCa } from "@/components/pinely/TokenCa";

const VOLUME_PRESETS = [100000, 250000, 500000, 1000000, 5000000];

export default function BurnPage() {
  const [projectedVolume, setProjectedVolume] = useState<number>(500000);

  // Stage 2: BurnVault is only live where it has been deployed. Without an address there is nothing to read.
  const burnVault = findContractAddress(activeChain.id, "BurnVault");
  const burns = useBurnEvents();
  const burnedToDate = burns.data
    ? // $PINELY is an 18-decimal ERC-20; the indexer stores raw base units.
      `${Number(formatUnits(BigInt(burns.data.totalBurnedPinely.split(".")[0] || "0"), 18)).toLocaleString("en-US", { maximumFractionDigits: 2 })} $PINELY`
    : null;

  // Fee calculation:
  // Hook fee: 0.05% on swap volume
  // Protocol fee stream: 20% to BurnVault
  // Facilitator fee: 0.1% on machine payments (estimated ~30% of total volume)
  const hookFeeAccrued = projectedVolume * 0.0005;
  const facilitatorAccrued = projectedVolume * 0.3 * 0.001;
  const monthlyProtocolFees = hookFeeAccrued + facilitatorAccrued + 5000; // includes SDK and registration float
  const monthlyToBurnVaultStable = monthlyProtocolFees * 0.2 + 2500; // includes launchpad split allocation
  const estimatedTokenPrice = 0.1; // simulated baseline price $0.10
  const estimatedTokensBurned = monthlyToBurnVaultStable / estimatedTokenPrice;

  return (
    <div className="frame">
      <PageBackground word="BURN" variant="desk" />
      <Navbar />
      <main id="main-content">
        {/* Header */}
        <section className="ph ph-haze ph-haze-burn page-reveal-hero">
          <span className="tag">
            <b className="dot" aria-hidden="true" />
            <TextScramble
              text="DEFLATIONARY BURN ENGINE · $PINELY"
              scrambleSpeed={22}
              revealSpeed={32}
            />
          </span>
          <h1>Fees in, $PINELY out.</h1>
          <p>
            Real operational cash flows from autonomous machines convert continuously into $PINELY
            burning. Every burn permanently destroys tokens and emits an onchain indexed{" "}
            <code className="font-mono text-zinc-200">Burned(uint256 amount)</code> event.
          </p>
        </section>

        {/* BurnVault Command Telemetry Banner */}
        <div className="burn-telemetry-banner font-mono page-reveal-1">
          <div className="telemetry-banner-left">
            <span className={`status-pill ${burnVault ? "active" : "standby"}`}>
              <span className={`pulse-beacon ${burnVault ? "green" : "red"}`} />
              <span>
                {burnVault ? "ONLINE · DEPLOYED (STAGE 2)" : "STANDBY · STAGE 2 REHEARSAL"}
              </span>
            </span>
            <div className="telemetry-contract-info">
              <span className="telemetry-label">BURN CONTRACT:</span>
              {burnVault ? (
                <a
                  href={`${activeChain.blockExplorers?.default.url}/address/${burnVault}`}
                  target="_blank"
                  rel="noreferrer"
                  className="telemetry-contract-link"
                >
                  <b>BurnVault ({shortHex(burnVault)})</b>
                  <span className="external-link-icon" aria-hidden="true">
                    ↗
                  </span>
                </a>
              ) : (
                <span className="telemetry-contract-offline">
                  <b>BurnVault not deployed (Stage 2)</b>
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
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--bl)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
              </svg>
              <span style={{ color: "var(--bl)", fontWeight: 600 }}>
                {!burnVault
                  ? "Standby · Not live yet"
                  : burns.isPending
                    ? "Loading burn total…"
                    : burnedToDate
                      ? `Burned: ${burnedToDate}`
                      : "Burn total unavailable"}
              </span>
            </span>
            <span className="telemetry-chip">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
              <span>100% Non-Custodial Burn</span>
            </span>
            <span className="telemetry-chip">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>Block time {blockTimeLabel}</span>
            </span>
          </div>
        </div>

        <section className="sec" style={{ paddingTop: "12px" }}>
          {/* Live tracker: only where BurnVault exists; otherwise the page says it is not live yet. */}
          {burnVault && <BurnTracker />}

          {/* Dual Fee Stream Allocation Grid */}
          <div className="burn-flow-grid">
            {/* Stream 1: Launchpad Creator Trading Fees */}
            <div className="flow-card">
              <div className="flow-card-header">
                <div className="flow-card-topbar">
                  <span className="text-xs uppercase tracking-wider text-crimson-400 font-mono">
                    CREATOR REVENUE STREAM · 30 / 70 CASH FLOW
                  </span>
                  <span className="tier-pill gold">30% Burn Stream</span>
                </div>
                <h2 className="flow-card-title">Launchpad & Secondary Trading Volume</h2>
                <p className="note" style={{ lineHeight: 1.5, margin: 0 }}>
                  Trading fees generated at the token launch venue flow directly through
                  CreatorFeeSplitter.sol into automated token burning.
                </p>
              </div>

              {/* Dual Pillar Display */}
              <div className="split-cockpit-hero">
                <div className="split-dual-pillars">
                  {/* Burn Pillar */}
                  <div className="split-pillar-card burn-pillar">
                    <div className="split-pillar-badge burn-badge font-mono">
                      <span className="burn-dot" aria-hidden="true" />
                      <span>AUTOMATED BURN</span>
                    </div>
                    <div className="split-pillar-percentage burn-val font-mono">
                      30<span className="percentage-symbol">%</span>
                    </div>
                    <div className="split-pillar-target font-mono">
                      <span className="target-label">DESTINATION</span>
                      <span className="target-code">BurnVault.sol</span>
                    </div>
                    <div className="split-pillar-desc">
                      Converted into $PINELY and destroyed onchain.
                    </div>
                  </div>

                  {/* Treasury Pillar */}
                  <div className="split-pillar-card treasury-pillar">
                    <div className="split-pillar-badge treasury-badge font-mono">
                      <span>PROTOCOL TREASURY</span>
                    </div>
                    <div className="split-pillar-percentage treasury-val font-mono">
                      70<span className="percentage-symbol">%</span>
                    </div>
                    <div className="split-pillar-target font-mono">
                      <span className="target-label">DESTINATION</span>
                      <span className="target-code">Safe Multisig (2-of-3)</span>
                    </div>
                    <div className="split-pillar-desc">
                      Ecosystem expansion & operational runway.
                    </div>
                  </div>
                </div>

                {/* Segmented Flow Bar */}
                <div className="split-meter-wrapper">
                  <div
                    className="split-meter-bar"
                    role="progressbar"
                    aria-valuenow={30}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Creator fee split: 30% burn, 70% treasury"
                  >
                    <div className="split-meter-burn" style={{ width: "30%" }}>
                      30% BURN
                    </div>
                    <div className="split-meter-remainder" style={{ width: "70%" }}>
                      70% TREASURY
                    </div>
                  </div>
                  <div className="split-meter-ticks font-mono">
                    <span>0% INFLOW</span>
                    <span className="split-tick-marker">30% / 70% SPLIT RATIO</span>
                    <span>100% SETTLED</span>
                  </div>
                </div>
              </div>

              {/* Dossier Specifications */}
              <div className="dossier-spec-list" style={{ marginTop: "12px", marginBottom: 0 }}>
                <div className="dossier-spec-row">
                  <span className="dossier-spec-label">EXECUTION CONTRACT</span>
                  <span className="dossier-spec-val font-mono">CreatorFeeSplitter.sol</span>
                </div>
                <div className="dossier-spec-row">
                  <span className="dossier-spec-label">SETTLEMENT ASSET</span>
                  <span className="dossier-spec-val font-mono">
                    {stablecoinSymbol} (6 Decimals)
                  </span>
                </div>
                <div className="dossier-spec-row">
                  <span className="dossier-spec-label">INFLOW ORIGIN</span>
                  <span className="dossier-spec-val font-mono">Launch venue to be announced</span>
                </div>
                <div className="dossier-spec-row">
                  <span className="dossier-spec-label">CUSTODY RISK</span>
                  <span className="dossier-spec-val font-mono text-zinc-300">
                    Zero Custody · Autonomous Route
                  </span>
                </div>
              </div>
            </div>

            {/* Stream 2: DePIN Infrastructure Fees */}
            <div className="flow-card">
              <div className="flow-card-header">
                <div className="flow-card-topbar">
                  <span className="text-xs uppercase tracking-wider text-crimson-400 font-mono">
                    PROTOCOL REVENUE STREAM · 20 / 80 CASH FLOW
                  </span>
                  <span className="tier-pill silver">20% Burn Stream</span>
                </div>
                <h2 className="flow-card-title">DePIN Machine Infrastructure & Swaps</h2>
                <p className="note" style={{ lineHeight: 1.5, margin: 0 }}>
                  Revenues collected in {stablecoinSymbol} across the stack: Uniswap v4 Hook swap
                  fees (0.05%), machine registrations ($2), SDK node fees ($1/mo), and Facilitator
                  payments (0.1%).
                </p>
              </div>

              {/* Dual Pillar Display */}
              <div className="split-cockpit-hero">
                <div className="split-dual-pillars">
                  {/* Burn Pillar */}
                  <div className="split-pillar-card burn-pillar">
                    <div className="split-pillar-badge burn-badge font-mono">
                      <span className="burn-dot" aria-hidden="true" />
                      <span>AUTOMATED BURN</span>
                    </div>
                    <div className="split-pillar-percentage burn-val font-mono">
                      20<span className="percentage-symbol">%</span>
                    </div>
                    <div className="split-pillar-target font-mono">
                      <span className="target-label">DESTINATION</span>
                      <span className="target-code">BurnVault.sol</span>
                    </div>
                    <div className="split-pillar-desc">
                      Surplus revenues continuously retired into $PINELY.
                    </div>
                  </div>

                  {/* Operations Pillar */}
                  <div className="split-pillar-card ops-pillar">
                    <div className="split-pillar-badge ops-badge font-mono">
                      <span>DEPIN OPERATIONS</span>
                    </div>
                    <div className="split-pillar-percentage ops-val font-mono">
                      80<span className="percentage-symbol">%</span>
                    </div>
                    <div className="split-pillar-target font-mono">
                      <span className="target-label">DESTINATION</span>
                      <span className="target-code">PinelyPaymaster + Infra</span>
                    </div>
                    <div className="split-pillar-desc">
                      {nativeSymbol} native gas subsidies & hardware keeper fleet.
                    </div>
                  </div>
                </div>

                {/* Segmented Flow Bar */}
                <div className="split-meter-wrapper">
                  <div
                    className="split-meter-bar"
                    role="progressbar"
                    aria-valuenow={20}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Protocol fee split: 20% burn, 80% operations"
                  >
                    <div className="split-meter-burn" style={{ width: "20%" }}>
                      20% BURN
                    </div>
                    <div className="split-meter-remainder" style={{ width: "80%" }}>
                      80% OPERATIONS
                    </div>
                  </div>
                  <div className="split-meter-ticks font-mono">
                    <span>0% INFLOW</span>
                    <span className="split-tick-marker">20% / 80% SPLIT RATIO</span>
                    <span>100% SETTLED</span>
                  </div>
                </div>
              </div>

              {/* Dossier Specifications */}
              <div className="dossier-spec-list" style={{ marginTop: "12px", marginBottom: 0 }}>
                <div className="dossier-spec-row">
                  <span className="dossier-spec-label">EXECUTION CONTRACTS</span>
                  <span className="dossier-spec-val font-mono">
                    PinelyHook.sol & SurplusSweeper.sol
                  </span>
                </div>
                <div className="dossier-spec-row">
                  <span className="dossier-spec-label">SETTLEMENT ASSET</span>
                  <span className="dossier-spec-val font-mono">
                    {stablecoinSymbol} (6 Decimals)
                  </span>
                </div>
                <div className="dossier-spec-row">
                  <span className="dossier-spec-label">REVENUE STREAMS</span>
                  <span className="dossier-spec-val font-mono">
                    Uniswap v4 (0.05%) + Fleet ($2) + SDK ($1)
                  </span>
                </div>
                <div className="dossier-spec-row">
                  <span className="dossier-spec-label">GAS SPONSORSHIP</span>
                  <span className="dossier-spec-val font-mono text-zinc-300">
                    80% Surplus to Machine Paymaster
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Burn Calculator */}
          <div className="calc-box" style={{ marginTop: "36px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                flexWrap: "wrap",
                gap: "10px",
              }}
            >
              <div>
                <span className="text-xs uppercase tracking-wider text-zinc-400 font-mono">
                  SIMULATION · TOKENOMICS CASH FLOW PROJECTION
                </span>
                <h2
                  style={{ fontSize: "24px", fontWeight: 700, color: "#ffffff", marginTop: "4px" }}
                >
                  Monthly Burn Volume Estimator
                </h2>
              </div>
              <span className="tier-pill silver">Priced in {stablecoinSymbol}</span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(320px, 100%), 1fr))",
                gap: "32px",
                alignItems: "start",
              }}
            >
              {/* Input Controls */}
              <div className="form">
                <label
                  style={{
                    fontSize: "12px",
                    color: "var(--mut-light)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                  }}
                >
                  <span>PROJECTED MONTHLY FLEET TRANSACTION VOLUME ({stablecoinSymbol})</span>
                  <input
                    type="number"
                    step="50000"
                    min="10000"
                    value={projectedVolume}
                    onChange={(e) =>
                      setProjectedVolume(Math.max(10000, parseInt(e.target.value, 10) || 10000))
                    }
                    className="fleet-input font-mono"
                    style={{ fontSize: "16px", fontWeight: 600 }}
                  />
                </label>
                <div className="burn-preset-chips font-mono">
                  <span className="preset-chips-label">QUICK PRESETS:</span>
                  {VOLUME_PRESETS.map((vol) => (
                    <button
                      key={vol}
                      type="button"
                      onClick={() => setProjectedVolume(vol)}
                      className={`burn-preset-btn ${projectedVolume === vol ? "active" : ""}`}
                      aria-label={`Set projected volume to $${vol >= 1000000 ? `${vol / 1000000}M` : `${vol / 1000}K`}`}
                    >
                      ${vol >= 1000000 ? `${vol / 1000000}M` : `${vol / 1000}K`}
                    </button>
                  ))}
                </div>
                <span className="note" style={{ display: "block", marginTop: "10px" }}>
                  Autonomous volume processed across rovers, EV chargers, drones, and machine
                  payments.
                </span>
              </div>

              {/* Executive Economics Matrix */}
              <div className="stake-econ-matrix font-mono">
                <div className="stake-econ-row">
                  <span className="stake-econ-label">PROJECTED MONTHLY VOLUME</span>
                  <span className="stake-econ-val">
                    ${projectedVolume.toLocaleString("en-US")} {stablecoinSymbol}
                  </span>
                </div>
                <div className="stake-econ-row">
                  <span className="stake-econ-label">GROSS PROTOCOL FEES ACCRUED</span>
                  <span className="stake-econ-val">
                    ${monthlyProtocolFees.toFixed(2)} {stablecoinSymbol}
                  </span>
                </div>
                <div className="stake-econ-row">
                  <span className="stake-econ-label">ALLOCATED TO BURNVAULT (20% + CREATOR)</span>
                  <span className="stake-econ-val">
                    ${monthlyToBurnVaultStable.toFixed(2)} {stablecoinSymbol} / mo
                  </span>
                </div>
                <div className="stake-econ-row">
                  <span className="stake-econ-label">SIMULATED TOKEN PRICE</span>
                  <span className="stake-econ-val">
                    ${estimatedTokenPrice.toFixed(2)} {stablecoinSymbol} (Stage 2 Base)
                  </span>
                </div>
                <div className="stake-econ-row highlight">
                  <span className="stake-econ-label" style={{ color: "#ffffff", fontWeight: 700 }}>
                    EST. MONTHLY $PINELY RETIRED
                  </span>
                  <span className="stake-econ-val annual-val">
                    ~{estimatedTokensBurned.toLocaleString("en-US", { maximumFractionDigits: 0 })}{" "}
                    $PINELY
                  </span>
                </div>
                <div className="stake-econ-row">
                  <span className="stake-econ-label">BURN EXECUTION MECHANISM</span>
                  <span className="stake-econ-val" style={{ color: "var(--bl)" }}>
                    100% Permissionless Onchain Call
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Section Hairline Label */}
          <div className="section-hairline-label" style={{ marginTop: "48px" }}>
            <span>SECTION 02 · ARCHITECTURAL GUARANTEES & ONCHAIN VERIFICATION</span>
          </div>

          {/* Architectural Guarantees Grid */}
          <div className="grid" style={{ marginTop: "18px" }}>
            <div className="card" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <span className="card-module-badge font-mono">MODULE 01 · PERMISSIONLESS</span>
                <span className="status-indicator-dot online" aria-hidden="true" />
              </div>
              <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#ffffff", margin: 0 }}>
                Autonomous Permissionless Execution
              </h2>
              <p className="note" style={{ lineHeight: 1.5, margin: 0 }}>
                Anyone can trigger <code className="font-mono text-xs">BurnVault.burn()</code>{" "}
                permissionlessly once accumulated {stablecoinSymbol} reaches the minimum swap
                threshold. No team keys or multisig authorizations required.
              </p>
            </div>

            <div className="card" style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <span className="card-module-badge font-mono">MODULE 02 · TRACEABILITY</span>
                <span className="status-indicator-dot online" aria-hidden="true" />
              </div>
              <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#ffffff", margin: 0 }}>
                Full Onchain Traceability
              </h2>
              <p className="note" style={{ lineHeight: 1.5, margin: 0 }}>
                Every burn transaction emits an indexed{" "}
                <code className="font-mono text-xs">Burned(uint256 amount)</code> event readable on
                the Robinhood Chain block explorer and ingested in real time by Ponder.
              </p>
            </div>

            <div
              className="card hl"
              style={{ display: "flex", flexDirection: "column", gap: "10px" }}
            >
              <div
                style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
              >
                <span
                  className="card-module-badge font-mono"
                  style={{ color: "var(--bl)", borderColor: "rgba(224, 72, 107, 0.4)" }}
                >
                  MODULE 03 · IMMUTABILITY
                </span>
                <span className="status-indicator-dot online" aria-hidden="true" />
              </div>
              <h2 style={{ fontSize: "18px", fontWeight: 700, color: "#ffffff", margin: 0 }}>
                Zero Backdoors Guarantee
              </h2>
              <p className="note" style={{ lineHeight: 1.5, margin: 0 }}>
                No owner drain function, no emergency withdrawal to private keys, and no pause
                mechanisms. Accrued revenue can only be swapped into $PINELY and burned.
              </p>
            </div>
          </div>

          {/* Footer Notes & Navigation */}
          <div
            style={{
              marginTop: "36px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: "16px",
            }}
          >
            <div style={{ display: "grid", gap: "4px", maxWidth: "560px" }}>
              <TokenCa variant="footer" />
              <p className="note" style={{ marginTop: "8px" }}>
                STAGE 2 REHEARSAL · BurnVault and PinelyStake are not deployed on mainnet yet, so
                nothing is burned or staked onchain today.
              </p>
            </div>
            <div style={{ display: "flex", gap: "12px" }}>
              <Link href="/stake" className="btn dark" style={{ fontSize: "13px" }}>
                Explore Reputational Staking →
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
