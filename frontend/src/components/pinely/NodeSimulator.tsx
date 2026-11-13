"use client";

import { useState, useEffect } from "react";
import { activeChain, stablecoinSymbol, nativeSymbol } from "@/lib/chain";
import { findContractAddress } from "@pinely/shared/contracts";

interface NodeSimulatorProps {
  className?: string;
}

export function NodeSimulator({ className = "" }: NodeSimulatorProps) {
  const [status, setStatus] = useState<"online" | "spending" | "frozen">("online");
  const [spentToday, setSpentToday] = useState<number>(0.0);
  const [txCount, setTxCount] = useState<number>(0);
  const [lastTxLabel, setLastTxLabel] = useState<string>("Awaiting first test payment");
  const [latency, setLatency] = useState<number>(118);
  const [notice, setNotice] = useState<string | null>(null);
  const [showPayload, setShowPayload] = useState<boolean>(false);

  const dailyCap = 50.0;
  const perTxCap = 5.0;

  // Real-time latency jitter simulation (108ms - 138ms, simulated jitter around the chain's block time)
  useEffect(() => {
    const interval = setInterval(() => {
      setLatency(Math.floor(108 + Math.random() * 30));
    }, 3200);
    return () => clearInterval(interval);
  }, []);

  const handleSimulatePayment = () => {
    if (status === "frozen") {
      setNotice("REVERT: Machine account is currently FROZEN via Kill Switch.");
      return;
    }

    const microAmount = 1.5;
    if (spentToday + microAmount > dailyCap) {
      setNotice(
        `REVERT: Spend limit exceeded. Daily cap is $${dailyCap.toFixed(2)} ${stablecoinSymbol}.`,
      );
      return;
    }

    setStatus("spending");
    setNotice(`Relaying UserOp... Sponsored ${nativeSymbol} gas applied.`);

    setTimeout(() => {
      const nextSpent = Math.min(dailyCap, +(spentToday + microAmount).toFixed(2));
      const nextTx = txCount + 1;
      const simTxLabel = `SIM-TX #${nextTx} (+$${microAmount.toFixed(2)} ${stablecoinSymbol})`;

      setSpentToday(nextSpent);
      setTxCount(nextTx);
      setLastTxLabel(simTxLabel);
      setStatus("online");
      setNotice(
        `[SANDBOX] Settled +$${microAmount.toFixed(2)} ${stablecoinSymbol} · Sponsored ${nativeSymbol} Gas Applied`,
      );

      setTimeout(() => {
        setNotice(null);
      }, 4000);
    }, 600);
  };

  const handleToggleKillSwitch = () => {
    if (status === "frozen") {
      setStatus("online");
      setNotice("Kill Switch disengaged. Machine restored to ACTIVE state.");
    } else {
      setStatus("frozen");
      setNotice("EMERGENCY HALT: 1-Tx Kill Switch triggered. Machine session FROZEN.");
    }
  };

  const handleReset = () => {
    setStatus("online");
    setSpentToday(0.0);
    setTxCount(0);
    setLastTxLabel("Awaiting first test payment");
    setNotice(null);
  };

  const spendPercentage = Math.min(100, (spentToday / dailyCap) * 100);

  const paymasterAddress = findContractAddress(activeChain.id, "PinelyPaymaster") ?? "not deployed";
  const stablecoinAddress = findContractAddress(activeChain.id, "STABLECOIN") ?? "not configured";

  const eip712Sample = {
    domain: {
      name: "PINELY",
      version: "1",
      chainId: activeChain.id,
      verifyingContract: paymasterAddress,
    },
    types: {
      SpendIntent: [
        { name: "machineId", type: "bytes32" },
        { name: "recipient", type: "address" },
        { name: "amount", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    message: {
      machineId: "0x504e4c592d53414e44424f582d30303100000000000000000000000000000000",
      recipient: stablecoinAddress,
      amount: "1500000",
      nonce: txCount,
      deadline: Math.floor(Date.now() / 1000) + 3600,
    },
  };

  return (
    <div className={`node-sim ${className}`} aria-label="Interactive Hardware Node Simulator">
      {/* Simulator Frame Header */}
      <div className="sim-header">
        <div className="sim-title-group">
          <span
            className={`pulse-beacon ${
              status === "frozen" ? "red" : status === "spending" ? "amber" : "green"
            }`}
          />
          <div>
            <div className="sim-title">Interactive Sandbox Node</div>
            <div className="sim-sub">Client-side testbench · offline sandbox</div>
          </div>
        </div>
        <div className="sim-badge">
          {status === "frozen" ? (
            <span style={{ color: "var(--bl)" }}>HALTED</span>
          ) : (
            <span style={{ color: "#ffffff" }}>
              {latency}ms · {activeChain.id}
            </span>
          )}
        </div>
      </div>

      {/* Spend Policy Gauge */}
      <div className="sim-card">
        <div className="sim-row">
          <span className="sim-label">Daily Spend Policy</span>
          <span className="sim-val font-mono">
            <b>${spentToday.toFixed(2)}</b> / ${dailyCap.toFixed(2)} {stablecoinSymbol}
          </span>
        </div>

        {/* Meter Bar */}
        <div
          className="meter-track"
          role="progressbar"
          aria-label="Daily spend used"
          aria-valuenow={spendPercentage}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`meter-fill ${status === "frozen" ? "frozen" : ""}`}
            style={{ width: `${spendPercentage}%` }}
          />
        </div>

        <div className="sim-meta">
          <span>Max Per-Tx: ${perTxCap.toFixed(2)}</span>
          <span>Used: {spendPercentage.toFixed(1)}%</span>
        </div>
      </div>

      {/* Hardware Telemetry Keys */}
      <div className="sim-telemetry">
        <div className="tel-item">
          <span className="tel-k">Account</span>
          <span className="tel-v">CREATE2 Account (Demo)</span>
        </div>
        <div className="tel-item">
          <span className="tel-k">Session Key</span>
          <span className="tel-v">Ephemeral Session Key</span>
        </div>
        <div className="tel-item">
          <span className="tel-k">Gas Rail</span>
          <span className="tel-v" style={{ color: "#ffffff" }}>
            0.000 {nativeSymbol} (Sponsored)
          </span>
        </div>
        <div className="tel-item">
          <span className="tel-k">Last Settled</span>
          <span className="tel-v">{lastTxLabel}</span>
        </div>
      </div>

      {/* Feedback Alert Notice */}
      {notice && (
        <div className={`sim-notice ${status === "frozen" ? "error" : "success"}`} role="alert">
          {notice}
        </div>
      )}

      {/* Interactive Trigger Controls */}
      <div className="sim-actions">
        <button
          type="button"
          onClick={handleSimulatePayment}
          disabled={status === "frozen" || spentToday >= dailyCap}
          className="btn-sim primary"
        >
          <span>⚡ Simulate Pay ($1.50)</span>
        </button>

        <button
          type="button"
          onClick={handleToggleKillSwitch}
          className={`btn-sim ${status === "frozen" ? "resume" : "kill"}`}
        >
          <span>{status === "frozen" ? "Unfreeze Fleet" : "Trigger Kill Switch"}</span>
        </button>
      </div>

      {/* Secondary Bar: Inspect & Reset */}
      <div className="sim-footer">
        <button type="button" onClick={() => setShowPayload(!showPayload)} className="sim-link-btn">
          {showPayload ? "▼ Hide EIP-712 Payload" : "▶ Inspect EIP-712 Signature"}
        </button>
        <button type="button" onClick={handleReset} className="sim-link-btn muted">
          Reset Demo
        </button>
      </div>

      {/* EIP-712 Drawer Code Viewer */}
      {showPayload && (
        <div className="sim-payload">
          <div className="payload-head">
            <span>EIP-712 Hardware Session Payload (Robinhood Chain {activeChain.id})</span>
          </div>
          <pre className="payload-code font-mono" tabIndex={0} aria-label="Sample EIP-712 payload">
            {JSON.stringify(eip712Sample, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
