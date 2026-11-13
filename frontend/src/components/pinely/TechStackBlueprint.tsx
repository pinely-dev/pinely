"use client";

import { useState } from "react";
import Link from "next/link";
import { TextScramble } from "./TextScramble";
import { ScrollReveal } from "./ScrollReveal";
import { stablecoinSymbol, nativeSymbol, chainProfile, blockTimeLabel } from "@/lib/chain";

interface Layer {
  number: string;
  id: string;
  name: string;
  category: string;
  badge: string;
  contract: string;
  description: string;
  specs: { label: string; value: string }[];
  failState: string;
  status: "STAGE 1 CORE" | "STAGE 2";
}

const LAYERS: Layer[] = [
  {
    number: "01",
    id: "hardware",
    name: "Device Key",
    category: "PHYSICAL HARDWARE LAYER",
    badge: "SECURE ELEMENT PLANNED",
    contract: "MachineRegistry.sol",
    description:
      "Physical machines should never sign with the operator key. The machine signs restricted EIP-712 session messages with a session key. The goal is to keep that key in a secure element such as the NXP SE050; until that support ships, the SDK key stores are software.",
    specs: [
      { label: "Target hardware (planned)", value: "NXP SE050 / Microchip ATECC608" },
      { label: "Signature Standard", value: "EIP-712 Typed Data (PINELY domain)" },
      { label: "Key Exportability", value: "Non-exportable (goal)" },
      { label: "Onchain Registry", value: "MachineRegistry.sol (Verified Identity)" },
    ],
    failState:
      "The operator can revoke a session key; the registry rejects signatures from a revoked key.",
    status: "STAGE 1 CORE",
  },
  {
    number: "02",
    id: "account",
    name: "Session Key Envelope",
    category: "ACCOUNT ABSTRACTION LAYER",
    badge: "ERC-4337 ENTRYPOINT V0.7",
    contract: "PinelyAccount.sol",
    description:
      "Every machine is governed by an individual smart contract account deployed via CREATE2. Its session key can only call execute and executeBatch inside a validity window checked against block.timestamp, with an optional target allowlist. Per-swap and daily caps live in the registry and are enforced by PinelyHook in Stage 2.",
    specs: [
      { label: "Account Architecture", value: "ERC-4337 EntryPoint v0.7 Compliant" },
      {
        label: "Time Evaluation",
        value: `block.timestamp (blocks about every ${chainProfile.blockTimeMs} ms)`,
      },
      { label: "Spend Caps", value: "Stored in the registry, enforced by PinelyHook (Stage 2)" },
      { label: "Emergency Protection", value: "1-Tx Fleet Kill Switch (Operator Safe)" },
    ],
    failState:
      "A session key outside its validity window, or calling anything but execute or executeBatch, is rejected at validation.",
    status: "STAGE 1 CORE",
  },
  {
    number: "03",
    id: "paymaster",
    name: "Gasless Sponsorship Rail",
    category: "SETTLEMENT & GAS RAIL",
    badge: `ZERO ${nativeSymbol} CUSTODY`,
    contract: "PinelyPaymaster.sol",
    description: `Machines never hold volatile native gas. The PinelyPaymaster fronts native ${nativeSymbol} gas directly to the bundler, then debits the machine account canonically in ${stablecoinSymbol} (6 decimals). Employs bounded rate conversion and staleness checks.`,
    specs: [
      { label: "Machine Gas Holding", value: `0 ${nativeSymbol} Custody Required` },
      { label: "Settlement Currency", value: `${stablecoinSymbol} (6 Decimals)` },
      { label: "Authorization Rail", value: "ERC-4337 UserOp via Bundler" },
      { label: "Surplus Management", value: "SurplusSweeper.sol auto-sweep to Safe" },
    ],
    failState: "Unfunded machine or stale conversion rate triggers safe fallback without gas loss.",
    status: "STAGE 1 CORE",
  },
  {
    number: "04",
    id: "liquidity",
    name: "Liquidity & Reputation Hook",
    category: "UNISWAP V4 DEFI LAYER",
    badge: "PRIVATE POOL ENFORCEMENT",
    contract: "PinelyHook.sol + PinelyRouter.sol",
    description:
      "Stage 2 connects machines to automated onchain liquidity. Swaps are routed through PinelyRouter into a private Uniswap v4 pool. Four immutable guards gate every swap: Machine Gate, Spend Policy, Kill Switch, and Dynamic Fee Cooling.",
    specs: [
      { label: "Pool Architecture", value: "Uniswap v4 Private Hook Pool" },
      { label: "Reputation Fee Tiers", value: "Bronze 0.30% · Silver 0.15% · Gold 0.05%" },
      { label: "Protocol Fee Routing", value: "0.05% routed to BurnVault.sol" },
      { label: "Deflationary Mechanism", value: "Automated $PINELY Token Burn" },
    ],
    failState:
      "Unregistered callers or frozen machines revert with UnauthorizedMachine() at hook entry.",
    status: "STAGE 2",
  },
];

export function TechStackBlueprint() {
  const [activeLayerIndex, setActiveLayerIndex] = useState<number>(0);
  const activeLayer = LAYERS[activeLayerIndex];
  const stage1Count = LAYERS.filter((layer) => layer.status === "STAGE 1 CORE").length;
  const stage2Count = LAYERS.length - stage1Count;

  return (
    <section className="sec chapter blueprint-sec" id="architecture">
      <ScrollReveal direction="up">
        <div className="sh-split">
          <div className="sh">
            <span className="tag">
              <TextScramble text="ARCHITECTURE BLUEPRINT" />
            </span>
            <h2>A corporate card for every machine.</h2>
            <p>
              The operator issues it. The machine spends within hard limits. If anything goes wrong,
              one tap freezes it. Four cryptographic boundaries from the device to the chain.
            </p>
          </div>
          <ul className="sh-facts" aria-label="Architecture at a glance">
            <li>
              <b className="font-mono">{LAYERS.length}</b>
              <span>Layers</span>
            </li>
            <li>
              <b className="font-mono">{stage1Count}</b>
              <span>Stage 1 core</span>
            </li>
            <li>
              <b className="font-mono">{stage2Count}</b>
              <span>Stage 2</span>
            </li>
          </ul>
        </div>
      </ScrollReveal>

      <ScrollReveal delay={100} direction="up">
        <div className="blueprint-container">
          {/* Layer Selector Stack (Left Column) */}
          <div className="blueprint-stack" role="tablist" aria-label="PINELY Architecture Layers">
            {LAYERS.map((layer, index) => {
              const isActive = index === activeLayerIndex;
              return (
                <button
                  key={layer.id}
                  role="tab"
                  aria-selected={isActive}
                  aria-controls={`layer-panel-${layer.id}`}
                  id={`layer-tab-${layer.id}`}
                  onClick={() => setActiveLayerIndex(index)}
                  className={`blueprint-tab ${isActive ? "active" : ""}`}
                >
                  <div className="tab-indicator-bar" />
                  <div className="tab-meta">
                    <span className="tab-num">Layer {Number(layer.number)}</span>
                    <span
                      className={`tab-status ${layer.status === "STAGE 1 CORE" ? "stage1" : "stage2"}`}
                    >
                      {layer.status}
                    </span>
                  </div>
                  <div className="tab-name">{layer.name}</div>
                  <div className="tab-category">{layer.category}</div>
                </button>
              );
            })}
          </div>

          {/* Layer Detail Blueprint Inspector (Right Column) */}
          <div
            className="blueprint-inspector"
            role="tabpanel"
            id={`layer-panel-${activeLayer.id}`}
            aria-labelledby={`layer-tab-${activeLayer.id}`}
          >
            {/* Inspector Header */}
            <div className="inspector-header">
              <div className="inspector-eyebrow">
                <span className="micro-square" aria-hidden="true" />
                <span>
                  Layer {Number(activeLayer.number)} · {activeLayer.badge}
                </span>
              </div>
              <div className="inspector-contract font-mono">
                <span className="contract-label">CONTRACT:</span>
                <span className="contract-name">
                  <TextScramble
                    key={activeLayer.contract}
                    text={activeLayer.contract}
                    scrambleSpeed={20}
                    revealSpeed={35}
                  />
                </span>
              </div>
            </div>

            {/* Inspector Body */}
            <div className="inspector-body">
              <h3 className="inspector-title">{activeLayer.name}</h3>
              <p className="inspector-desc">{activeLayer.description}</p>

              {/* Spec Key-Value Matrix */}
              <div className="inspector-matrix">
                {activeLayer.specs.map((spec, sIdx) => (
                  <div key={sIdx} className="matrix-row">
                    <span className="matrix-label">{spec.label}</span>
                    <span className="matrix-value">{spec.value}</span>
                  </div>
                ))}
              </div>

              {/* Fail-Closed Guarantee Banner */}
              <div className="inspector-failstate">
                <div className="failstate-header">
                  <span className="failstate-badge">FAIL-CLOSED PROTOCOL GUARANTEE</span>
                </div>
                <p className="failstate-text">{activeLayer.failState}</p>
              </div>
            </div>

            {/* Inspector Footer Actions */}
            <div className="inspector-footer">
              <div className="inspector-cta-group">
                <Link href="/docs" className="btn dark sm">
                  Review Contract Book →
                </Link>
                <Link href="/passport" className="btn-inline-link">
                  Lookup Machine Passport →
                </Link>
              </div>
              <span className="inspector-note">Block time: {blockTimeLabel}</span>
            </div>
          </div>
        </div>
      </ScrollReveal>
    </section>
  );
}
