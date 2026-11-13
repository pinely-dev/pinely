"use client";

import { TextScramble } from "./TextScramble";
import { ScrollReveal } from "./ScrollReveal";
import { TiltCard } from "./TiltCard";
import { stablecoinSymbol, nativeSymbol } from "@/lib/chain";

export function ProblemContrast() {
  return (
    <section className="sec chapter problem-contrast-sec" id="problem">
      <ScrollReveal direction="rack">
        <div className="sh sh-center">
          <span className="tag">
            <TextScramble text="THE CORE TENSION" />
          </span>
          <h2>Machines earn money. They can&apos;t hold it safely.</h2>
          <p>
            Robots, drones, and chargers are starting to get paid for real work. But a private key
            inside a machine on a public curb is one theft away from an empty treasury. Agents live
            in the cloud. Machines live on the street. They need a different kind of wallet.
          </p>
        </div>
      </ScrollReveal>

      <div className="problem-grid">
        {/* Card Left: The Street Hazard (Legacy / Raw Private Key) */}
        <ScrollReveal delay={80} direction="rack" className="grid-reveal-item">
          <TiltCard style={{ height: "100%" }}>
            <div className="threat-card legacy-hazard" style={{ height: "100%" }}>
              <div className="threat-header">
                <div className="threat-badge">
                  <span className="hazard-indicator" aria-hidden="true" />
                  <span>Threat: street hazard</span>
                </div>
                <span className="threat-status">HIGH LIABILITY</span>
              </div>

              <div className="threat-body">
                <h3 className="threat-title">The Unbounded Machine Dilemma</h3>
                <p className="threat-desc">
                  Standard crypto wallets assume human custody behind biometrics or password
                  managers. Autonomous delivery rovers, drone couriers, and public EV chargers have
                  no human driver.
                </p>

                <ul className="threat-list">
                  <li className="threat-item danger">
                    <span className="threat-icon">✕</span>
                    <div>
                      <strong>Raw Key Extraction:</strong> Physical access to micro-controller flash
                      yields unrestricted wallet drainage.
                    </div>
                  </li>
                  <li className="threat-item danger">
                    <span className="threat-icon">✕</span>
                    <div>
                      <strong>Zero Spend Guardrails:</strong> An exploited machine can sign away its
                      entire balance in a single malicious transaction.
                    </div>
                  </li>
                  <li className="threat-item danger">
                    <span className="threat-icon">✕</span>
                    <div>
                      <strong>Gas Starvation Halts:</strong> Fluctuating native gas prices strand
                      fleets mid-route when gas balances hit zero.
                    </div>
                  </li>
                </ul>
              </div>

              <div className="threat-footer">
                <span className="threat-tag">LEGACY MODEL</span>
                <span className="threat-alert">Drainable in 1 Transaction</span>
              </div>
            </div>
          </TiltCard>
        </ScrollReveal>

        {/* Card Right: The Silicon Shield (PINELY Enclave Architecture) */}
        <ScrollReveal delay={160} direction="rack" className="grid-reveal-item">
          <TiltCard style={{ height: "100%" }}>
            <div className="threat-card pinely-shield" style={{ height: "100%" }}>
              <div className="threat-header">
                <div className="threat-badge pinely">
                  <span className="shield-indicator" aria-hidden="true" />
                  <span>PINELY SAFEGUARD</span>
                </div>
                <span className="shield-status">FAIL-CLOSED SAFE</span>
              </div>

              <div className="threat-body">
                <h3 className="threat-title">Limits the machine cannot raise</h3>
                <p className="threat-desc">
                  PINELY divides the physical machine from financial custody. The machine holds only
                  a session key, while the contracts cap its daily spend onchain.
                </p>

                <ul className="threat-list">
                  <li className="threat-item safe">
                    <span className="threat-icon">✓</span>
                    <div>
                      <strong>Secure element (planned):</strong> the goal is a session key that
                      cannot be exported from the chip. Today the SDK key stores are software.
                    </div>
                  </li>
                  <li className="threat-item safe">
                    <span className="threat-icon">✓</span>
                    <div>
                      <strong>Hard Onchain Envelopes:</strong> Daily and per-transaction spending
                      limits are checked by the contracts. A spend over the limit reverts.
                    </div>
                  </li>
                  <li className="threat-item safe">
                    <span className="threat-icon">✓</span>
                    <div>
                      <strong>Zero-Custody Gas Rail:</strong> Machines hold 0 native {nativeSymbol}.
                      The paymaster sponsors gas and settles canonically in {stablecoinSymbol}.
                    </div>
                  </li>
                </ul>
              </div>

              <div className="threat-footer">
                <span className="shield-tag">PINELY PROTOCOL</span>
                <span className="shield-guarantee">Max Loss Capped to Daily Quota</span>
              </div>
            </div>
          </TiltCard>
        </ScrollReveal>
      </div>
    </section>
  );
}
