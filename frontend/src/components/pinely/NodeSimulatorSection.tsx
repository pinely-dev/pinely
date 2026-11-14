"use client";

import Link from "next/link";
import { NodeSimulator } from "./NodeSimulator";
import { stablecoinSymbol, nativeSymbol } from "@/lib/chain";
import { StageBadge } from "@/components/pinely/StageBadge";
import { robinhoodTestnet, robinhoodMainnet } from "@pinely/shared/chains";

export function NodeSimulatorSection() {
  return (
    <section className="sec node-sandbox-sec" id="sandbox">
      <div className="sh">
        <span className="tag">
          <span>LIVE HARDWARE SANDBOX</span>
        </span>
        <div style={{ marginTop: "10px" }}>
          <StageBadge variant="stage2" />
        </div>
        <h2>Simulate an autonomous machine in real time.</h2>
        <p>
          In Stage 2, every physical AI unit will operate under onchain spend bounds. Trigger
          simulated micro-service settlements, observe sponsored gas execution on Robinhood Chain,
          or fire the emergency 1-Tx Kill Switch.
        </p>
      </div>

      <div className="sandbox-grid">
        <div className="sandbox-main">
          <NodeSimulator />
        </div>

        <aside className="sandbox-aside">
          <div className="card partners" style={{ padding: "24px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                paddingBottom: "12px",
                borderBottom: "1px solid var(--line)",
              }}
            >
              <span className="text-xs text-zinc-400 uppercase tracking-wider">
                Network profile: testnet and mainnet
              </span>
              <span className="pulse-beacon green" />
            </div>

            <div className="kv" style={{ margin: "14px 0 16px" }}>
              <div>
                Testnet Chain ID<b>{robinhoodTestnet.id}</b>
              </div>
              <div>
                Mainnet Chain ID<b>{robinhoodMainnet.id} (Stage 1)</b>
              </div>
              <div>
                Gas Rail<b>{nativeSymbol} (sponsored)</b>
              </div>
              <div>
                Settlement Rail<b>{stablecoinSymbol} (6 dec)</b>
              </div>

              <div>
                Account Standard<b>ERC-4337 EntryPoint v0.7</b>
              </div>
            </div>

            <p className="note" style={{ marginBottom: "16px" }}>
              Spend constraints will be enforced by PinelyHook.sol (Stage 2, not deployed).
            </p>

            <Link href="/docs" className="btn red sm">
              View Chain Config & Contract Book →
            </Link>
          </div>
        </aside>
      </div>
    </section>
  );
}
