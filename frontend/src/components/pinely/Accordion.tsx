"use client";

import { useState } from "react";

interface RuleItem {
  id: string;
  num: string;
  title: string;
  description: string;
  tags: string[];
}

const RULES: RuleItem[] = [
  {
    id: "registered",
    num: "(01)",
    title: "Only registered\nmachines get in",
    description: "Every swap is signed on the machine's own chip and checked against the registry.",
    tags: ["Signature + nonce + deadline", "Replay-proof", "Router-only"],
  },
  {
    id: "limits",
    num: "(02)",
    title: "Limits the machine\ncan't break",
    description:
      "Per-transaction and daily caps set by the operator and enforced by the Stage 2 hook. Example: a delivery robot capped at $50 a day.",
    tags: ["Per-tx cap", "Daily cap", "Asset allowlist"],
  },
  {
    id: "killswitch",
    num: "(03)",
    title: "One tap\nstops everything",
    description:
      "The operator or a guardian freezes one machine or a whole fleet in a single transaction.",
    tags: ["Single transaction", "Read on every swap"],
  },
  {
    id: "reputation",
    num: "(04)",
    title: "Good machines\npay less",
    description: "Fees drop as reputation grows: Bronze 0.30%, Silver 0.15%, Gold 0.05%.",
    tags: ["Reputation tiers", "LP fee", "0.05% protocol fee"],
  },
];

export function RulesAccordion() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const toggle = (idx: number) => {
    setOpenIndex((prev) => (prev === idx ? null : idx));
  };

  return (
    <div className="svc-list">
      {RULES.map((rule, idx) => {
        const isOpen = openIndex === idx;
        return (
          <article key={rule.id} className={`svc ${isOpen ? "open" : ""}`}>
            <button type="button" onClick={() => toggle(idx)} aria-expanded={isOpen}>
              <h3 style={{ whiteSpace: "pre-line" }}>{rule.title}</h3>
              <span>{rule.num}</span>
            </button>
            <div className="svc-body">
              <div>
                <p>{rule.description}</p>
                <ul>
                  {rule.tags.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
