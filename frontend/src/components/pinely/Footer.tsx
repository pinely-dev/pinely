import Link from "next/link";
import Image from "next/image";
import { activeChain, stablecoinSymbol, chainProfile, blockTimeLabel } from "@/lib/chain";
import { X_URL } from "@/lib/site";
import { robinhoodTestnet, robinhoodMainnet } from "@pinely/shared/chains";

export function Footer() {
  // The explorer comes from the chain definition (shared/chains), never from a URL typed here.
  const explorerUrl = activeChain.blockExplorers?.default.url;

  return (
    <footer className="sf">
      <div>
        <Link href="/" className="logo" aria-label="PINELY Home">
          <Image
            src="/brand/pinely-logo-transparent.png"
            alt=""
            width={32}
            height={32}
            style={{ width: "32px", height: "32px", objectFit: "contain" }}
          />
          <span>PINELY</span>
        </Link>
        <p className="note" style={{ marginTop: "14px", maxWidth: "280px", lineHeight: "1.5" }}>
          DePIN infrastructure for Robinhood Chain. Session keys, a kill switch and sponsored gas.
          Settled in {stablecoinSymbol}.
        </p>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "8px",
            marginTop: "16px",
            padding: "4px 8px",
            borderRadius: "4px",
            background: "rgba(255, 255, 255, 0.03)",
            border: "1px solid rgba(255, 255, 255, 0.08)",
            fontSize: "12px",
            fontFamily: "var(--font-sans)",
            color: "var(--mut-light)",
          }}
        >
          <span className="pulse-beacon green" style={{ width: 6, height: 6 }} />
          <span>
            {chainProfile.shortName} · {blockTimeLabel}
          </span>
        </div>
      </div>

      <div>
        <p className="sf-title">Developers</p>
        <Link href="/docs">Documentation</Link>
        {explorerUrl && (
          <a href={explorerUrl} target="_blank" rel="noopener noreferrer">
            Explorer ({activeChain.id}) ↗
          </a>
        )}
      </div>

      <div>
        <p className="sf-title">Company</p>
        <Link href="/pilot">Apply for Pilot</Link>
        <Link href="/legal">Legal & Disclaimers</Link>
        <a href={X_URL} target="_blank" rel="noopener noreferrer">
          X
        </a>
      </div>

      <div className="sf-b">
        <span>PINELY · Money for Physical AI · © 2026</span>
        <span>
          Testnet: {robinhoodTestnet.id} · Mainnet: {robinhoodMainnet.id} · Verify official domain
          before connecting.
        </span>
      </div>
    </footer>
  );
}
