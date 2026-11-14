"use client";

import { activeChain } from "@/lib/chain";
import { useWallet } from "@/providers/WalletContext";

/**
 * Warns when the connected wallet is on a different network than this build. Renders nothing when no
 * wallet is connected or the networks match, so it never adds noise for visitors.
 */
export function WalletNetworkNotice() {
  const wallet = useWallet();

  if (!wallet.isConnected || !wallet.isWrongNetwork) return null;

  return (
    <div className="wallet-network-notice" role="status">
      <p>
        Your wallet is on another network. PINELY is running on {activeChain.name} ({activeChain.id}
        ). Switch networks before you sign anything.
      </p>
    </div>
  );
}
