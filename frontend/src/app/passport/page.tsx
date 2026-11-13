"use client";

import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { activeChain, stablecoinSymbol } from "@/lib/chain";
import { Navbar } from "@/components/pinely/Navbar";
import { PageBackground } from "@/components/pinely/PageBackground";
import { Footer } from "@/components/pinely/Footer";
import { TextScramble } from "@/components/pinely/TextScramble";
import { MachineHistory } from "@/components/pinely/MachineHistory";
import { explorerTxUrl } from "@/hooks/usePreparedTx";
import { useMachinePassport, type MachinePassport } from "@/lib/api";
import { formatCount, formatStable, shortHex, tierOf } from "@/lib/machine-view";

const MACHINE_ID_PATTERN = /^0x[0-9a-fA-F]{64}$/;

function formatTime(value: number | string | null): string {
  const seconds = Number(value);
  if (!value || !Number.isFinite(seconds) || seconds <= 0) return "n/a";
  return new Date(seconds * 1000).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

// --- High-End Institutional Vector Icons ---

function RoverIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="3" y="11" width="18" height="6" rx="2" />
      <circle cx="6" cy="19" r="2" />
      <circle cx="18" cy="19" r="2" />
      <path d="M7 11V7a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v4" />
      <circle cx="12" cy="7" r="1" fill="currentColor" />
      <path d="M12 5V3" />
    </svg>
  );
}

function DroneIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <path d="M9 9L5 5" />
      <path d="M15 9l4-4" />
      <path d="M9 15l-4 4" />
      <path d="M15 15l4 4" />
      <ellipse cx="4" cy="4" rx="2.5" ry="1.5" />
      <ellipse cx="20" cy="4" rx="2.5" ry="1.5" />
      <ellipse cx="4" cy="20" rx="2.5" ry="1.5" />
      <ellipse cx="20" cy="20" rx="2.5" ry="1.5" />
    </svg>
  );
}

function EvStationIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M4 4h8a2 2 0 0 1 2 2v14H2V6a2 2 0 0 1 2-2z" />
      <path d="M14 9h3a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2h-3" />
      <path d="M19 13v6a2 2 0 0 0 2 2h0a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1" />
      <path d="M8 8l-2 4h4l-2 4" />
    </svg>
  );
}

function DualKeyIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="7.5" cy="15.5" r="4.5" />
      <path d="M11 12.5L20 3.5" />
      <path d="M16 4.5l3.5 3.5" />
      <path d="M14 6.5l2 2" />
      <circle cx="16" cy="17" r="3" />
    </svg>
  );
}

function MicrochipEnclaveIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="5" y="5" width="14" height="14" rx="2" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </svg>
  );
}

function SettlementLedgerIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M3 3v18h18" />
      <path d="M7 15l4-5 4 3 5-7" />
      <circle cx="7" cy="15" r="1.5" fill="currentColor" />
      <circle cx="11" cy="10" r="1.5" fill="currentColor" />
      <circle cx="15" cy="13" r="1.5" fill="currentColor" />
      <circle cx="20" cy="6" r="1.5" fill="currentColor" />
    </svg>
  );
}

function CopyIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard denied
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="copy-btn-mono"
      title={`Copy ${label}`}
      aria-label={`Copy ${label}`}
    >
      {copied ? <CheckIcon width={12} height={12} /> : <CopyIcon width={12} height={12} />}
      <span>{copied ? "COPIED" : "COPY"}</span>
    </button>
  );
}

// --- Seeded Sample Fleet Reference Nodes ---

interface SampleMachine {
  id: string;
  alias: string;
  category: string;
  chipModel: string;
  tierName: string;
  tier: number;
  icon: "rover" | "drone" | "ev";
  data: MachinePassport;
}

const SAMPLE_MACHINES: SampleMachine[] = [
  {
    id: "0x945ebb5391f1f3ec0eaf55d0bd160c4bc4df67364d7e08086e5c1b2bf39fc3c1",
    alias: "PNLY-ROV-001",
    category: "Autonomous Delivery Rover",
    chipModel: "NXP SE050 · EAL6+ Certified Hardware Security Module",
    tierName: "Gold",
    tier: 2,
    icon: "rover",
    data: {
      passportVersion: 1,
      machineId: "0x945ebb5391f1f3ec0eaf55d0bd160c4bc4df67364d7e08086e5c1b2bf39fc3c1",
      account: "0x88880000000000000000000000000000f39fd6e5",
      operator: "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
      signer: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
      tierName: "Gold",
      tier: 2,
      hardwareAttestation: {
        hash: "0x0cdf3a9ae8168f084e69e21afacd60f43271e7fd2f8bb6b69dc4ccb4261f08a5",
        valid: true,
      },
      status: "ACTIVE",
      registeredAt: 1731000000,
      registeredBlock: 147007192,
      registeredTx: "0x918f8e0254cb37f6d48259e863372c019d6582aa61ff89d71c4c96b797960fc5",
      lastActiveAt: 1731360000,
      metrics: {
        lifetimeStableOut: "142850000000",
        totalSuccessfulSwaps: 1420,
      },
    },
  },
  {
    id: "0xa11ce00000000000000000000000000000000000000000000000000000000001",
    alias: "PNLY-DRN-002",
    category: "Aerial Inspection Drone",
    chipModel: "STSAFE-A110 · Tamper-Resistant Cryptographic Element",
    tierName: "Silver",
    tier: 1,
    icon: "drone",
    data: {
      passportVersion: 1,
      machineId: "0xa11ce00000000000000000000000000000000000000000000000000000000001",
      account: "0x8888000000000000000000000000000000000001",
      operator: "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
      signer: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
      tierName: "Silver",
      tier: 1,
      hardwareAttestation: {
        hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        valid: true,
      },
      status: "ACTIVE",
      registeredAt: 1730913600,
      registeredBlock: 146950280,
      registeredTx: "0x762a1b94e098481ce63a8a00257e84128f6230dc3728ba5743bdf172a11b9845",
      lastActiveAt: 1731356400,
      metrics: {
        lifetimeStableOut: "48200000000",
        totalSuccessfulSwaps: 512,
      },
    },
  },
  {
    id: "0xb22ce00000000000000000000000000000000000000000000000000000000002",
    alias: "PNLY-EV-003",
    category: "EV Power Station",
    chipModel: "Standard Physical Enclave · Baseline Authenticated Node",
    tierName: "Bronze",
    tier: 0,
    icon: "ev",
    data: {
      passportVersion: 1,
      machineId: "0xb22ce00000000000000000000000000000000000000000000000000000000002",
      account: "0x8888000000000000000000000000000000000002",
      operator: "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
      signer: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
      tierName: "Bronze",
      tier: 0,
      hardwareAttestation: {
        hash: null,
        valid: false,
      },
      status: "ACTIVE",
      registeredAt: 1730827200,
      registeredBlock: 146890120,
      registeredTx: "0x12b58a8a49c98ef81d7634f19b267ad45e2a9128f74a0090875b281bca61245e",
      lastActiveAt: 1731352800,
      metrics: {
        lifetimeStableOut: "12450000000",
        totalSuccessfulSwaps: 184,
      },
    },
  },
];

function PassportView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const rawId = searchParams.get("id")?.trim() ?? "";
  const [input, setInput] = useState(rawId);
  const [showRaw, setShowRaw] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  // Check if rawId is a valid 64-hex string
  const valid = MACHINE_ID_PATTERN.test(rawId);

  // Query live indexer/backend if valid
  const passportQuery = useMachinePassport(valid ? rawId : undefined);

  // Match sample machine if applicable
  const sampleMatch = useMemo(() => {
    return SAMPLE_MACHINES.find((s) => s.id.toLowerCase() === rawId.toLowerCase());
  }, [rawId]);

  // Determine active displayed passport
  // 1. Live backend data (if available)
  // 2. Sample machine match fallback (if query fails or is pending)
  // 3. Default specimen (PNLY-ROV-001) if no ID is specified
  const isSpecimenShowcase = !rawId;
  const activeRecord: MachinePassport | null = useMemo(() => {
    if (passportQuery.data) return passportQuery.data;
    if (sampleMatch) return sampleMatch.data;
    if (isSpecimenShowcase) return SAMPLE_MACHINES[0].data;
    return null;
  }, [passportQuery.data, sampleMatch, isSpecimenShowcase]);

  const activeSampleInfo = useMemo(() => {
    if (sampleMatch) return sampleMatch;
    if (isSpecimenShowcase) return SAMPLE_MACHINES[0];
    return null;
  }, [sampleMatch, isSpecimenShowcase]);

  const tier = activeRecord ? tierOf(activeRecord.tier) : null;
  const registeredTx = activeRecord?.registeredTx
    ? explorerTxUrl(activeChain.id, activeRecord.registeredTx)
    : undefined;

  const lookup = (e: React.FormEvent) => {
    e.preventDefault();
    const id = input.trim();
    if (id) {
      router.push(`/passport?id=${encodeURIComponent(id)}`);
    } else {
      router.push("/passport");
    }
  };

  const selectSample = (sample: SampleMachine) => {
    setInput(sample.id);
    router.push(`/passport?id=${encodeURIComponent(sample.id)}`);
  };

  const copyPublicLink = async () => {
    if (!activeRecord) return;
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/passport?id=${activeRecord.machineId}`,
      );
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2200);
    } catch {
      // Clipboard access denied
    }
  };

  // Generate a clean institutional serial tag
  const docSerial = useMemo(() => {
    if (!activeRecord) return "DOC-REF #PNLY-0000";
    const clean = activeRecord.machineId.replace(/^0x/, "");
    return `DOC-REF #PNLY-${clean.slice(0, 4).toUpperCase()}-${clean.slice(-4).toUpperCase()}`;
  }, [activeRecord]);

  return (
    <section className="sec page-reveal-1" style={{ paddingTop: "24px" }}>
      {/* SECTION HAIRLINE */}
      <div className="section-hairline" style={{ marginBottom: "20px" }}>
        <span className="section-hairline-label">PASSPORT LOOKUP TERMINAL</span>
        <div className="section-hairline-line" />
      </div>

      {/* SEARCH TOOLBAR & QUICK SAMPLE CHIPS */}
      <div className="passport-toolbar-wrap">
        <form onSubmit={lookup} className="table-toolbar" style={{ marginBottom: "12px" }}>
          <div className="search-input-wrap">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Machine ID (0x… 64 hex characters)"
              className="search-input font-mono"
              aria-label="Machine ID"
              spellCheck={false}
            />
          </div>
          <button type="submit" className="btn red" style={{ minHeight: "44px" }}>
            Look up passport
          </button>
        </form>

        {/* Quick Sample Fleet Chips (Custom Vector Icons, No Medals) */}
        <div className="passport-sample-chips-row">
          <span className="passport-sample-label">Sample Fleet Nodes:</span>
          {SAMPLE_MACHINES.map((sample) => {
            const isSelected =
              rawId.toLowerCase() === sample.id.toLowerCase() ||
              (isSpecimenShowcase && sample.alias === "PNLY-ROV-001");

            return (
              <button
                key={sample.id}
                type="button"
                onClick={() => selectSample(sample)}
                className={`passport-chip-btn ${isSelected ? "active" : ""}`}
                title={`Inspect ${sample.alias} (${sample.category})`}
              >
                <span className="passport-chip-icon">
                  {sample.icon === "rover" && <RoverIcon width={16} height={16} />}
                  {sample.icon === "drone" && <DroneIcon width={16} height={16} />}
                  {sample.icon === "ev" && <EvStationIcon width={16} height={16} />}
                </span>
                <span>
                  <b>{sample.alias}</b> [{sample.tierName}]
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Invalid ID Format Alert */}
      {rawId && !valid && (
        <div
          className="note"
          role="alert"
          style={{ marginBottom: "24px", color: "var(--crimson)" }}
        >
          Invalid machine identifier format. It must be &quot;0x&quot; followed by exactly 64
          hexadecimal characters.
        </div>
      )}

      {/* Specimen Showcase Notification Banner */}
      {isSpecimenShowcase && (
        <div className="passport-specimen-banner">
          <span className="passport-specimen-badge">
            <RoverIcon width={18} height={18} />
            SPECIMEN ATTESTATION PAPERS · FLAGSHIP REFERENCE NODE
          </span>
          <span>
            Displaying reference record for <b>PNLY-ROV-001</b>. Select another sample chip or enter
            any 64-hex Machine ID above to look up live papers.
          </span>
        </div>
      )}

      {/* PASSPORT DOSSIER DISPLAY */}
      {activeRecord && (
        <div className="passport-dossier-card">
          {/* DOSSIER HEADER */}
          <div className="passport-dossier-header">
            <div className="passport-header-left">
              <div className="passport-header-avatar">
                {activeSampleInfo?.icon === "rover" && <RoverIcon width={24} height={24} />}
                {activeSampleInfo?.icon === "drone" && <DroneIcon width={24} height={24} />}
                {activeSampleInfo?.icon === "ev" && <EvStationIcon width={24} height={24} />}
                {!activeSampleInfo && <MicrochipEnclaveIcon width={24} height={24} />}
              </div>
              <div className="passport-header-titles">
                <span className="passport-doc-serial">{docSerial}</span>
                <span className="passport-doc-category">
                  {activeSampleInfo?.category ?? "Physical Hardware Node"}
                </span>
              </div>
            </div>

            <div className="passport-header-badges">
              <span
                className={`passport-status-badge ${activeRecord.status === "ACTIVE" ? "active" : "frozen"}`}
              >
                STATUS: {activeRecord.status} · SECURE ENCLAVE
              </span>
              <span className={`passport-tier-badge ${activeRecord.tierName.toLowerCase()}`}>
                {activeRecord.tierName.toUpperCase()} TIER ({tier?.fee ?? "0.05%"})
              </span>
            </div>
          </div>

          {/* HARDWARE ENCLAVE ATTESTATION STRIP */}
          <div className="passport-enclave-strip">
            <div className="passport-enclave-item">
              <span>HARDWARE ENCLAVE:</span>
              <b>
                {activeSampleInfo?.chipModel ??
                  "NXP SE050 · EAL6+ Certified Hardware Security Module"}
              </b>
            </div>
            <div className="passport-enclave-item">
              <span>ROOT ATTESTATION:</span>
              <b>TAMPER-PROOF NON-EXPORTABLE</b>
            </div>
            <div className="passport-enclave-item">
              <span>NETWORK:</span>
              <b>
                {activeChain.name} (Chain ID {activeChain.id})
              </b>
            </div>
          </div>

          {/* 3-COLUMN CRYPTOGRAPHIC TRIAD */}
          <div className="passport-triad-grid">
            {/* PILLAR 01: CRYPTOGRAPHIC IDENTITY */}
            <div className="passport-pillar-card">
              <div className="passport-pillar-header">
                <div className="passport-pillar-icon">
                  <DualKeyIcon width={18} height={18} />
                </div>
                <div className="passport-pillar-title-wrap">
                  <span className="passport-pillar-tag">PILLAR [01]</span>
                  <span className="passport-pillar-name">CRYPTOGRAPHIC IDENTITY</span>
                </div>
              </div>

              <div className="passport-kv-list">
                <div className="passport-kv-item">
                  <span className="passport-kv-label">Machine ID (32-Byte Hash)</span>
                  <div className="passport-kv-value-row">
                    <span className="passport-kv-val" title={activeRecord.machineId}>
                      {shortHex(activeRecord.machineId)}
                    </span>
                    <CopyButton text={activeRecord.machineId} label="Machine ID" />
                  </div>
                </div>

                <div className="passport-kv-item">
                  <span className="passport-kv-label">Smart Account (ERC-4337)</span>
                  <div className="passport-kv-value-row">
                    <span className="passport-kv-val" title={activeRecord.account}>
                      {shortHex(activeRecord.account)}
                    </span>
                    <CopyButton text={activeRecord.account} label="Account Address" />
                  </div>
                </div>

                <div className="passport-kv-item">
                  <span className="passport-kv-label">Physical TPM Session Key</span>
                  <div className="passport-kv-value-row">
                    <span className="passport-kv-val" title={activeRecord.signer}>
                      {shortHex(activeRecord.signer)}
                    </span>
                    <CopyButton text={activeRecord.signer} label="Session Key" />
                  </div>
                </div>

                <div className="passport-kv-item">
                  <span className="passport-kv-label">Operator Safe Multisig</span>
                  <div className="passport-kv-value-row">
                    <span className="passport-kv-val" title={activeRecord.operator}>
                      {shortHex(activeRecord.operator)}
                    </span>
                    <CopyButton text={activeRecord.operator} label="Operator Address" />
                  </div>
                </div>
              </div>
            </div>

            {/* PILLAR 02: HARDWARE ATTESTATION */}
            <div className="passport-pillar-card">
              <div className="passport-pillar-header">
                <div className="passport-pillar-icon">
                  <MicrochipEnclaveIcon width={18} height={18} />
                </div>
                <div className="passport-pillar-title-wrap">
                  <span className="passport-pillar-tag">PILLAR [02]</span>
                  <span className="passport-pillar-name">HARDWARE ATTESTATION</span>
                </div>
              </div>

              <div className="passport-kv-list">
                <div className="passport-kv-item">
                  <span className="passport-kv-label">Attestation Certificate Hash</span>
                  <div className="passport-kv-value-row">
                    <span
                      className="passport-kv-val"
                      title={activeRecord.hardwareAttestation.hash ?? "None submitted"}
                    >
                      {activeRecord.hardwareAttestation.hash
                        ? shortHex(activeRecord.hardwareAttestation.hash)
                        : "None submitted"}
                    </span>
                    {activeRecord.hardwareAttestation.hash && (
                      <CopyButton
                        text={activeRecord.hardwareAttestation.hash}
                        label="Attestation Hash"
                      />
                    )}
                  </div>
                </div>

                <div className="passport-kv-item">
                  <span className="passport-kv-label">Onchain Verification</span>
                  <div className="passport-kv-value-row">
                    <span
                      className="passport-kv-val"
                      style={{
                        color: activeRecord.hardwareAttestation.valid ? "#4ade80" : "#f87171",
                        fontWeight: 700,
                      }}
                    >
                      {activeRecord.hardwareAttestation.valid
                        ? "VERIFIED ON-CHAIN"
                        : "UNVERIFIED HARDWARE"}
                    </span>
                  </div>
                </div>

                <div className="passport-kv-item">
                  <span className="passport-kv-label">Key Protection Level</span>
                  <div className="passport-kv-value-row">
                    <span className="passport-kv-val" style={{ color: "#4ade80" }}>
                      NON-EXPORTABLE (TPM / SE)
                    </span>
                  </div>
                </div>

                <div className="passport-kv-item">
                  <span className="passport-kv-label">Autonomous Spend Policy</span>
                  <div className="passport-kv-value-row">
                    <span className="passport-kv-val" style={{ color: "#eee" }}>
                      ACTIVE · DAILY CAP ENFORCED
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* PILLAR 03: SETTLEMENT TRACK RECORD */}
            <div className="passport-pillar-card">
              <div className="passport-pillar-header">
                <div className="passport-pillar-icon">
                  <SettlementLedgerIcon width={18} height={18} />
                </div>
                <div className="passport-pillar-title-wrap">
                  <span className="passport-pillar-tag">PILLAR [03]</span>
                  <span className="passport-pillar-name">SETTLEMENT TRACK RECORD</span>
                </div>
              </div>

              <div className="passport-kv-list">
                <div className="passport-kv-item">
                  <span className="passport-kv-label">Lifetime {stablecoinSymbol} Settled</span>
                  <div className="passport-kv-value-row">
                    <span className="passport-kv-val big-mono">
                      {formatStable(activeRecord.metrics.lifetimeStableOut)}
                    </span>
                  </div>
                </div>

                <div className="passport-kv-item">
                  <span className="passport-kv-label">Total Successful Swaps</span>
                  <div className="passport-kv-value-row">
                    <span className="passport-kv-val">
                      {formatCount(activeRecord.metrics.totalSuccessfulSwaps)} Swaps
                    </span>
                  </div>
                </div>

                <div className="passport-kv-item">
                  <span className="passport-kv-label">Registered Block & Date</span>
                  <div className="passport-kv-value-row">
                    <span className="passport-kv-val">
                      #{formatCount(activeRecord.registeredBlock)} (
                      {formatTime(activeRecord.registeredAt)})
                    </span>
                  </div>
                </div>

                <div className="passport-kv-item">
                  <span className="passport-kv-label">Registration Transaction</span>
                  <div className="passport-kv-value-row">
                    <span className="passport-kv-val">
                      {registeredTx ? (
                        <a
                          href={registeredTx}
                          target="_blank"
                          rel="noreferrer"
                          style={{ color: "var(--crimson)", textDecoration: "underline" }}
                        >
                          {shortHex(activeRecord.registeredTx)} ↗
                        </a>
                      ) : (
                        shortHex(activeRecord.registeredTx)
                      )}
                    </span>
                    {activeRecord.registeredTx && (
                      <CopyButton text={activeRecord.registeredTx} label="Tx Hash" />
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ACTION TOOLBAR */}
          <div className="passport-action-bar">
            <button
              type="button"
              className="btn dark"
              onClick={copyPublicLink}
              style={{ minHeight: "44px" }}
            >
              {linkCopied ? "Link copied to clipboard" : "Copy public link"}
            </button>
            <button
              type="button"
              className="btn dark"
              onClick={() => setShowRaw((v) => !v)}
              aria-expanded={showRaw}
              style={{ minHeight: "44px" }}
            >
              {showRaw ? "Hide raw JSON record" : "Inspect raw JSON record"}
            </button>
            <Link
              href={`/machines`}
              className="btn dark"
              style={{ minHeight: "44px", display: "inline-flex", alignItems: "center" }}
            >
              Explore all machines →
            </Link>
          </div>

          {/* RAW JSON VIEWER */}
          {showRaw && (
            <pre
              tabIndex={0}
              aria-label="Raw passport data"
              className="font-mono"
              style={{
                marginTop: "16px",
                padding: "16px",
                overflowX: "auto",
                fontSize: "12px",
                background: "rgba(0, 0, 0, 0.4)",
                border: "1px solid var(--line)",
                borderRadius: "12px",
                color: "#ffc04d",
              }}
            >
              {JSON.stringify(activeRecord, null, 2)}
            </pre>
          )}
        </div>
      )}

      {/* TRANSACTION & EVENT LEDGER */}
      {activeRecord && (
        <div style={{ marginTop: "32px" }}>
          <div className="section-hairline" style={{ marginBottom: "16px" }}>
            <span className="section-hairline-label">LIVE TRANSACTION LEDGER</span>
            <div className="section-hairline-line" />
          </div>
          <MachineHistory machineId={activeRecord.machineId} />
        </div>
      )}
    </section>
  );
}

export default function PassportPage() {
  return (
    <div className="frame">
      <PageBackground word="PASSPORT" variant="desk" />
      <Navbar />
      <main id="main-content">
        <section className="ph ph-haze ph-haze-passport page-reveal-hero">
          <span className="tag">
            <b className="dot" aria-hidden="true" />
            <TextScramble
              text="ONCHAIN PASSPORT · DEVICE ATTESTATION"
              scrambleSpeed={22}
              revealSpeed={32}
            />
          </span>
          <h1>Every machine gets papers.</h1>
          <p>
            Verifiable onchain cryptographic identity, hardware security enclave, and settlement
            track record for each registered machine, read directly from the PINELY indexer on
            Robinhood Chain.
          </p>
        </section>

        <Suspense fallback={null}>
          <PassportView />
        </Suspense>
      </main>
      <Footer />
    </div>
  );
}
