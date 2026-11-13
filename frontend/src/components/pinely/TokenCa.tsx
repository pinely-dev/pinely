"use client";

import { useState } from "react";
import { resolvePinelyTokenCa } from "@pinely/shared/contracts";
import { activeChain } from "@/lib/chain";
import { shortHex } from "@/lib/machine-view";

/**
 * The official $PINELY contract address, read from the single source of truth
 * (`shared/contracts/external.ts`, key `PINELY`). Until the token launches the key is absent and this
 * says so plainly; it never shows a placeholder address. A malformed address fails the build.
 */
const tokenCa = resolvePinelyTokenCa(activeChain.id);

interface TokenCaProps {
  /** `hero` is centered under the call to action; `footer` sits in the brand column. */
  variant?: "hero" | "footer";
}

export function TokenCa({ variant = "hero" }: TokenCaProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  if (tokenCa.status === "tba") {
    return (
      <div className={`token-ca token-ca-${variant} token-ca-tba`} role="note">
        <span className="token-ca-symbol">$PINELY</span>
        <span className="token-ca-sep" aria-hidden="true" />
        <span className="token-ca-value">CA: TBA</span>
        <span className="token-ca-note">Not launched yet. Beware of fake tokens.</span>
      </div>
    );
  }

  const { address } = tokenCa;
  const explorer = activeChain.blockExplorers?.default.url;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setState("copied");
    } catch {
      // Clipboard access denied (no HTTPS, or the browser refused): say so; the full address is
      // still in the title and behind the explorer link.
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2200);
  };

  const label =
    state === "copied"
      ? "Contract address copied"
      : state === "failed"
        ? "Could not copy. Use the explorer link."
        : "Copy the PINELY contract address";

  return (
    <div className={`token-ca token-ca-${variant}`}>
      <span className="token-ca-symbol">$PINELY</span>
      <span className="token-ca-sep" aria-hidden="true" />
      <button
        type="button"
        className="token-ca-value token-ca-copy font-mono"
        onClick={copy}
        title={address}
        aria-label={label}
      >
        <span className="token-ca-label">CA</span> {shortHex(address, 6, 4)}
      </button>
      <button
        type="button"
        className="token-ca-action"
        onClick={copy}
        aria-label={label}
        aria-live="polite"
      >
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
      </button>
      {explorer && (
        <a
          className="token-ca-action"
          href={`${explorer}/address/${address}`}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View the PINELY token on the block explorer"
        >
          Explorer ↗
        </a>
      )}
    </div>
  );
}
