import { nativeSymbol, stablecoinSymbol } from "@/lib/chain";

export function MetricLedgerStrip() {
  return (
    <section className="metric-ledger-strip" aria-label="Key Protocol Metrics">
      <div className="ledger-grid">
        <div className="ledger-cell">
          <small className="ledger-label">{nativeSymbol} held by a machine</small>
          <strong className="ledger-value">0</strong>
          <span className="ledger-sub">Gas sponsored by the Paymaster</span>
        </div>

        <div className="ledger-cell">
          <small className="ledger-label">Transactions to freeze a fleet</small>
          <strong className="ledger-value">1</strong>
          <span className="ledger-sub">Single-Tx Kill Switch</span>
        </div>

        <div className="ledger-cell">
          <small className="ledger-label">Registration fee</small>
          <strong className="ledger-value">2 {stablecoinSymbol}</strong>
          <span className="ledger-sub">Permanent Onchain Passport</span>
        </div>

        <div className="ledger-cell">
          <small className="ledger-label">Gas paid by the machine</small>
          <strong className="ledger-value">0</strong>
        </div>
      </div>
    </section>
  );
}
