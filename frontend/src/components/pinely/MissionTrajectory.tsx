"use client";

import Link from "next/link";
import { TextScramble } from "./TextScramble";
import { ScrollReveal } from "./ScrollReveal";
import { TiltCard } from "./TiltCard";
import { stablecoinSymbol } from "@/lib/chain";
import { robinhoodTestnet, robinhoodMainnet } from "@pinely/shared/chains";
import { platformStatus } from "@pinely/shared/status";

interface OrbitPhase {
  orbitNumber: string;
  name: string;
  network: string;
  status: string;
  statusCode: string;
  badgeClass: string;
  summary: string;
  deliverables: string[];
  contracts: string[];
}

const PHASES: OrbitPhase[] = [
  {
    orbitNumber: "Phase 1",
    name: "Testnet Foundation",
    network: `${robinhoodTestnet.name} · Chain ${robinhoodTestnet.id}`,
    status: "DONE",
    statusCode: "TESTNET REHEARSAL",
    badgeClass: "live",
    summary: "Stage 1 rehearsed end to end on Robinhood Testnet.",
    deliverables: [
      "Deploy the four Stage 1 contracts to Robinhood Chain Testnet and verify them",
      "Gasless sponsored UserOp rail (ERC-4337 with the PINELY Paymaster)",
      "HTTP 402 machine-to-machine charging settlement",
      "Ponder indexer time-based polling & telemetry feed",
    ],
    contracts: ["MachineRegistry", "PinelyAccount", "PinelyPaymaster", "SurplusSweeper"],
  },
  {
    orbitNumber: "Phase 2",
    name: "Mainnet Stage 1 Core",
    network: `${robinhoodMainnet.name} · Chain ${robinhoodMainnet.id}`,
    status: platformStatus["stage1-mainnet"].level === "live" ? "LIVE · UNAUDITED" : "NOT DEPLOYED",
    statusCode: "STAGE 1 ON MAINNET",
    badgeClass: platformStatus["stage1-mainnet"].level === "live" ? "live" : "standby",
    summary:
      "MachineRegistry, AccountFactory, Paymaster and SurplusSweeper deployed, owned by a 2-of-3 Safe. First machine UserOp is next.",
    deliverables: [
      "Stage 1 Core: Registry, Factory, Paymaster, Sweeper",
      "Production Safe 2-of-3 multisig governance ownership",
      `${stablecoinSymbol} (6 decimals) settlement rail integration`,
      "Bounded native-token price conversion with staleness checks",
    ],
    contracts: ["PinelyAccountFactory", "PinelyPaymaster", "Safe2of3Multisig"],
  },
  {
    orbitNumber: "Phase 3",
    name: "Stage 2 Liquidity & Token",
    network: "Testnet → Mainnet Stage 2",
    status: "IN PROGRESS",
    statusCode: "TOKEN IS LIVE",
    badgeClass: "standby",
    summary: "$PINELY is live. Hook, Router and Stake deploy next.",
    deliverables: [
      "Uniswap v4 private pool hook & PinelyRouter integration",
      "Dynamic fee tiers (Bronze 0.30% down to Gold 0.05%)",
      "BurnVault deflationary token burning from protocol fees",
      "PinelyStake reputation cooling for enterprise fleets",
    ],
    contracts: ["PinelyHook", "PinelyRouter", "BurnVault", "PinelyStake"],
  },
];

export function MissionTrajectory() {
  return (
    <section className="sec chapter trajectory-sec" id="roadmap">
      <ScrollReveal direction="rack">
        <div className="sh">
          <span className="tag">
            <TextScramble text="ROADMAP" />
          </span>
          <h2>One real fleet first. Staged rollout.</h2>
          <p>
            Mainnet is not a sandbox. We rehearse every UserOp and the kill switch on testnet before
            deploying production capital. Stage 1 goes to mainnet first; Stage 2, including onchain
            spend limits, activates with the token launch.
          </p>
        </div>
      </ScrollReveal>

      <div className="trajectory-timeline">
        {PHASES.map((phase, idx) => (
          <ScrollReveal
            key={idx}
            delay={idx * 120}
            direction="rack"
            className="trajectory-card-wrapper"
          >
            <TiltCard style={{ height: "100%" }}>
              <div className="trajectory-card" style={{ height: "100%" }}>
                {/* Card Top Telemetry */}
                <div className="trajectory-header">
                  <div className="trajectory-phase-title">
                    <span className="orbit-tag">{phase.orbitNumber}</span>
                    <span className="network-tag">
                      <TextScramble text={phase.network} scrambleSpeed={20} revealSpeed={35} />
                    </span>
                  </div>
                  <span className={`trajectory-status-badge ${phase.badgeClass}`}>
                    <span className="status-indicator-dot" aria-hidden="true" />
                    <span>{phase.status}</span>
                  </span>
                </div>

                {/* Card Body */}
                <div className="trajectory-body">
                  <h3 className="trajectory-title">{phase.name}</h3>
                  <p className="trajectory-summary">{phase.summary}</p>

                  {/* Deliverable Checklist */}
                  <ul className="trajectory-deliverables">
                    {phase.deliverables.map((item, dIdx) => (
                      <li key={dIdx} className="deliverable-item">
                        <span className="check-bullet">›</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* Card Footer Contracts */}
                <div className="trajectory-footer">
                  <span className="footer-label">KEY CONTRACTS:</span>
                  <div className="contract-pills">
                    {phase.contracts.map((c, cIdx) => (
                      <span key={cIdx} className="contract-pill">
                        {c}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </TiltCard>
          </ScrollReveal>
        ))}
      </div>

      {/* External Gate Transparency Note */}
      <ScrollReveal delay={200} direction="fade">
        <div className="trajectory-governance-notice">
          <div className="notice-inner">
            <span className="notice-icon">ℹ</span>
            <p>
              <strong>EXTERNAL GATE RIGOR:</strong> Mainnet deployment requires verified EntryPoint
              v0.7 bytecode, a confirmed stablecoin address, and Safe 2-of-3 multisig establishment.
              Staged gates fail-closed.
            </p>
          </div>
          <Link href="/docs" className="notice-link">
            Read Deployment Runbooks →
          </Link>
        </div>
      </ScrollReveal>
    </section>
  );
}
