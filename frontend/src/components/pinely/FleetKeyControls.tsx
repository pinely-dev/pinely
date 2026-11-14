"use client";

import { useState } from "react";
import { isAddress, isHex, zeroAddress, type Address, type Hash } from "viem";
import type { usePreparedTx } from "@/hooks/usePreparedTx";
import {
  fetchAllowlistStatus,
  fetchFleetSummary,
  fetchMachineDetail,
  prepareAllowlistAction,
  prepareDeregisterAction,
  prepareGuardianAction,
  prepareRevokeSessionKeyAction,
  prepareRotateSessionKeyAction,
  type BackendMachine,
} from "@/lib/api";
import { isApiError } from "@/lib/http";
import { Select } from "@/components/pinely/Select";
import { shortHex } from "@/lib/machine-view";
import { stablecoinSymbol } from "@/lib/chain";

type Tx = ReturnType<typeof usePreparedTx>;

interface FleetKeyControlsProps {
  operator: string;
  machines: BackendMachine[];
  tx: Tx;
  /** The guardian the indexer reports for this operator (the zero address means none). */
  guardian: string | null | undefined;
  invalidate: string[][];
}

const MAX_KEY_DAYS = 30;
const DEREGISTER_WORD = "DEREGISTER";

const errorStyle = { color: "#ff8fa3", fontSize: "13px", marginTop: "8px" } as const;

function machineIdOf(m: BackendMachine): Hash {
  return (m.machineId ?? m.id ?? "") as Hash;
}

function isMachineId(value: string): value is Hash {
  return isHex(value, { strict: true }) && value.length === 66;
}

function MachineSelect({
  machines,
  value,
  onChange,
}: {
  machines: BackendMachine[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", width: "100%", gap: "6px" }}>
      <span
        className="font-mono text-xs"
        style={{ color: "var(--mut)", textTransform: "uppercase" }}
      >
        Target Machine Node
      </span>
      <Select
        value={value}
        onChange={onChange}
        options={machines.map((m) => ({
          value: machineIdOf(m),
          label: shortHex(machineIdOf(m), 8, 6),
        }))}
        ariaLabel="Machine"
        placeholder="Select a machine…"
        mono
      />
    </label>
  );
}

/**
 * Key custody and lifecycle controls: rotate or revoke a machine's session key, set the fleet
 * guardian, manage a machine's asset allowlist, and decommission a machine. Every action is a
 * transaction the operator signs; this component only asks the backend to prepare it.
 */
export function FleetKeyControls({
  operator,
  machines,
  tx,
  guardian,
  invalidate,
}: FleetKeyControlsProps) {
  // Session key
  const [keyMachine, setKeyMachine] = useState("");
  const [newKey, setNewKey] = useState("");
  const [keyDays, setKeyDays] = useState(String(MAX_KEY_DAYS));
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [keyError, setKeyError] = useState<string | null>(null);

  // Guardian
  const [guardianInput, setGuardianInput] = useState("");
  const [guardianError, setGuardianError] = useState<string | null>(null);
  const currentGuardian =
    guardian && guardian.toLowerCase() !== zeroAddress ? (guardian as Address) : null;

  // Allowlist
  const [allowMachine, setAllowMachine] = useState("");
  const [asset, setAsset] = useState("");
  const [allowStatus, setAllowStatus] = useState<string | null>(null);
  const [allowError, setAllowError] = useState<string | null>(null);

  // Deregister
  const [removeMachine, setRemoveMachine] = useState("");
  const [removeWord, setRemoveWord] = useState("");
  const [removeError, setRemoveError] = useState<string | null>(null);

  const selectedSigner = machines.find((m) => machineIdOf(m) === keyMachine)?.signer;

  const rotateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    const days = Number(keyDays);
    if (!isMachineId(keyMachine)) return setKeyError("Select a machine.");
    if (!isAddress(newKey) || newKey.toLowerCase() === zeroAddress) {
      return setKeyError("Enter the new session key as a valid address.");
    }
    if (!Number.isInteger(days) || days < 1 || days > MAX_KEY_DAYS) {
      return setKeyError(`Validity must be a whole number of days from 1 to ${MAX_KEY_DAYS}.`);
    }
    setKeyError(null);
    const id = keyMachine;
    const key = newKey as Address;
    const ok = await tx.run(
      () => prepareRotateSessionKeyAction({ machineId: id, newKey: key, validForDays: days }),
      {
        invalidate,
        waitForIndexer: async () =>
          (await fetchMachineDetail(id)).signer.toLowerCase() === key.toLowerCase(),
      },
    );
    if (ok) setNewKey("");
  };

  const revokeKey = async () => {
    setConfirmRevoke(false);
    if (!isMachineId(keyMachine)) return setKeyError("Select a machine.");
    setKeyError(null);
    // The account's session key is not indexed, so success is the mined receipt itself.
    await tx.run(() => prepareRevokeSessionKeyAction({ machineId: keyMachine }), { invalidate });
  };

  const setGuardian = async (remove: boolean) => {
    if (!remove && !isAddress(guardianInput)) {
      return setGuardianError("Enter the guardian as a valid address.");
    }
    setGuardianError(null);
    const next = remove ? null : (guardianInput as Address);
    const ok = await tx.run(() => prepareGuardianAction({ guardian: next }), {
      invalidate,
      waitForIndexer: async () => {
        const profile = (await fetchFleetSummary(operator)).profile;
        const stored = profile?.guardian?.toLowerCase() ?? zeroAddress;
        return stored === (next ? next.toLowerCase() : zeroAddress);
      },
    });
    if (ok) setGuardianInput("");
  };

  const checkAllowlist = async () => {
    if (!isMachineId(allowMachine) || !isAddress(asset)) {
      return setAllowError("Select a machine and enter a valid asset address.");
    }
    setAllowError(null);
    setAllowStatus("Checking…");
    try {
      const allowed = await fetchAllowlistStatus(allowMachine, asset as Address);
      setAllowStatus(allowed ? "Allowed" : "Not allowed");
    } catch (error) {
      setAllowStatus(null);
      setAllowError(isApiError(error) ? error.message : "Could not read the allowlist.");
    }
  };

  const changeAllowlist = async (allowed: boolean) => {
    if (!isMachineId(allowMachine) || !isAddress(asset)) {
      return setAllowError("Select a machine and enter a valid asset address.");
    }
    setAllowError(null);
    const id = allowMachine;
    const token = asset as Address;
    const ok = await tx.run(
      () => prepareAllowlistAction({ machineId: id, asset: token, allowed }),
      {
        // The allowlist is read straight from the chain, so it is current once the receipt is in.
        waitForIndexer: async () => (await fetchAllowlistStatus(id, token)) === allowed,
      },
    );
    if (ok) setAllowStatus(allowed ? "Allowed" : "Not allowed");
  };

  const deregister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isMachineId(removeMachine)) return setRemoveError("Select a machine.");
    if (removeWord !== DEREGISTER_WORD) {
      return setRemoveError(`Type ${DEREGISTER_WORD} to confirm.`);
    }
    setRemoveError(null);
    const id = removeMachine;
    const ok = await tx.run(() => prepareDeregisterAction({ machineId: id }), {
      invalidate,
      waitForIndexer: async () => (await fetchMachineDetail(id)).deregistered === true,
    });
    if (ok) {
      setRemoveMachine("");
      setRemoveWord("");
    }
  };

  return (
    <div className="grid fleet-key-grid">
      {/* MODULE 01: SESSION KEY CONTROLS */}
      <form
        className="card security-module-card"
        onSubmit={rotateKey}
        style={{ padding: "28px 26px" }}
      >
        <div className="card-top-badge-row">
          <span className="security-badge routine font-mono">MODULE 01 · ROUTINE HYGIENE</span>
          <span className="font-mono text-xs" style={{ color: "var(--mut)" }}>
            MAX 30 DAYS
          </span>
        </div>

        <div style={{ marginTop: "12px", marginBottom: "16px" }}>
          <h3 style={{ margin: "0 0 6px", fontSize: "20px" }}>Session Key Manager</h3>
          <p className="note" style={{ margin: 0, fontSize: "13px" }}>
            Sets the key the machine signs with and the window it is valid for. You can rotate or
            revoke it at any time. Rotating submits two sequential onchain updates.
          </p>
        </div>

        <MachineSelect machines={machines} value={keyMachine} onChange={setKeyMachine} />
        {selectedSigner && (
          <div
            className="font-mono text-xs"
            style={{
              color: "var(--bl)",
              background: "rgba(255,255,255,0.03)",
              padding: "8px 12px",
              borderRadius: "6px",
              margin: "8px 0",
            }}
          >
            Active Signer: <b>{shortHex(selectedSigner)}</b>
          </div>
        )}

        <label style={{ marginTop: "12px" }}>
          <span
            className="font-mono text-xs"
            style={{ color: "var(--mut)", textTransform: "uppercase" }}
          >
            New Session Key Address
          </span>
          <input
            className="fleet-input"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            placeholder="0x… (Hardware Signer EOA)"
            spellCheck={false}
          />
        </label>

        <label style={{ marginTop: "12px" }}>
          <span
            className="font-mono text-xs"
            style={{ color: "var(--mut)", textTransform: "uppercase" }}
          >
            Validity Duration (Days, 1 to {MAX_KEY_DAYS})
          </span>
          <input
            className="fleet-input"
            inputMode="numeric"
            value={keyDays}
            onChange={(e) => setKeyDays(e.target.value)}
          />
        </label>

        {keyError && (
          <p role="alert" style={errorStyle}>
            {keyError}
          </p>
        )}

        <div className="fleet-btn-group-2" style={{ marginTop: "auto", paddingTop: "18px" }}>
          <button
            type="submit"
            className="btn red"
            disabled={tx.busy}
            style={{ minHeight: "44px", width: "100%" }}
          >
            Rotate session key
          </button>
          {confirmRevoke ? (
            <button
              type="button"
              className="btn red"
              onClick={revokeKey}
              style={{ minHeight: "44px", width: "100%" }}
            >
              Confirm Revoke
            </button>
          ) : (
            <button
              type="button"
              className="btn dark"
              disabled={tx.busy || !keyMachine}
              onClick={() => setConfirmRevoke(true)}
              style={{ minHeight: "44px", width: "100%" }}
            >
              Revoke key
            </button>
          )}
        </div>
      </form>

      {/* MODULE 02: MULTISIG GUARDIAN */}
      <div className="card security-module-card" style={{ padding: "28px 26px" }}>
        <div className="card-top-badge-row">
          <span className="security-badge routine font-mono">MODULE 02 · GOVERNANCE</span>
          <span className="font-mono text-xs" style={{ color: "var(--mut)" }}>
            SAFE 2-OF-3 READY
          </span>
        </div>

        <div style={{ marginTop: "12px", marginBottom: "16px" }}>
          <h3 style={{ margin: "0 0 6px", fontSize: "20px" }}>Multisig Guardian</h3>
          <p className="note" style={{ margin: 0, fontSize: "13px" }}>
            Delegates emergency freeze rights to an external security address (for example a Safe
            multisig). The guardian can freeze, but cannot unfreeze, change policies, withdraw, or
            transfer assets.
          </p>
        </div>

        <div
          className="font-mono text-xs"
          style={{
            background: "rgba(255,255,255,0.03)",
            padding: "12px 14px",
            borderRadius: "6px",
            marginBottom: "14px",
            border: "1px solid rgba(255,255,255,0.06)",
          }}
        >
          <span style={{ color: "var(--mut)" }}>ACTIVE GUARDIAN: </span>
          <b style={{ color: currentGuardian ? "#ffffff" : "var(--mut)" }}>
            {currentGuardian ? shortHex(currentGuardian) : "None (Unassigned)"}
          </b>
        </div>

        <label>
          <span
            className="font-mono text-xs"
            style={{ color: "var(--mut)", textTransform: "uppercase" }}
          >
            Guardian Contract / Wallet Address
          </span>
          <input
            className="fleet-input"
            value={guardianInput}
            onChange={(e) => setGuardianInput(e.target.value)}
            placeholder="0x… (Safe Multisig / EOA)"
            spellCheck={false}
          />
        </label>

        {guardianError && (
          <p role="alert" style={errorStyle}>
            {guardianError}
          </p>
        )}

        <div className="fleet-btn-group-2" style={{ marginTop: "auto", paddingTop: "18px" }}>
          <button
            type="button"
            className="btn red"
            disabled={tx.busy}
            onClick={() => setGuardian(false)}
            style={{ minHeight: "44px", width: "100%" }}
          >
            Set guardian
          </button>
          <button
            type="button"
            className="btn dark"
            disabled={tx.busy || !currentGuardian}
            onClick={() => setGuardian(true)}
            style={{ minHeight: "44px", width: "100%" }}
          >
            Remove guardian
          </button>
        </div>
      </div>

      {/* MODULE 03: ASSET ALLOWLIST */}
      <div className="card security-module-card" style={{ padding: "28px 26px" }}>
        <div className="card-top-badge-row">
          <span className="security-badge firewall font-mono">MODULE 03 · TOKEN FIREWALL</span>
          <span className="font-mono text-xs" style={{ color: "var(--mut)" }}>
            ONCHAIN WHITELIST
          </span>
        </div>

        <div style={{ marginTop: "12px", marginBottom: "16px" }}>
          <h3 style={{ margin: "0 0 6px", fontSize: "20px" }}>Asset Allowlist</h3>
          <p className="note" style={{ margin: 0, fontSize: "13px" }}>
            Lists the ERC-20 tokens a machine is approved to swap. The registry stores the list and
            PinelyHook (Stage 2, not deployed) enforces it, so nothing is enforced until Stage 2 is
            deployed.
          </p>
        </div>

        <MachineSelect machines={machines} value={allowMachine} onChange={setAllowMachine} />

        <label style={{ marginTop: "12px" }}>
          <span
            className="font-mono text-xs"
            style={{ color: "var(--mut)", textTransform: "uppercase" }}
          >
            Asset Token Address
          </span>
          <input
            className="fleet-input"
            value={asset}
            onChange={(e) => {
              setAsset(e.target.value);
              setAllowStatus(null);
            }}
            placeholder={`0x… (${stablecoinSymbol} / $PINELY)`}
            spellCheck={false}
          />
        </label>

        {allowStatus && (
          <div
            role="status"
            className="font-mono text-xs"
            style={{
              padding: "8px 12px",
              borderRadius: "6px",
              marginTop: "8px",
              background:
                allowStatus === "Allowed" ? "rgba(255,255,255,0.06)" : "rgba(224,72,107,0.15)",
              border: `1px solid ${allowStatus === "Allowed" ? "rgba(255,255,255,0.15)" : "rgba(224,72,107,0.3)"}`,
              color: allowStatus === "Allowed" ? "#ffffff" : "#ff8fa3",
            }}
          >
            FIREWALL STATUS: <b>{allowStatus.toUpperCase()}</b>
          </div>
        )}

        {allowError && (
          <p role="alert" style={errorStyle}>
            {allowError}
          </p>
        )}

        <div className="fleet-btn-group-3" style={{ marginTop: "auto", paddingTop: "18px" }}>
          <button
            type="button"
            className="btn dark"
            onClick={checkAllowlist}
            style={{ minHeight: "44px", width: "100%" }}
          >
            Check status
          </button>
          <button
            type="button"
            className="btn red"
            disabled={tx.busy}
            onClick={() => changeAllowlist(true)}
            style={{ minHeight: "44px", width: "100%" }}
          >
            Allow token
          </button>
          <button
            type="button"
            className="btn dark"
            disabled={tx.busy}
            onClick={() => changeAllowlist(false)}
            style={{ minHeight: "44px", width: "100%" }}
          >
            Revoke
          </button>
        </div>
      </div>

      {/* MODULE 04: DECOMMISSION MACHINE */}
      <form
        className="card security-module-card"
        onSubmit={deregister}
        style={{ padding: "28px 26px" }}
      >
        <div className="card-top-badge-row">
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
            MODULE 04 · DECOMMISSION
          </span>
          <span className="font-mono text-xs" style={{ color: "var(--mut)", fontWeight: 600 }}>
            IRREVERSIBLE ACTION
          </span>
        </div>

        <div style={{ marginTop: "12px", marginBottom: "16px" }}>
          <h3 style={{ margin: "0 0 6px", fontSize: "20px", color: "#ffffff" }}>
            Decommission a Machine
          </h3>
          <p className="note" style={{ margin: 0, fontSize: "13px" }}>
            Permanently purges the machine from MachineRegistry.sol. All session keys and spend
            limits are deleted onchain.
          </p>
        </div>

        <MachineSelect machines={machines} value={removeMachine} onChange={setRemoveMachine} />

        <label style={{ marginTop: "12px" }}>
          <span
            className="font-mono text-xs"
            style={{ color: "var(--bl)", textTransform: "uppercase" }}
          >
            Type <b style={{ color: "#ffffff" }}>{DEREGISTER_WORD}</b> to confirm purge
          </span>
          <input
            className="fleet-input font-mono"
            value={removeWord}
            onChange={(e) => setRemoveWord(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            placeholder={DEREGISTER_WORD}
            style={{ borderColor: "rgba(224, 72, 107, 0.4)" }}
          />
        </label>

        {removeError && (
          <p role="alert" style={errorStyle}>
            {removeError}
          </p>
        )}

        <div style={{ marginTop: "auto", paddingTop: "18px", width: "100%" }}>
          <button
            type="submit"
            className="btn red"
            disabled={tx.busy || removeWord !== DEREGISTER_WORD || !removeMachine}
            style={{
              minHeight: "44px",
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            Deregister machine from registry
          </button>
        </div>
      </form>
    </div>
  );
}
