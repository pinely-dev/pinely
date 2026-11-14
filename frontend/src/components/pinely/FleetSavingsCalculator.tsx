"use client";

import { useState } from "react";
import Link from "next/link";
import { TextScramble } from "./TextScramble";
import { ScrollReveal } from "./ScrollReveal";
import { stablecoinSymbol } from "@/lib/chain";
import { StageBadge } from "@/components/pinely/StageBadge";

export function FleetSavingsCalculator() {
  const [fleetSize, setFleetSize] = useState<number>(50);
  const [dailySpendPerUnit, setDailySpendPerUnit] = useState<number>(20);

  // Math models
  const daysInMonth = 30;
  const monthlyVolume = fleetSize * dailySpendPerUnit * daysInMonth;

  // Fee percentages:
  // Bronze: 0.30% (Standard initial registration)
  // Silver: 0.15% (30-day active, 0 violations)
  // Gold: 0.05% (Hardware verified + Staked $PINELY)
  // Protocol Fee: 0.05% (Flows directly to BurnVault)
  const bronzeFee = monthlyVolume * 0.003;
  const silverFee = monthlyVolume * 0.0015;
  const goldFee = monthlyVolume * 0.0005;

  const monthlySavings = bronzeFee - goldFee;
  const annualSavings = monthlySavings * 12;
  const protocolBurnVolume = monthlyVolume * 0.0005;

  const formatUsd = (num: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(num);
  };

  return (
    <section className="sec chapter savings-calc-sec" id="tokenomics">
      <div className="chapter-side">
        <ScrollReveal direction="up" className="chapter-side-head">
          <div className="sh">
            <span className="tag">
              <TextScramble text="ECONOMIC ENGINE & STAKING" />
            </span>
            <div style={{ marginTop: "10px" }}>
              <StageBadge variant="stage2" />
            </div>
            <h2>A toll road for machine transactions.</h2>
            <p>
              A credit score for robots. Good machines will get cheaper money. In Stage 2, fleet
              operators will be able to stake $PINELY to cut transaction fees by 83.3%, and protocol
              fees will fund $PINELY burns.
            </p>
          </div>
        </ScrollReveal>

        <ScrollReveal delay={100} direction="up" className="chapter-side-body">
          <div className="calc-container">
            {/* Left Side: Interactive Fleet Parameters */}
            <div className="calc-controls-card">
              <div className="calc-card-header">
                <span className="micro-square" aria-hidden="true" />
                <TextScramble
                  text="FLEET PARAMETER SIMULATOR"
                  scrambleSpeed={20}
                  revealSpeed={35}
                />
              </div>

              <div className="calc-control-group">
                <div className="control-label-row">
                  <label htmlFor="fleet-size-slider">ACTIVE FLEET SIZE</label>
                  <span className="control-val">{fleetSize} UNITS</span>
                </div>
                <input
                  id="fleet-size-slider"
                  type="range"
                  min={5}
                  max={500}
                  step={5}
                  value={fleetSize}
                  onChange={(e) => setFleetSize(Number(e.target.value))}
                  className="calc-range"
                />
                <div className="range-bounds">
                  <span>5 Units (Pilot)</span>
                  <span>100 Units</span>
                  <span>500 Units (Commercial)</span>
                </div>
              </div>

              <div className="calc-control-group">
                <div className="control-label-row">
                  <label htmlFor="daily-spend-slider">ESTIMATED DAILY SPEND PER UNIT</label>
                  <span className="control-val">
                    ${dailySpendPerUnit} {stablecoinSymbol}/DAY
                  </span>
                </div>
                <input
                  id="daily-spend-slider"
                  type="range"
                  min={5}
                  max={100}
                  step={5}
                  value={dailySpendPerUnit}
                  onChange={(e) => setDailySpendPerUnit(Number(e.target.value))}
                  className="calc-range"
                />
                <div className="range-bounds">
                  <span>$5 (Micro-drones)</span>
                  <span>$20 (Rovers)</span>
                  <span>$100 (EV Stations)</span>
                </div>
              </div>

              {/* Volume Summary Ledger */}
              <div className="calc-volume-summary font-mono">
                <div className="volume-metric">
                  <span className="volume-label">PROJECTED MONTHLY VOLUME</span>
                  <span className="volume-number">{formatUsd(monthlyVolume)}</span>
                </div>
                <div className="volume-metric">
                  <span className="volume-label">MONTHLY PROTOCOL BURN</span>
                  <span className="volume-burn-number">
                    {formatUsd(protocolBurnVolume)} → BurnVault
                  </span>
                </div>
              </div>

              <div className="calc-note">
                <span>
                  To be enforced onchain via PinelyHook.sol & PinelyStake.sol (Stage 2, deployed but
                  not in use yet).
                </span>
              </div>
            </div>

            {/* Right Side: Tiered Comparison & Savings Output */}
            <div className="calc-output-card">
              <div className="calc-card-header">
                <span className="micro-square" aria-hidden="true" />
                <TextScramble
                  text="ANNUAL FLEET REPUTATION ARBITRAGE"
                  scrambleSpeed={20}
                  revealSpeed={35}
                />
              </div>

              {/* Dynamic Tier Grid */}
              <div className="tiers-comparison-grid">
                {/* Bronze Tier */}
                <div className="tier-col">
                  <div className="tier-header">
                    <span className="tier-badge bronze">BRONZE</span>
                    <span className="tier-rate">0.30%</span>
                  </div>
                  <div className="tier-condition">Unstaked / New Fleet</div>
                  <div className="tier-cost">
                    {formatUsd(bronzeFee)}
                    <small>/mo</small>
                  </div>
                </div>

                {/* Silver Tier */}
                <div className="tier-col">
                  <div className="tier-header">
                    <span className="tier-badge silver">SILVER</span>
                    <span className="tier-rate">0.15%</span>
                  </div>
                  <div className="tier-condition">30d Clean History</div>
                  <div className="tier-cost">
                    {formatUsd(silverFee)}
                    <small>/mo</small>
                  </div>
                </div>

                {/* Gold Tier (Staked) */}
                <div className="tier-col gold-highlight">
                  <div className="tier-header">
                    <span className="tier-badge gold">GOLD · STAKED</span>
                    <span className="tier-rate">0.05%</span>
                  </div>
                  <div className="tier-condition">$PINELY staked + hardware attestation</div>
                  <div className="tier-cost gold-text">
                    {formatUsd(goldFee)}
                    <small>/mo</small>
                  </div>
                </div>
              </div>

              {/* Net Savings Box */}
              <div className="savings-highlight-box">
                <div className="savings-meta">
                  <span>NET OPERATOR SAVINGS (GOLD TIER)</span>
                  <span className="savings-pct font-bold">83.3% FEE REDUCTION</span>
                </div>
                <div className="savings-display font-mono">
                  <div className="savings-amount">{formatUsd(monthlySavings)}</div>
                  <div className="savings-sub">
                    <span>
                      Equivalent to <strong>{formatUsd(annualSavings)}/year</strong> retained
                      capital
                    </span>
                  </div>
                </div>
              </div>

              {/* Staking & Burn Action Callouts */}
              <div className="calc-footer-actions">
                <Link href="/stake" className="btn red sm">
                  Stake $PINELY for Fleet Gold →
                </Link>
                <Link href="/burn" className="btn dark sm">
                  Inspect BurnVault Telemetry
                </Link>
              </div>
            </div>
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
