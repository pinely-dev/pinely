"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isAddress, isHex, parseUnits, type Address, type Hash } from "viem";
import { prepareRegisterAction } from "@/lib/api";
import { useScrollLock } from "@/lib/useScrollLock";
import type { usePreparedTx } from "@/hooks/usePreparedTx";
import { stablecoinSymbol } from "@/lib/chain";

type Tx = ReturnType<typeof usePreparedTx>;

interface RegisterMachineModalProps {
  isOpen: boolean;
  onClose: () => void;
  operator?: string;
  tx: Tx;
  invalidate: string[][];
  onSuccess?: (account: string) => void;
}

function stableUnits(value: string): bigint | null {
  if (!/^\d+(\.\d{1,6})?$/.test(value.trim())) return null;
  return parseUnits(value.trim(), 6);
}

export function RegisterMachineModal({
  isOpen,
  onClose,
  operator,
  tx,
  invalidate,
  onSuccess,
}: RegisterMachineModalProps) {
  const [mounted, setMounted] = useState(false);
  const [activeTab, setActiveTab] = useState<"cli" | "manual">("manual");
  const [copied, setCopied] = useState(false);

  // Manual form state
  const [account, setAccount] = useState("");
  const [signer, setSigner] = useState("");
  const [attestation, setAttestation] = useState("");
  const [regPerSwap, setRegPerSwap] = useState("10");
  const [regDaily, setRegDaily] = useState("50");
  const [registerError, setRegisterError] = useState<string | null>(null);

  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useScrollLock(isOpen);

  // Close on ESC key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !tx.busy) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, tx.busy]);

  const cliCommand = `npx @pinely-protocol/sdk@beta machine create --operator ${operator || "0xYourOperatorAddress"}`;

  const copyCliCommand = async () => {
    try {
      await navigator.clipboard.writeText(cliCommand);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // fallback
    }
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

    const ok = await tx.run(
      () =>
        prepareRegisterAction({
          account: account as Address,
          signer: signer as Address,
          attestationHash: attestation ? (attestation as Hash) : undefined,
          maxStableOutPerSwap: max.toString(),
          dailyStableOutCap: daily.toString(),
        }),
      { invalidate },
    );

    if (ok) {
      const createdAccount = account;
      setAccount("");
      setSigner("");
      setAttestation("");
      onSuccess?.(createdAccount);
      onClose();
    }
  };

  if (!mounted || !isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="emergency-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="provision-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !tx.busy) {
          onClose();
        }
      }}
    >
      <div
        ref={modalRef}
        className="emergency-modal-box"
        style={{
          maxWidth: "600px",
          maxHeight: "90vh",
          overflowY: "auto",
          borderColor: "rgba(255, 51, 102, 0.4)",
          background: "#0a0c10",
        }}
      >
        {/* Top Header Badge & Close Button */}
        <div className="card-top-badge-row">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span className="security-badge sentinel font-mono">PROVISIONING DOCK</span>
            <span className="font-mono text-xs" style={{ color: "var(--mut-light)" }}>
              NEW HARDWARE
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={tx.busy}
            aria-label="Close dialog"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--mut)",
              cursor: "pointer",
              fontSize: "20px",
              lineHeight: 1,
              padding: "4px 8px",
              borderRadius: "4px",
              minHeight: "44px",
              minWidth: "44px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ✕
          </button>
        </div>

        {/* Dialog Title & Subtitle */}
        <div>
          <h2 id="provision-modal-title" style={{ fontSize: "22px", margin: "0 0 6px" }}>
            Register New Machine
          </h2>
          <p className="note" style={{ margin: 0, fontSize: "13px" }}>
            Binds a physical node smart account to your operator registry on Robinhood Chain.
          </p>
        </div>

        {/* Tab Switcher */}
        <div
          role="tablist"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "8px",
            background: "rgba(255, 255, 255, 0.04)",
            padding: "4px",
            borderRadius: "8px",
            border: "1px solid var(--line)",
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "cli"}
            onClick={() => setActiveTab("cli")}
            style={{
              minHeight: "44px",
              padding: "8px 14px",
              fontSize: "13px",
              fontWeight: 600,
              borderRadius: "6px",
              border: "none",
              background: activeTab === "cli" ? "rgba(255, 51, 102, 0.18)" : "transparent",
              color: activeTab === "cli" ? "#ffffff" : "var(--mut)",
              borderBottom: activeTab === "cli" ? "2px solid var(--red)" : "2px solid transparent",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            ⚡ Command Line (Beta)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "manual"}
            onClick={() => setActiveTab("manual")}
            style={{
              minHeight: "44px",
              padding: "8px 14px",
              fontSize: "13px",
              fontWeight: 600,
              borderRadius: "6px",
              border: "none",
              background: activeTab === "manual" ? "rgba(255, 51, 102, 0.18)" : "transparent",
              color: activeTab === "manual" ? "#ffffff" : "var(--mut)",
              borderBottom:
                activeTab === "manual" ? "2px solid var(--red)" : "2px solid transparent",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
          >
            📝 On-Chain Form (Recommended)
          </button>
        </div>

        {/* TAB 1: COMMAND LINE (the CLI prints a registration transaction; it never sends one) */}
        {activeTab === "cli" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div
              style={{
                background: "rgba(0, 0, 0, 0.5)",
                border: "1px solid var(--line)",
                borderRadius: "8px",
                padding: "16px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                }}
              >
                <span className="font-mono text-xs" style={{ color: "var(--mut)" }}>
                  RUN ON THE MACHINE OR A DEV BOX
                </span>
                <button
                  type="button"
                  className="copy-hash-btn font-mono"
                  onClick={copyCliCommand}
                  style={{
                    minHeight: "44px",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  {copied ? "✓ Copied" : "Copy Command"}
                </button>
              </div>
              <pre
                className="font-mono"
                style={{
                  margin: 0,
                  padding: "12px",
                  background: "#000000",
                  borderRadius: "6px",
                  color: "#22c55e",
                  fontSize: "13px",
                  overflowX: "auto",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                }}
              >
                {cliCommand}
              </pre>
            </div>

            {/* Step-by-step Hardware Guide */}
            <div
              style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "13px" }}
            >
              <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                <span
                  style={{
                    width: "24px",
                    height: "24px",
                    borderRadius: "50%",
                    background: "rgba(255, 51, 102, 0.15)",
                    color: "var(--red)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12px",
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  1
                </span>
                <div>
                  <b style={{ color: "#ffffff" }}>Create a Machine Identity:</b> The CLI generates a
                  software session key for this run (pass --key to reuse one). It is never saved.
                  Hardware key storage (TPM / Secure Element) is not available yet, so use the CLI
                  for development only.
                </div>
              </div>

              <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                <span
                  style={{
                    width: "24px",
                    height: "24px",
                    borderRadius: "50%",
                    background: "rgba(255, 51, 102, 0.15)",
                    color: "var(--red)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12px",
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  2
                </span>
                <div>
                  <b style={{ color: "#ffffff" }}>Read the Output:</b> It prints the machine ID, the
                  machine account and a registration transaction (to and data). Without --account
                  the account is the signer address, a development shortcut. The CLI does not send
                  any transaction.
                </div>
              </div>

              <div style={{ display: "flex", gap: "12px", alignItems: "flex-start" }}>
                <span
                  style={{
                    width: "24px",
                    height: "24px",
                    borderRadius: "50%",
                    background: "rgba(255, 51, 102, 0.15)",
                    color: "var(--red)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "12px",
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  3
                </span>
                <div>
                  <b style={{ color: "#ffffff" }}>Register Onchain:</b> The registry accepts a
                  registration only from the machine account itself or with the account owner&apos;s
                  signature, so finish in the On-Chain Form. Registration costs a 2{" "}
                  {stablecoinSymbol} anti-sybil fee. Once mined, telemetry appears in this desk.
                </div>
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                paddingTop: "12px",
                borderTop: "1px solid var(--line)",
              }}
            >
              <button
                type="button"
                className="btn dark"
                onClick={() => setActiveTab("manual")}
                style={{ minHeight: "44px", fontSize: "13px" }}
              >
                Switch to the On-Chain Form →
              </button>
              <button
                type="button"
                className="btn dark"
                onClick={onClose}
                style={{ minHeight: "44px", fontSize: "13px" }}
              >
                Close
              </button>
            </div>
          </div>
        )}

        {/* TAB 2: MANUAL FORM */}
        {activeTab === "manual" && (
          <form
            onSubmit={submitRegister}
            style={{ display: "flex", flexDirection: "column", gap: "14px" }}
          >
            <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span
                className="font-mono text-xs"
                style={{ color: "var(--mut)", textTransform: "uppercase" }}
              >
                Step 1 · Machine Account Address (Deterministic CREATE2)
              </span>
              <input
                className="fleet-input font-mono"
                value={account}
                onChange={(e) => setAccount(e.target.value)}
                placeholder="0x… (Machine Smart Contract Address)"
                spellCheck={false}
                required
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span
                className="font-mono text-xs"
                style={{ color: "var(--mut)", textTransform: "uppercase" }}
              >
                Step 2 · Session Key Address (Machine Signer)
              </span>
              <input
                className="fleet-input font-mono"
                value={signer}
                onChange={(e) => setSigner(e.target.value)}
                placeholder="0x… (Machine Signer Address)"
                spellCheck={false}
                required
              />
            </label>

            <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span
                className="font-mono text-xs"
                style={{ color: "var(--mut)", textTransform: "uppercase" }}
              >
                Step 3 · Hardware Attestation Proof (Optional)
              </span>
              <input
                className="fleet-input font-mono"
                value={attestation}
                onChange={(e) => setAttestation(e.target.value)}
                placeholder="0x… (32 bytes cryptographic proof)"
                spellCheck={false}
              />
            </label>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
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
                  required
                />
              </label>

              <label style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
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
                  required
                />
              </label>
            </div>

            {/* Protocol Fee Notice */}
            <div
              style={{
                padding: "10px 14px",
                background: "rgba(255, 255, 255, 0.03)",
                border: "1px solid var(--line)",
                borderRadius: "6px",
                fontSize: "12px",
                color: "var(--mut-light)",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <span>Anti-Sybil Registration Fee:</span>
              <b style={{ color: "#ffffff", fontFamily: "var(--font-mono)" }}>
                2.00 {stablecoinSymbol}
              </b>
            </div>

            {registerError && (
              <p
                role="alert"
                style={{ color: "#ff8fa3", fontSize: "13px", margin: 0, overflowWrap: "anywhere" }}
              >
                {registerError}
              </p>
            )}

            <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
              <button
                type="submit"
                className="btn red"
                disabled={tx.busy}
                style={{ minHeight: "44px", flex: 1 }}
              >
                {tx.busy ? "Confirming onchain…" : "Approve & Register on Robinhood Chain"}
              </button>
              <button
                type="button"
                className="btn dark"
                disabled={tx.busy}
                onClick={onClose}
                style={{ minHeight: "44px" }}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
