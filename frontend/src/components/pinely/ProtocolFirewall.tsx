"use client";

import { useState } from "react";

interface Gate {
  id: string;
  gateNumber: string;
  title: string;
  subtitle: string;
  targetContract: string;
  guardCheck: string;
  revertCondition: string;
  description: string;
  tags: string[];
}

const GATES: Gate[] = [
  {
    id: "gate-1",
    gateNumber: "Gate 1",
    title: "Machine Gate",
    subtitle: "Registry Check & EIP-712 Verification",
    targetContract: "MachineRegistry.sol + PinelyRouter.sol",
    guardCheck: "isRegistered(machineId) == true && recover(eip712Hash) == sessionKey",
    revertCondition: "Revert: UnauthorizedMachine(machineId) / InvalidSignature()",
    description:
      "Physical machines never sign with the operator key. Every action is signed with a session key and checked against the onchain registry. Moving that key into a hardware secure element is planned.",
    tags: ["EIP-712 Typed Data", "Session Key", "Replay Guard"],
  },
  {
    id: "gate-2",
    gateNumber: "Gate 2",
    title: "Spend Policy",
    subtitle: "Hard Daily & Per-Transaction Caps",
    targetContract: "PinelyHook.sol (Stage 2)",
    guardCheck: "amount <= maxPerSwap && (usedToday + amount) <= dailySpendCap",
    revertCondition: "Revert: SpendLimitExceeded(requested, availableQuota)",
    description:
      "Daily and per-transaction limits are enforced onchain by the hook once Stage 2 is deployed. Even if physical hardware is compromised or stolen on the street, the attacker cannot drain beyond the configured threshold.",
    tags: ["Timestamp-based Reset", "Strict Allowance", "Zero Custody Drift"],
  },
  {
    id: "gate-3",
    gateNumber: "Gate 3",
    title: "Kill Switch",
    subtitle: "Sub-Second Fleet-Wide Emergency Freeze",
    targetContract: "MachineRegistry.sol + PinelyAccount.sol",
    guardCheck: "isFrozen(machineId) == false && fleetFrozen[operator] == false",
    revertCondition: "Revert: MachineFrozen(machineId)",
    description:
      "Evaluated at the very start of every UserOp and Uniswap v4 swap hook. A fleet operator or designated Guardian multisig can freeze an individual machine or an entire 10,000-unit fleet in a single onchain transaction.",
    tags: ["1-Tx Execution", "Guardian Multisig", "Fail-Closed Security"],
  },
  {
    id: "gate-4",
    gateNumber: "Gate 4",
    title: "Dynamic Reputation",
    subtitle: "Volume Fee Cooling & Protocol Burn",
    targetContract: "PinelyHook.sol + BurnVault.sol",
    guardCheck: "tier = getMachineTier(machineId); fee = tierFee[tier] + protocolFee",
    revertCondition: "Revert: InvalidReputationProof()",
    description:
      "Machines build onchain credit history. Fees dynamically cool as uptime and compliance grow: Bronze (0.30%), Silver (0.15%), and Gold (0.05%). A fixed 0.05% protocol fee flows to BurnVault for automated token burning.",
    tags: ["Bronze 0.30%", "Silver 0.15%", "Gold 0.05%", "Auto BurnVault"],
  },
];

export function ProtocolFirewall() {
  const [activeGateIndex, setActiveGateIndex] = useState<number>(0);
  const [simulating, setSimulating] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<"idle" | "pass" | "blocked">("idle");

  const activeGate = GATES[activeGateIndex];

  const runFirewallCheck = () => {
    setSimulating(true);
    setTestResult("idle");

    setTimeout(() => {
      setSimulating(false);
      setTestResult("pass");
    }, 850);
  };

  return (
    <div className="firewall-container" id="protocol" data-spy>
      {/* Top Banner / Telemetry Status */}
      <div className="firewall-top">
        <div className="fw-badge">
          <span>PINELY ONCHAIN FIREWALL · 4 ACTIVE GUARDS</span>
        </div>
        <div className="fw-target font-mono">
          <span>Target: PinelyHook (Uniswap v4)</span>
        </div>
      </div>

      {/* Main Firewall Grid */}
      <div className="firewall-grid">
        {/* Left Column: Gate Selector Cards */}
        <div className="firewall-nav" role="tablist" aria-label="Firewall Enforcement Gates">
          {GATES.map((gate, index) => {
            const isActive = activeGateIndex === index;
            return (
              <button
                key={gate.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => {
                  setActiveGateIndex(index);
                  setTestResult("idle");
                }}
                className={`fw-gate-card ${isActive ? "active" : ""}`}
              >
                <div className="fw-gate-head">
                  <span className="text-xs tracking-wider text-zinc-400">{gate.gateNumber}</span>
                  <span className="fw-status-pill">PASS</span>
                </div>
                <h3 className="fw-gate-title">{gate.title}</h3>
                <p className="fw-gate-sub">{gate.subtitle}</p>
              </button>
            );
          })}
        </div>

        {/* Right Column: Active Gate Deep-Dive Inspector */}
        <div className="firewall-inspector">
          <div className="inspector-head">
            <div>
              <span className="text-xs tracking-widest uppercase text-crimson-400">
                {activeGate.gateNumber} · SPECIFICATION
              </span>
              <h2 className="inspector-title">{activeGate.title}</h2>
            </div>
            <span className="inspector-contract font-mono">{activeGate.targetContract}</span>
          </div>

          <p className="inspector-desc">{activeGate.description}</p>

          {/* Verification Code Box */}
          <div className="inspector-code-block font-mono">
            <div className="code-label">// Onchain Guard Evaluation</div>
            <div className="code-line check">{activeGate.guardCheck}</div>
            <div className="code-line revert">{activeGate.revertCondition}</div>
          </div>

          {/* Tags */}
          <div className="inspector-tags">
            {activeGate.tags.map((tag) => (
              <span key={tag} className="tag-pill">
                {tag}
              </span>
            ))}
          </div>

          {/* Interactive Simulation Footer */}
          <div className="inspector-sim-box">
            <div className="sim-box-info">
              <span className="text-xs text-zinc-300">
                Simulate Intent Pipeline (Hardware $\rightarrow$ Hook)
              </span>
              <div className="text-sm text-zinc-400">
                {testResult === "pass" ? (
                  <span style={{ color: "#ffffff" }}>
                    ✓ All 4 Guards Passed · Transaction Dispatched (112ms)
                  </span>
                ) : testResult === "blocked" ? (
                  <span style={{ color: "var(--bl)" }}>✕ Reverted by Onchain Firewall</span>
                ) : (
                  <span>Ready to verify hardware payload</span>
                )}
              </div>
            </div>

            <button
              type="button"
              onClick={runFirewallCheck}
              disabled={simulating}
              className="btn red sm"
              style={{ width: "auto", minHeight: "44px", padding: "10px 20px" }}
            >
              {simulating ? "Evaluating EVM..." : "Test Firewall Pipeline"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
