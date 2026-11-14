import Link from "next/link";
import Image from "next/image";
import { isPublicChainId } from "@pinely/shared/chains";
import { activeChain, stablecoinSymbol, chainProfile } from "@/lib/chain";
import { X_URL } from "@/lib/site";
import { RISK_DISCLAIMER } from "@pinely/shared/status";
import { TokenCa } from "@/components/pinely/TokenCa";
import { NetworkBadge } from "@/components/pinely/StageBadge";
import { WalletNetworkNotice } from "@/components/pinely/WalletNetworkNotice";

export function Footer() {
  // The explorer comes from the chain definition (shared/chains), never from a URL typed here.
  const explorerUrl = activeChain.blockExplorers?.default.url;
  // "Robinhood Chain Mainnet (4663)" or "Robinhood Chain Testnet (46630)", from the chain profile.
  const networkName = isPublicChainId(activeChain.id)
    ? `${chainProfile.shortName} Mainnet`
    : chainProfile.shortName;

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
          <span>
            Network: {networkName} ({activeChain.id})
          </span>
        </div>
        <div style={{ marginTop: "8px" }}>
          <NetworkBadge />
        </div>
        <WalletNetworkNotice />
        <div>
          <TokenCa variant="footer" />
        </div>
      </div>

      <div>
        <p className="sf-title">Developers</p>
        <Link href="/docs">Documentation</Link>
        <Link href="/contracts">Contracts</Link>
        <Link href="/status">Status</Link>
        <Link href="/proofs">Proofs</Link>
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
          Network: {networkName} ({activeChain.id}) · Verify the official domain before connecting.
        </span>
      </div>

      <div className="sf-risk">
        <span>{RISK_DISCLAIMER}</span>
        <Link href="/legal">Read the risk disclosure →</Link>
      </div>
    </footer>
  );
}
