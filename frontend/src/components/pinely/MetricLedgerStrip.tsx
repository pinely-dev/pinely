"use client";

import { StatCounter } from "./StatCounter";
import { nativeSymbol, chainProfile } from "@/lib/chain";

export function MetricLedgerStrip() {
  return (
    <section className="metric-ledger-strip" aria-label="Key Protocol Metrics">
      <div className="ledger-grid">
        <div className="ledger-cell">
          <small className="ledger-label">{nativeSymbol} held by any machine</small>
          <strong className="ledger-value">
            <StatCounter value={0} />
          </strong>
          <span className="ledger-sub">Gas sponsored by the Paymaster</span>
        </div>

        <div className="ledger-cell">
          <small className="ledger-label">Tx to freeze fleet</small>
          <strong className="ledger-value">
            <StatCounter value={1} />
          </strong>
          <span className="ledger-sub">Single-Tx Kill Switch</span>
        </div>

        <div className="ledger-cell">
          <small className="ledger-label">Hardware registration</small>
          <strong className="ledger-value">
            $<StatCounter value={2} />
          </strong>
          <span className="ledger-sub">Permanent Onchain Passport</span>
        </div>

        <div className="ledger-cell">
          <small className="ledger-label">Block time</small>
          <strong className="ledger-value">
            {chainProfile.blockTimeMs}
            <span style={{ fontSize: "16px", fontWeight: 400 }}>ms</span>
          </strong>
          <span className="ledger-sub">Sub-second blocks</span>
        </div>
      </div>
    </section>
  );
}
