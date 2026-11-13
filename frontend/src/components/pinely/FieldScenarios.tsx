"use client";

import Link from "next/link";
import { TextScramble } from "./TextScramble";
import { ScrollReveal } from "./ScrollReveal";
import { TiltCard } from "./TiltCard";
import { activeChain, stablecoinSymbol, nativeSymbol } from "@/lib/chain";

interface Scenario {
  colSpan: string;
  tag: string;
  timestamp: string;
  title: string;
  description: string;
  telemetry: { label: string; value: string; isDanger?: boolean }[];
  highlight?: boolean;
}

const SCENARIOS: Scenario[] = [
  {
    colSpan: "bento-span-7",
    tag: "UNATTENDED COMMERCE",
    timestamp: "02:14 AM UTC",
    title: "The delivery rover that pays for its own charging",
    description: `A commercial delivery robot reaches 12% battery mid-route. It docks at a third-party automated inductive station, requests charging via HTTP 402 UserOp, and settles $0.80 ${stablecoinSymbol} autonomously. No human operator, no credit card, and zero native gas friction.`,
    telemetry: [
      { label: "Battery Level", value: "12% → 88% Fast Inductive" },
      { label: "Settlement", value: `$0.80 ${stablecoinSymbol} · Sponsored ${nativeSymbol} Gas` },
    ],
  },
  {
    colSpan: "bento-span-5",
    tag: "REVENUE SWEEPER",
    timestamp: "AUTONOMOUS CASHFLOW",
    title: "The charger that runs as a sovereign business",
    description: `A public solar charging station collects micropayments in ${stablecoinSymbol} directly into its PinelyAccount. It retains $20.00 operational reserve for grid maintenance and automatically sweeps surplus yield to the operator's Safe multisig every 24 hours.`,
    telemetry: [
      { label: "Operating Reserve", value: `$20.00 ${stablecoinSymbol} Maintained` },
      { label: "Surplus Sweep", value: "Automated Daily Safe Transfer" },
    ],
  },
  {
    colSpan: "bento-span-12",
    tag: "ANTI-THEFT PROTOCOL",
    timestamp: "FAIL-CLOSED DEFENSE · STAGE 2",
    title: "The stolen drone that cannot be drained",
    description:
      "A rogue actor physically captures an aerial courier drone and extracts memory flash. When attempting to drain the smart account treasury, the transaction reverts onchain because the $50 daily limit is enforced by PinelyHook.sol (Stage 2). The fleet manager fires the 1-Tx Kill Switch, bricking the machine's session key permanently.",
    telemetry: [
      { label: "Exploit Result", value: "Revert: Daily Cap Exceeded ($50.00 Max)", isDanger: true },
      { label: "Fleet State", value: "Session Key Revoked via 1-Tx Kill Switch" },
    ],
    highlight: true,
  },
];

export function FieldScenarios() {
  return (
    <section className="sec chapter scenarios-sec" id="scenarios">
      <ScrollReveal direction="rack">
        <div className="sh">
          <span className="tag">
            <TextScramble text="FIELD SCENARIOS" />
          </span>
          <h2>Autonomous hardware. Real money. Hard limits.</h2>
          <p>
            Machine wallets with session keys and a kill switch, and onchain spend limits from Stage
            2. From midnight delivery rovers settling micro-services to self-sustaining solar
            charging stations.
          </p>
        </div>
      </ScrollReveal>

      <div className="bento-grid">
        {SCENARIOS.map((sc, idx) => (
          <ScrollReveal
            key={idx}
            delay={idx * 120}
            direction="rack"
            className={`bento-card-wrapper ${sc.colSpan}`}
          >
            <TiltCard style={{ height: "100%" }}>
              <div className={`bento-card ${sc.highlight ? "hl" : ""}`} style={{ height: "100%" }}>
                <div className="bento-content">
                  <div className="bento-tag">
                    <span className="bento-category">{sc.tag}</span>
                    <span className="tag-separator">·</span>
                    <span className="bento-time">
                      <TextScramble text={sc.timestamp} scrambleSpeed={20} revealSpeed={35} />
                    </span>
                  </div>
                  <h3 className="bento-h3">{sc.title}</h3>
                  <p className="bento-p">{sc.description}</p>
                </div>

                <div className="bento-telemetry">
                  {sc.telemetry.map((t, tIdx) => (
                    <span key={tIdx} className={`bento-chip ${t.isDanger ? "danger-chip" : ""}`}>
                      {t.isDanger && <span className="pulse-beacon red" />}
                      {!t.isDanger && <span className="pulse-beacon green" />}
                      <span>
                        {t.label}: {t.value}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            </TiltCard>
          </ScrollReveal>
        ))}
      </div>

      <ScrollReveal delay={200} direction="fade">
        <div className="scenarios-footer-note">
          <span className="micro-square" aria-hidden="true" />
          <span>
            Illustrative operational models. Live Stage 1 pilot fleets are onboarding on{" "}
            {activeChain.name} ({activeChain.id}).
          </span>
          <Link href="/pilot" className="footer-pilot-link">
            Onboard Your Fleet →
          </Link>
        </div>
      </ScrollReveal>
    </section>
  );
}
