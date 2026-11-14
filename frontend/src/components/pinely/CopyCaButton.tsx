"use client";

import { useState } from "react";
import { tokenCa } from "@/lib/token";

/**
 * Header button that copies the full $PINELY contract address. The address comes from the single source
 * (`lib/token.ts`); the button renders nothing when no address is configured.
 */
export function CopyCaButton() {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  if (tokenCa.status !== "live") return null;
  const { address } = tokenCa;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setState("copied");
    } catch {
      // Clipboard access denied: the full address is in the footer and the Legal page.
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2200);
  };

  const label =
    state === "copied"
      ? "Contract address copied"
      : state === "failed"
        ? "Could not copy the contract address"
        : "Copy the $PINELY contract address";

  return (
    <button
      type="button"
      className="nav-icon-btn font-mono"
      onClick={copy}
      aria-label={label}
      title={address}
      style={{ fontSize: "12px", fontWeight: 700, cursor: "pointer" }}
    >
      {state === "copied" ? "✓" : "CA"}
    </button>
  );
}
