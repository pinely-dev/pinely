"use client";

import { useState } from "react";
import Link from "next/link";
import { findContractAddress } from "@pinely/shared/contracts";
import { activeChain, stablecoinSymbol } from "@/lib/chain";
import { Navbar } from "@/components/pinely/Navbar";
import { PageBackground } from "@/components/pinely/PageBackground";
import { StakePanel } from "@/components/pinely/StakePanel";
import { TextScramble } from "@/components/pinely/TextScramble";
import { Footer } from "@/components/pinely/Footer";
import { Stage2Banner } from "@/components/pinely/StageBadge";
import { activeStage2State } from "@/lib/stage2";
import { shortHex } from "@/lib/machine-view";

const FLEET_PRESETS = [5, 10, 25, 50, 100];

export default function StakePage() {
  const [fleetSize, setFleetSize] = useState<number>(10);
  const [monthlyVolumePerNode, setMonthlyVolumePerNode] = useState<number>(2500);

  // PinelyStake.MIN_STAKE_GOLD: one threshold per operator, whatever the fleet size.
  const totalRequiredStake = 10_000;
  const stakeContract = findContractAddress(activeChain.id, "PinelyStake");
  const stage2State = activeStage2State();
  const stakeOnline = Boolean(stakeContract) && stage2State === "active";

  const totalMonthlyVolume = fleetSize * monthlyVolumePerNode;
  const bronzeMonthlyFee = totalMonthlyVolume * 0.003; // 0.30%
  const goldMonthlyFee = totalMonthlyVolume * 0.0005; // 0.05%
  const monthlySavings = bronzeMonthlyFee - goldMonthlyFee;
  const annualSavings = monthlySavings * 12;

  return (
    <div className="frame">
      <PageBackground word="STAKE" variant="desk" />
      <Navbar />
      <main id="main-content">
        {/* Header */}
        <section className="ph ph-haze ph-haze-stake page-reveal-hero">
          <span className="tag">
            <b className="dot" aria-hidden="true" />
            <TextScramble
              text="REPUTATIONAL STAKING · FEE TIERS"
              scrambleSpeed={22}
              revealSpeed={32}
            />
          </span>
          <h1>Stake as trust.</h1>
          <p>
            Fleet operators stake $PINELY to unlock the Gold reputation tier (0.05% swap fee) for
            every machine that qualifies. Real economic skin in the game: a stake can be slashed for
            malicious telemetry or policy violations.
          </p>
        </section>

        {/* Staking Command Telemetry Banner */}
        <div className="staking-telemetry-banner font-mono page-reveal-1">
          <div className="telemetry-banner-left">
            <span className={`status-pill ${stakeOnline ? "active" : "standby"}`}>
              <span className={`pulse-beacon ${stakeOnline ? "green" : "red"}`} />
              <span>
                {stakeOnline
                  ? "ONLINE · DEPLOYED (STAGE 2)"
                  : stakeContract
                    ? stage2State === "connected"
                      ? "CONNECTED · NO POOL YET (STAGE 2)"
                      : "DEPLOYED · NOT ACTIVE YET (STAGE 2)"
                    : "STANDBY · STAGE 2 REHEARSAL"}
              </span>
            </span>
            <div className="telemetry-contract-info">
              <span className="telemetry-label">STAKING CONTRACT:</span>
              {stakeContract ? (
                <a
                  href={`${activeChain.blockExplorers?.default.url}/address/${stakeContract}`}
                  target="_blank"
                  rel="noreferrer"
                  className="telemetry-contract-link"
                >
                  <b>PinelyStake ({shortHex(stakeContract)})</b>
                  <span className="external-link-icon" aria-hidden="true">
                    ↗
                  </span>
                </a>
              ) : (
                <span className="telemetry-contract-offline">
                  <b>PinelyStake not deployed (Stage 2)</b>
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
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <span>Cooldown: 7D (block.timestamp)</span>
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
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              </svg>
              <span>Slashing: Authority Guard</span>
            </span>
          </div>
        </div>

        <section className="sec" style={{ paddingTop: "12px" }}>
          <Stage2Banner />
          {/* Reputation Tier Cards */}
          <div className="stake-tier-grid">
            {/* Bronze Tier */}
            <div className="stake-tier-card">
              <div>
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <span className="tier-pill bronze">Base</span>
                  <span className="font-mono text-xs text-zinc-400">Baseline</span>
                </div>
                <h2
                  style={{
                    fontSize: "22px",
                    fontWeight: 600,
                    color: "#ffffff",
                    margin: "14px 0 4px",
                  }}
                >
                  Bronze Tier
                </h2>
                <div
                  className="big-n"
                  style={{ fontSize: "40px", color: "var(--bl)", margin: "8px 0" }}
                >
                  0.30%
                </div>
                <p
                  className="note"
                  style={{ margin: "4px 0 0", lineHeight: 1.5, fontSize: "13px" }}
                >
                  Default tier for every newly registered machine on Robinhood Chain.
                </p>
              </div>
              <div
                className="dossier-spec-list font-mono text-xs"
                style={{ margin: "14px 0 0", borderTop: "1px solid var(--line)" }}
              >
                <div className="dossier-spec-row">
                  <span className="dossier-spec-label">Stake Required</span>
                  <b className="dossier-spec-val" style={{ color: "#ffffff" }}>
                    0 $PINELY
                  </b>
                </div>
                <div className="dossier-spec-row">
                  <span className="dossier-spec-label">Min Active Days</span>
                  <b className="dossier-spec-val" style={{ color: "#ffffff" }}>
                    0 Days
                  </b>
                </div>
                <div className="dossier-spec-row">
                  <span className="dossier-spec-label">Fee Discount</span>
                  <b className="dossier-spec-val" style={{ color: "var(--mut-light)" }}>
                    None (Standard)
                  </b>
                </div>
              </div>
            </div>

            {/* Silver Tier */}
            <div className="stake-tier-card">
              <div>
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <span className="tier-pill silver">Mid</span>
                  <span className="font-mono text-xs text-zinc-400">Proven Uptime</span>
                </div>
                <h2
                  style={{
                    fontSize: "22px",
                    fontWeight: 600,
                    color: "#ffffff",
                    margin: "14px 0 4px",
                  }}
                >
                  Silver Tier
                </h2>
                <div
                  className="big-n"
                  style={{ fontSize: "40px", color: "#cfc9cb", margin: "8px 0" }}
                >
                  0.15%
                </div>
                <p
                  className="note"
                  style={{ margin: "4px 0 0", lineHeight: 1.5, fontSize: "13px" }}
                >
                  Valid hardware attestation or 30 days active with zero violations.
                </p>
              </div>
              <div
                className="dossier-spec-list font-mono text-xs"
                style={{ margin: "14px 0 0", borderTop: "1px solid var(--line)" }}
              >
                <div className="dossier-spec-row">
                  <span className="dossier-spec-label">Stake Required</span>
                  <b className="dossier-spec-val" style={{ color: "#ffffff" }}>
                    0 $PINELY
                  </b>
                </div>
                <div className="dossier-spec-row">
                  <span className="dossier-spec-label">Min Active Days</span>
                  <b className="dossier-spec-val" style={{ color: "#ffffff" }}>
                    30 Days
                  </b>
                </div>
                <div className="dossier-spec-row">
                  <span className="dossier-spec-label">Fee Discount</span>
                  <b className="dossier-spec-val" style={{ color: "var(--bl)" }}>
                    50% Reduction
                  </b>
                </div>
              </div>
            </div>

            {/* Gold Tier (Featured) */}
            <div className="stake-tier-card featured">
              <div>
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}
                >
                  <span className="tier-pill gold">Top</span>
                  <span
                    className="font-mono text-xs"
                    style={{ color: "var(--bl)", fontWeight: 600 }}
                  >
                    MAXIMUM COOLING
                  </span>
                </div>
                <h2
                  style={{
                    fontSize: "22px",
                    fontWeight: 600,
                    color: "#ffffff",
                    margin: "14px 0 4px",
                  }}
                >
                  Gold Tier
                </h2>
                <div
                  className="big-n"
                  style={{ fontSize: "40px", color: "var(--bl)", margin: "8px 0" }}
                >
                  0.05%
                </div>
                <p
                  className="note"
                  style={{
                    margin: "4px 0 0",
                    lineHeight: 1.5,
                    fontSize: "13px",
                    color: "#ecd8de",
                  }}
                >
                  Hardware attestation + 90 days registered + 10,000 $PINELY staked per operator.
                  Lowest fee.
                </p>
              </div>
              <div
                className="dossier-spec-list font-mono text-xs"
                style={{ margin: "14px 0 0", borderTop: "1px solid var(--line)" }}
              >
                <div className="dossier-spec-row">
                  <span className="dossier-spec-label">Stake Required</span>
                  $110,000 $PINELY per operator$2
                </div>
                <div className="dossier-spec-row">
                  <span className="dossier-spec-label">Min Active Days</span>
                  <b className="dossier-spec-val" style={{ color: "#ffffff" }}>
                    90 Days
                  </b>
                </div>
                <div className="dossier-spec-row">
                  <span className="dossier-spec-label">Fee Discount</span>
                  <b className="dossier-spec-val" style={{ color: "var(--bl)" }}>
                    83.3% Reduction
                  </b>
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Fleet Staking & Savings Calculator */}
          <div className="calc-box" style={{ marginTop: "44px" }}>
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
                <span className="text-xs uppercase tracking-wider text-crimson-400 font-mono">
                  PROJECTION · FLEET TIER ECONOMICS
                </span>
                <h2
                  style={{ fontSize: "24px", fontWeight: 600, color: "#ffffff", marginTop: "4px" }}
                >
                  Fleet Stake &amp; Fee Savings Estimator
                </h2>
              </div>
              <span className="tier-pill gold font-mono">ESTIMATE</span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(min(280px, 100%), 1fr))",
                gap: "32px",
                alignItems: "start",
              }}
            >
              {/* Input Controls */}
              <div className="form">
                <label>
                  <span>Fleet Size (Active Hardware Nodes)</span>
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    value={fleetSize}
                    onChange={(e) => setFleetSize(Math.max(1, parseInt(e.target.value, 10) || 1))}
                    className="font-mono fleet-input"
                  />
                </label>

                <div className="stake-preset-chips">
                  {FLEET_PRESETS.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => setFleetSize(p)}
                      className={`stake-preset-btn font-mono ${fleetSize === p ? "active" : ""}`}
                    >
                      {p} Nodes
                    </button>
                  ))}
                </div>

                <label style={{ marginTop: "16px" }}>
                  <span>Avg Monthly Volume per Node ({stablecoinSymbol})</span>
                  <input
                    type="number"
                    step="500"
                    min="100"
                    value={monthlyVolumePerNode}
                    onChange={(e) =>
                      setMonthlyVolumePerNode(Math.max(100, parseInt(e.target.value, 10) || 100))
                    }
                    className="font-mono fleet-input"
                  />
                </label>
                <span className="note" style={{ display: "block", marginTop: "8px" }}>
                  Volume your machines swap through the PINELY pool; the tier fee applies to swaps,
                  not to Facilitator payments. Assumes every machine meets the Gold requirements.
                </span>
              </div>

              {/* Live Outputs & Savings Matrix */}
              <div className="stake-econ-matrix font-mono">
                <div className="stake-econ-row">
                  <span className="stake-econ-label">STAKE REQUIRED (OPERATOR)</span>
                  <b className="stake-econ-val" style={{ color: "#ffffff" }}>
                    {totalRequiredStake.toLocaleString("en-US")} $PINELY
                  </b>
                </div>
                <div className="stake-econ-row">
                  <span className="stake-econ-label">MONTHLY FLEET VOLUME</span>
                  <b className="stake-econ-val" style={{ color: "#ffffff" }}>
                    ${totalMonthlyVolume.toLocaleString("en-US")} {stablecoinSymbol}
                  </b>
                </div>
                <div className="stake-econ-row">
                  <span className="stake-econ-label">BASELINE FEE (BRONZE 0.30%)</span>
                  <b className="stake-econ-val" style={{ color: "var(--mut-light)" }}>
                    ${bronzeMonthlyFee.toFixed(2)} {stablecoinSymbol}
                  </b>
                </div>
                <div className="stake-econ-row">
                  <span className="stake-econ-label">STAKED FEE (GOLD 0.05%)</span>
                  <b className="stake-econ-val" style={{ color: "#ffffff" }}>
                    ${goldMonthlyFee.toFixed(2)} {stablecoinSymbol}
                  </b>
                </div>
                <div className="stake-econ-row">
                  <span className="stake-econ-label">NET MONTHLY SAVINGS</span>
                  <b className="stake-econ-val" style={{ color: "var(--bl)" }}>
                    +${monthlySavings.toFixed(2)} {stablecoinSymbol} / mo
                  </b>
                </div>
                <div className="stake-econ-row highlight">
                  <span className="stake-econ-label" style={{ color: "#ffffff", fontWeight: 600 }}>
                    NET ANNUAL FLEET SAVINGS
                  </span>
                  <b className="stake-econ-val annual-val">
                    +${annualSavings.toFixed(2)} {stablecoinSymbol} / yr
                  </b>
                </div>
              </div>
            </div>

            {/* Live staking for the connected operator */}
            <div style={{ borderTop: "1px solid var(--line)", paddingTop: "20px" }}>
              <StakePanel />
            </div>
          </div>

          {/* Security & Slashing Architecture */}
          <div className="section-hairline" style={{ marginTop: "48px" }}>
            <span>SECTION 02 · STAKING GOVERNANCE &amp; PROTOCOL ARCHITECTURE</span>
          </div>

          <div className="grid bento-grid-3" style={{ marginTop: "20px" }}>
            <div className="card bento-card">
              <div className="card-top-badge-row">
                <span className="security-badge pass font-mono">MODULE 01 · TIMELOCK</span>
                <span className="font-mono text-xs" style={{ color: "var(--mut-light)" }}>
                  TIMESTAMP SAFE
                </span>
              </div>
              <h2
                style={{
                  fontSize: "18px",
                  fontWeight: 600,
                  color: "#ffffff",
                  margin: "14px 0 6px",
                }}
              >
                7-Day Timelock Unbonding
              </h2>
              <p className="note" style={{ margin: 0, fontSize: "13px", lineHeight: 1.6 }}>
                Stakes cannot be flash-withdrawn. A strict 7-day cooldown evaluated strictly against{" "}
                <code className="font-mono text-xs">block.timestamp</code> prevents hit-and-run
                exploits.
              </p>
            </div>

            <div className="card bento-card">
              <div className="card-top-badge-row">
                <span className="security-badge sentinel font-mono">MODULE 02 · SLASHING</span>
                <span className="font-mono text-xs" style={{ color: "var(--mut)" }}>
                  GOVERNANCE
                </span>
              </div>
              <h2
                style={{
                  fontSize: "18px",
                  fontWeight: 600,
                  color: "#ffffff",
                  margin: "14px 0 6px",
                }}
              >
                Slashing Authority
              </h2>
              <p className="note" style={{ margin: 0, fontSize: "13px", lineHeight: 1.6 }}>
                Staked $PINELY can be slashed by the contract owner (the PINELY Safe, 2-of-3) for
                policy violations. Slashing can remove up to 100% of a stake, including funds in the
                7-day unbonding period.
              </p>
            </div>

            <div className="card bento-card hl">
              <div className="card-top-badge-row">
                <span className="security-badge pass font-mono">MODULE 03 · CUSTODY</span>
                <span className="font-mono text-xs" style={{ color: "var(--bl)" }}>
                  SAFE 2-OF-3
                </span>
              </div>
              <h2
                style={{
                  fontSize: "18px",
                  fontWeight: 600,
                  color: "#ffffff",
                  margin: "14px 0 6px",
                }}
              >
                Staking Custody
              </h2>
              <p className="note" style={{ margin: 0, fontSize: "13px", lineHeight: 1.6 }}>
                Staked tokens are escrowed by PinelyStake.sol. A Safe multisig can stake like any
                wallet.
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
            <p className="note">
              {stakeContract
                ? `STAGE 2 · PinelyStake ${shortHex(stakeContract)} is deployed. This site offers no staking action yet.`
                : "STAGE 2 · PinelyStake is not deployed yet. It is covered by the Foundry test suite."}
            </p>
            <div style={{ display: "flex", gap: "12px" }}>
              <Link href="/burn" className="btn dark" style={{ fontSize: "13px" }}>
                Explore BurnVault Splitter →
              </Link>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
