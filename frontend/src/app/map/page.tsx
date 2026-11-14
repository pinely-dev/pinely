"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { activeChain } from "@/lib/chain";
import { findContractAddress } from "@pinely/shared/contracts";
import { Navbar } from "@/components/pinely/Navbar";
import { PageBackground } from "@/components/pinely/PageBackground";
import { Footer } from "@/components/pinely/Footer";
import { Stage2Banner } from "@/components/pinely/StageBadge";
import { DataState } from "@/components/pinely/DataState";
import { TextScramble } from "@/components/pinely/TextScramble";
import { useMachinesList, type BackendMachine } from "@/lib/api";
import { formatStable, shortHex, tierOf } from "@/lib/machine-view";

interface RadarNode {
  id: string;
  cx: number;
  cy: number;
  r: number;
  tier: "Bronze" | "Silver" | "Gold";
  feeTier: string;
  status: "Active" | "Frozen";
  dailySpent: string;
  dailyCap: string;
  account: string;
  operator: string;
  signer: string;
  attestationValid: boolean;
}

type MapFilter = "all" | "active" | "frozen" | "gold" | "silver" | "bronze";

function deterministicRadarPosition(id: string): { cx: number; cy: number; r: number } {
  let hash1 = 0;
  let hash2 = 0;
  for (let i = 0; i < id.length; i++) {
    const code = id.charCodeAt(i);
    hash1 = (hash1 * 31 + code) >>> 0;
    hash2 = (hash2 * 17 + code) >>> 0;
  }

  const angle = (hash1 % 360) * (Math.PI / 180);
  const radius = 35 + (hash2 % 100);

  const cx = Math.round(300 + radius * Math.cos(angle));
  const cy = Math.round(150 + radius * Math.sin(angle));
  const r = 5 + (hash1 % 3);

  return { cx, cy, r };
}

function mapMachineToRadarNode(m: BackendMachine): RadarNode {
  const id = m.machineId ?? m.id ?? m.account;
  const { cx, cy, r } = deterministicRadarPosition(id);
  const tierInfo = tierOf(m.tier);
  const feeTier = tierInfo.fee;
  const dailySpent = formatStable(m.usedToday);
  const dailyCap = formatStable(m.dailyStableOutCap);

  return {
    id,
    cx,
    cy,
    r,
    tier: tierInfo.name,
    feeTier,
    status: m.frozen ? "Frozen" : "Active",
    dailySpent,
    dailyCap,
    account: m.account,
    operator: m.operator,
    signer: m.signer,
    attestationValid: m.attestationValid,
  };
}

export default function MapPage() {
  const [filter, setFilter] = useState<MapFilter>("all");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Fetch up to 100 machines registered in the PINELY indexer
  const list = useMachinesList(1, 100);

  const nodes = useMemo(() => {
    const raw = list.data?.data ?? [];
    return raw.map(mapMachineToRadarNode);
  }, [list.data?.data]);

  const activeCount = useMemo(() => nodes.filter((n) => n.status === "Active").length, [nodes]);
  const frozenCount = useMemo(() => nodes.filter((n) => n.status === "Frozen").length, [nodes]);
  const goldCount = useMemo(() => nodes.filter((n) => n.tier === "Gold").length, [nodes]);
  const silverCount = useMemo(() => nodes.filter((n) => n.tier === "Silver").length, [nodes]);
  const bronzeCount = useMemo(() => nodes.filter((n) => n.tier === "Bronze").length, [nodes]);

  const filteredNodes = useMemo(() => {
    return nodes.filter((node) => {
      if (filter === "active" && node.status !== "Active") return false;
      if (filter === "frozen" && node.status !== "Frozen") return false;
      if (filter === "gold" && node.tier !== "Gold") return false;
      if (filter === "silver" && node.tier !== "Silver") return false;
      if (filter === "bronze" && node.tier !== "Bronze") return false;
      return true;
    });
  }, [nodes, filter]);

  const selectedNode = useMemo(() => {
    if (selectedNodeId) {
      const found = filteredNodes.find((n) => n.id === selectedNodeId);
      if (found) return found;
    }
    return filteredNodes[0] ?? null;
  }, [filteredNodes, selectedNodeId]);

  const getNodeColor = (tier: string) => {
    switch (tier) {
      case "Gold":
        return "#e0486b";
      case "Silver":
        return "#ffffff";
      default:
        return "#8f878a";
    }
  };

  return (
    <div className="frame">
      <PageBackground word="RADAR" variant="plain" />
      <Navbar />
      <main id="main-content">
        {/* Header */}
        <section className="ph ph-haze ph-haze-map page-reveal-hero">
          <span className="tag">
            <b className="dot" aria-hidden="true" />
            <TextScramble
              text="SPATIAL RADAR · PHYSICAL AI TELEMETRY"
              scrambleSpeed={22}
              revealSpeed={32}
            />
          </span>
          <h1>Physical AI Radar Terminal</h1>
          <p>
            Spatial telemetry and heartbeat monitoring for physical autonomous machines registered
            on Robinhood Chain.
          </p>
          <p className="note" role="status" style={{ marginTop: "12px", color: "#ecd8de" }}>
            Cryptographic spatial dispersal of machines registered onchain.{" "}
            {list.data
              ? "Machine status, spend quota, and fee tiers are live data from the PINELY indexer."
              : "Awaiting indexer. Machine data will appear here once the PINELY indexer is online."}
          </p>
        </section>

        {/* Tactical Radar Terminal */}
        <section className="sec page-reveal-1" style={{ paddingTop: "20px" }}>
          {!findContractAddress(activeChain.id, "PinelyHook") && <Stage2Banner />}
          <div className="radar-terminal">
            {/* Top HUD Telemetry Bar */}
            <div className="radar-hud-bar">
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span
                  className={`pulse-beacon ${
                    list.error ? "red" : list.isPending ? "gold" : "green"
                  }`}
                />
                <span>
                  {list.error
                    ? "RADAR STATUS: TELEMETRY OFFLINE"
                    : list.isPending
                      ? "RADAR SWEEP: SCANNING FREQUENCIES"
                      : "RADAR SWEEP: ACTIVE (6s CYCLE)"}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  gap: "16px",
                  color: "var(--mut-light)",
                  fontSize: "12px",
                  flexWrap: "wrap",
                }}
              >
                <span>
                  Nodes Detected:{" "}
                  <b>
                    {filteredNodes.length} / {nodes.length}
                  </b>
                </span>
                <span style={{ opacity: 0.4 }}>|</span>
                <span>
                  Chain:{" "}
                  <b>
                    {activeChain.name} ({activeChain.id})
                  </b>
                </span>
              </div>
            </div>

            {/* Interactive Filter Pills */}
            <div className="filter-group" style={{ justifyContent: "flex-start" }}>
              {[
                { key: "all" as const, label: `All Nodes (${nodes.length})` },
                { key: "active" as const, label: `Active (${activeCount})` },
                { key: "frozen" as const, label: `Frozen (${frozenCount})` },
                { key: "gold" as const, label: `Gold Tier (${goldCount})` },
                { key: "silver" as const, label: `Silver Tier (${silverCount})` },
                { key: "bronze" as const, label: `Bronze Tier (${bronzeCount})` },
              ].map((f) => (
                <button
                  key={f.key}
                  type="button"
                  onClick={() => setFilter(f.key)}
                  className={`filter-btn ${filter === f.key ? "active" : ""}`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Feedback states: loading, error, empty */}
            {list.isPending && (
              <div style={{ margin: "16px 0" }}>
                <DataState isLoading={true} error={null}>
                  {null}
                </DataState>
              </div>
            )}

            {list.error && (
              <div style={{ margin: "16px 0" }}>
                <DataState isLoading={false} error={list.error} onRetry={() => list.refetch()}>
                  {null}
                </DataState>
              </div>
            )}

            {!list.isPending && !list.error && nodes.length === 0 && (
              <div
                style={{
                  border: "1px solid var(--line)",
                  borderRadius: "12px",
                  padding: "24px 18px",
                  textAlign: "center",
                  color: "var(--mut-light)",
                  margin: "16px 0",
                }}
                role="status"
              >
                <div style={{ color: "#ffffff", fontWeight: 600, marginBottom: "6px" }}>
                  No Registered Machines Detected
                </div>
                <p style={{ margin: 0, fontSize: "13px" }}>
                  No physical AI machines have registered onchain yet. Register a machine in the{" "}
                  <Link
                    href="/machines"
                    style={{ color: "var(--bl)", textDecoration: "underline" }}
                  >
                    Registry Explorer
                  </Link>{" "}
                  or apply for the{" "}
                  <Link href="/pilot" style={{ color: "var(--bl)", textDecoration: "underline" }}>
                    Pilot Program
                  </Link>{" "}
                  to view spatial telemetry.
                </p>
              </div>
            )}

            {/* Selected Node Inspector Drawer */}
            {selectedNode && (
              <div className="radar-inspector-drawer">
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span
                      className={`pulse-beacon ${selectedNode.status === "Active" ? "green" : "red"}`}
                    />
                    <strong style={{ fontSize: "16px", color: "#ffffff" }} title={selectedNode.id}>
                      {shortHex(selectedNode.id, 8, 6)}
                    </strong>
                    <span style={{ color: "var(--mut)" }}>·</span>
                    <span style={{ color: "#ffffff" }}>
                      {selectedNode.attestationValid ? "Hardware Attested" : "Software Key"}
                    </span>
                  </div>
                  <div style={{ fontSize: "12px", color: "var(--mut-light)", marginTop: "4px" }}>
                    Operator: {shortHex(selectedNode.operator, 6, 4)} · Daily Quota:{" "}
                    {selectedNode.dailySpent} / {selectedNode.dailyCap}
                  </div>
                </div>

                <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
                  <span
                    className={`tier-pill ${
                      selectedNode.tier === "Gold"
                        ? "gold"
                        : selectedNode.tier === "Silver"
                          ? "silver"
                          : "bronze"
                    }`}
                  >
                    {selectedNode.tier} Tier ({selectedNode.feeTier})
                  </span>

                  <Link
                    href={`/machines/${selectedNode.id}`}
                    className="btn red sm"
                    style={{
                      width: "auto",
                      minHeight: "44px",
                      padding: "6px 14px",
                      fontSize: "12px",
                      display: "inline-flex",
                      alignItems: "center",
                    }}
                  >
                    Inspect Passport →
                  </Link>
                </div>
              </div>
            )}

            {/* Radar Scope Viewport */}
            <div className="radar-scope-container">
              {/* Rotating Radar Sweep Gradient Beam */}
              <div className="radar-sweep-beam" />

              {/* SVG Grid Overlay & Crosshairs */}
              <svg
                viewBox="0 0 600 300"
                className="radar-grid-svg"
                role="img"
                aria-label="Tactical Cyber-DePIN Radar Scope"
              >
                {/* Concentric Range Rings */}
                <circle
                  cx="300"
                  cy="150"
                  r="40"
                  stroke="rgba(224,72,107,0.12)"
                  strokeWidth="1"
                  fill="none"
                />
                <circle
                  cx="300"
                  cy="150"
                  r="90"
                  stroke="rgba(224,72,107,0.15)"
                  strokeWidth="1"
                  fill="none"
                />
                <circle
                  cx="300"
                  cy="150"
                  r="140"
                  stroke="rgba(224,72,107,0.18)"
                  strokeWidth="1"
                  fill="none"
                />
                <circle
                  cx="300"
                  cy="150"
                  r="190"
                  stroke="rgba(224,72,107,0.1)"
                  strokeWidth="1"
                  strokeDasharray="4 4"
                  fill="none"
                />

                {/* Crosshairs & Azimuth Lines */}
                <line
                  x1="300"
                  y1="0"
                  x2="300"
                  y2="300"
                  stroke="rgba(224,72,107,0.15)"
                  strokeWidth="1"
                  strokeDasharray="2 4"
                />
                <line
                  x1="0"
                  y1="150"
                  x2="600"
                  y2="150"
                  stroke="rgba(224,72,107,0.15)"
                  strokeWidth="1"
                  strokeDasharray="2 4"
                />

                {/* Distance Markings */}
                <text
                  x="306"
                  y="115"
                  fill="rgba(255,255,255,0.3)"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                >
                  50 KM
                </text>
                <text
                  x="306"
                  y="65"
                  fill="rgba(255,255,255,0.3)"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                >
                  100 KM
                </text>
                <text
                  x="306"
                  y="18"
                  fill="rgba(255,255,255,0.3)"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                >
                  200 KM
                </text>

                {/* Compass Bearings */}
                <text
                  x="296"
                  y="12"
                  fill="var(--bl)"
                  fontSize="10"
                  fontWeight="bold"
                  fontFamily="var(--font-mono)"
                >
                  N
                </text>
                <text
                  x="585"
                  y="154"
                  fill="rgba(255,255,255,0.4)"
                  fontSize="10"
                  fontFamily="var(--font-mono)"
                >
                  E
                </text>
                <text
                  x="296"
                  y="296"
                  fill="rgba(255,255,255,0.4)"
                  fontSize="10"
                  fontFamily="var(--font-mono)"
                >
                  S
                </text>
                <text
                  x="6"
                  y="154"
                  fill="rgba(255,255,255,0.4)"
                  fontSize="10"
                  fontFamily="var(--font-mono)"
                >
                  W
                </text>

                {/* Empty State Banner in Center of Scope */}
                {nodes.length === 0 && (
                  <text
                    x="300"
                    y="154"
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.35)"
                    fontSize="10"
                    fontFamily="var(--font-mono)"
                    letterSpacing="1px"
                  >
                    AWAITING FLEET DEPLOYMENT · NO NODES DETECTED
                  </text>
                )}

                {/* Interactive Radar Node Points */}
                {filteredNodes.map((node) => {
                  const isSelected = selectedNode?.id === node.id;
                  const nodeColor = getNodeColor(node.tier);
                  return (
                    <g key={node.id}>
                      {/* Pulsing Selection Halo */}
                      {isSelected && (
                        <circle
                          cx={node.cx}
                          cy={node.cy}
                          r={node.r + 6}
                          fill="none"
                          stroke="var(--bl)"
                          strokeWidth="1.5"
                          opacity="0.8"
                        />
                      )}
                      <circle
                        cx={node.cx}
                        cy={node.cy}
                        r={isSelected ? node.r + 2 : node.r}
                        fill={nodeColor}
                        opacity={isSelected ? 1 : 0.85}
                        className="node-dot"
                        onMouseEnter={() => setSelectedNodeId(node.id)}
                        onClick={() => setSelectedNodeId(node.id)}
                      />
                    </g>
                  );
                })}
              </svg>
            </div>

            {/* Radar Legend Footer */}
            <div
              className="text-xs text-zinc-400"
              style={{
                display: "flex",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: "10px",
                paddingTop: "8px",
              }}
            >
              <div style={{ display: "flex", gap: "16px", alignItems: "center" }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "2px",
                      background: "#e0486b",
                    }}
                  />
                  Gold Tier (0.05%)
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "2px",
                      background: "#ffffff",
                    }}
                  />
                  Silver Tier (0.15%)
                </span>
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "2px",
                      background: "#8f878a",
                    }}
                  />
                  Bronze Tier (0.30%)
                </span>
              </div>
              <span>
                {activeChain.name} ({activeChain.id}) · Physical AI Spatial Telemetry
              </span>
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  );
}
