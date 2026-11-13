"use client";

import { useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { activeChain } from "@/lib/chain";
import { useWallet } from "@/providers/WalletContext";

interface WalletButtonProps {
  /** Stretches the button to the width of its container (mobile drawer). */
  fullWidth?: boolean;
}

/**
 * Header wallet control.
 *
 * "Wrong network" means the wallet is not on the network this build talks to (`activeChain`). That
 * is stricter than RainbowKit's `chain.unsupported`, which only flags chains missing from the wagmi
 * config: the config lists both Robinhood networks, so a testnet wallet on a mainnet build would
 * otherwise look fine. The fix is one tap that asks the wallet to switch to `activeChain`. It does not
 * use RainbowKit's chain modal, which stays disabled until the SIWE session exists and would list
 * the wrong network as well.
 */
export function WalletButton({ fullWidth = false }: WalletButtonProps) {
  const { switchToTargetChain, targetChain } = useWallet();
  const [switching, setSwitching] = useState(false);

  const handleSwitch = async () => {
    if (switching) return;
    setSwitching(true);
    try {
      await switchToTargetChain();
    } finally {
      setSwitching(false);
    }
  };

  const sizing = {
    padding: "10px 18px",
    minHeight: "44px",
    ...(fullWidth ? { width: "100%" } : {}),
  } as const;

  return (
    <ConnectButton.Custom>
      {({ account, chain, openAccountModal, openConnectModal, mounted }) => {
        const connected = mounted && account && chain;

        return (
          <div
            aria-hidden={mounted ? undefined : true}
            style={{
              ...(fullWidth ? { width: "100%" } : {}),
              ...(mounted ? {} : { opacity: 0, pointerEvents: "none", userSelect: "none" }),
            }}
          >
            {(() => {
              if (!connected) {
                return (
                  <button
                    onClick={openConnectModal}
                    type="button"
                    className="btn dark"
                    style={{ ...sizing, fontSize: "13px" }}
                  >
                    Connect Wallet
                  </button>
                );
              }

              if (chain.unsupported || chain.id !== activeChain.id) {
                return (
                  <button
                    onClick={handleSwitch}
                    disabled={switching}
                    type="button"
                    className="btn red font-mono"
                    title={`Switch your wallet to ${targetChain.name}`}
                    aria-label={`Wrong network. Switch your wallet to ${targetChain.name}`}
                    style={{
                      ...sizing,
                      fontSize: "12px",
                      fontWeight: 700,
                      letterSpacing: "0.04em",
                    }}
                  >
                    {switching ? "SWITCHING…" : "WRONG NETWORK"}
                  </button>
                );
              }

              return (
                <button
                  onClick={openAccountModal}
                  type="button"
                  className="btn dark font-mono"
                  style={{ ...sizing, fontSize: "13px", fontWeight: 600 }}
                >
                  {account.displayName}
                </button>
              );
            })()}
          </div>
        );
      }}
    </ConnectButton.Custom>
  );
}
