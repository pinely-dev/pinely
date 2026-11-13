"use client";

import { useState } from "react";
import Link from "next/link";
import { NodeSimulator } from "./NodeSimulator";
import { ProtocolFirewall } from "./ProtocolFirewall";
import { TextScramble } from "./TextScramble";
import { ScrollReveal } from "./ScrollReveal";
import { activeChain, stablecoinSymbol, nativeSymbol, blockTimeLabel } from "@/lib/chain";
import { robinhoodTestnet, robinhoodMainnet } from "@pinely/shared/chains";

type CockpitTab = "sandbox" | "firewall";

export function TacticalCommandCockpit() {
  const [activeTab, setActiveTab] = useState<CockpitTab>("sandbox");

  return (
    <section className="sec chapter cockpit-sec" id="cockpit">
      <ScrollReveal direction="up">
        <div className="sh-split sh-split-mirror">
          <div className="sh">
            <span className="tag">
              <TextScramble text="TACTICAL FLEET COMMAND" />
            </span>
            <h2>Simulate, audit & enforce onchain.</h2>
            <p>
              Observe the complete machine execution loop in real time. Simulate autonomous
              micro-settlements, observe sponsored gas routing, or test the 4-gate onchain firewall
              against exploit attempts.
            </p>
          </div>
          <ul className="sh-notes" aria-label="What the two modes show">
            <li>
              <b>Sandbox</b>
              <span>A simulated machine. Nothing is sent onchain.</span>
            </li>
            <li>
              <b>Firewall</b>
              <span>Step through the four gates a machine&apos;s swap has to pass.</span>
            </li>
          </ul>
        </div>
      </ScrollReveal>

      <ScrollReveal delay={100} direction="up">
        {/* Cockpit Control Bar */}
        <div className="cockpit-switcher-bar" role="tablist" aria-label="Cockpit Mode Switcher">
          <div className="switcher-tabs">
            <button
              role="tab"
              aria-selected={activeTab === "sandbox"}
              aria-controls="cockpit-sandbox-panel"
              id="tab-sandbox"
              className={`switcher-tab ${activeTab === "sandbox" ? "active" : ""}`}
              onClick={() => setActiveTab("sandbox")}
            >
              <span className="micro-square" aria-hidden="true" />
              <span>HARDWARE EXECUTION SANDBOX</span>
            </button>

            <button
              role="tab"
              aria-selected={activeTab === "firewall"}
              aria-controls="cockpit-firewall-panel"
              id="tab-firewall"
              className={`switcher-tab ${activeTab === "firewall" ? "active" : ""}`}
              onClick={() => setActiveTab("firewall")}
            >
              <span className="micro-square" aria-hidden="true" />
              <span>ONCHAIN PROTOCOL FIREWALL</span>
            </button>
          </div>

          <div className="switcher-telemetry">
            <span className="telemetry-item">
              <span className="pulse-beacon green" />
              <TextScramble
                text={`Target: Robinhood Chain ${activeChain.id}`}
                scrambleSpeed={25}
                revealSpeed={40}
              />
            </span>
            <span className="telemetry-item hide-on-mobile">
              <span>Latency: 118ms</span>
            </span>
          </div>
        </div>

        {/* Cockpit Content Viewport */}
        <div className="cockpit-viewport">
          {activeTab === "sandbox" && (
            <div
              id="cockpit-sandbox-panel"
              role="tabpanel"
              aria-labelledby="tab-sandbox"
              className="cockpit-panel-fade"
            >
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
                        Gas Sponsorship<b>Native {nativeSymbol} (sponsored)</b>
                      </div>
                      <div>
                        Settlement Currency<b>{stablecoinSymbol} (6 Decimals)</b>
                      </div>
                      <div>
                        Block Time<b>{blockTimeLabel}</b>
                      </div>
                      <div>
                        Account Standard<b>ERC-4337 v0.7</b>
                      </div>
                    </div>

                    <p className="note" style={{ marginBottom: "16px" }}>
                      Fail-closed spend constraints enforced by PinelyPaymaster.sol &
                      PinelyHook.sol.
                    </p>

                    <Link
                      href="/passport"
                      className="btn dark sm"
                      style={{ width: "100%", justifyContent: "center" }}
                    >
                      Inspect PNLY-0001 Passport →
                    </Link>
                  </div>
                </aside>
              </div>
            </div>
          )}

          {activeTab === "firewall" && (
            <div
              id="cockpit-firewall-panel"
              role="tabpanel"
              aria-labelledby="tab-firewall"
              className="cockpit-panel-fade"
            >
              <ProtocolFirewall />
            </div>
          )}
        </div>
      </ScrollReveal>
    </section>
  );
}
