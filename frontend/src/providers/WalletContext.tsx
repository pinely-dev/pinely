"use client";

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import type { Address } from "viem";
import { useAccount, useDisconnect, useSwitchChain, useChainId, useSignMessage } from "wagmi";
import {
  useConnectModal,
  useAccountModal,
  useChainModal,
  type AuthenticationStatus,
} from "@rainbow-me/rainbowkit";
import type { SupportedChain } from "@pinely/shared/chains";
import { activeChain } from "@/lib/chain";
import { describeWalletError } from "@pinely/shared/wallet-errors";
import { isApiError } from "@/lib/http";
import {
  fetchSiweNonce,
  verifySiwe,
  fetchAuthMe,
  logoutAuth,
  clearStoredSessionToken,
} from "@/lib/api";

interface WalletContextType {
  isConnected: boolean;
  address?: string;
  chainId?: number;
  isWrongNetwork: boolean;
  targetChainId: number;
  targetChain: SupportedChain;
  switchToTargetChain: () => Promise<void>;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  toggleWallet: () => Promise<void>;
  isConnecting: boolean;
  isAuthenticated: boolean;
  isAuthenticating: boolean;
  authError: string | null;
  /** A neutral note, for example "Sign-in cancelled.". Not an error. */
  authNotice: string | null;
  signInWithEthereum: (targetAddress?: string) => Promise<boolean>;
  openConnectModal?: () => void;
  openAccountModal?: () => void;
  openChainModal?: () => void;
}

const initialTargetChain = activeChain;

const WalletContext = createContext<WalletContextType>({
  isConnected: false,
  isWrongNetwork: false,
  targetChainId: initialTargetChain.id,
  targetChain: initialTargetChain,
  switchToTargetChain: async () => {},
  connectWallet: async () => {},
  disconnectWallet: async () => {},
  toggleWallet: async () => {},
  isConnecting: false,
  isAuthenticated: false,
  isAuthenticating: false,
  authError: null,
  authNotice: null,
  signInWithEthereum: async () => false,
});

interface WalletProviderProps {
  children: ReactNode;
  externalAuthStatus?: AuthenticationStatus;
  setExternalAuthStatus?: (status: AuthenticationStatus) => void;
}

export function WalletProvider({
  children,
  externalAuthStatus,
  setExternalAuthStatus,
}: WalletProviderProps) {
  const { address: wagmiAddress, isConnected: wagmiConnected, chain, isConnecting } = useAccount();
  const currentChainId = useChainId();
  const { switchChainAsync } = useSwitchChain();
  const { disconnectAsync: wagmiDisconnectAsync } = useDisconnect();
  const { signMessageAsync } = useSignMessage();

  // RainbowKit Modals Hooks
  const { openConnectModal } = useConnectModal();
  const { openAccountModal } = useAccountModal();
  const { openChainModal } = useChainModal();

  const [internalIsAuthenticated, setInternalIsAuthenticated] = useState<boolean>(false);
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);

  // Read after mount. The server render has no localStorage, so reading it during the first
  // render would make the client's HTML differ from the server's (a hydration mismatch).
  const [explicitlyDisconnected, setExplicitlyDisconnected] = useState<boolean>(false);
  useEffect(() => {
    try {
      if (localStorage.getItem("pinely_disconnected") === "1") setExplicitlyDisconnected(true);
    } catch {
      // Storage is unavailable (private window, blocked site data): treat as not disconnected.
    }
  }, []);

  const isAuthenticated = externalAuthStatus
    ? externalAuthStatus === "authenticated"
    : internalIsAuthenticated;

  const setAuthStatusState = useCallback(
    (status: boolean) => {
      setInternalIsAuthenticated(status);
      if (setExternalAuthStatus) {
        setExternalAuthStatus(status ? "authenticated" : "unauthenticated");
      }
    },
    [setExternalAuthStatus],
  );

  // If the user pressed disconnect earlier, make sure wagmi is disconnected too
  useEffect(() => {
    if (explicitlyDisconnected && wagmiConnected) {
      wagmiDisconnectAsync().catch(() => {});
      setAuthStatusState(false);
    }
  }, [explicitlyDisconnected, wagmiConnected, wagmiDisconnectAsync, setAuthStatusState]);

  const targetChain = activeChain;
  const targetChainId = targetChain.id;
  const isWrongNetwork =
    !explicitlyDisconnected &&
    wagmiConnected &&
    (chain?.id !== targetChainId || currentChainId !== targetChainId);

  const switchToTargetChain = useCallback(async () => {
    if (switchChainAsync) {
      setAuthError(null);
      setAuthNotice(null);
      try {
        await switchChainAsync({ chainId: targetChainId });
      } catch (err) {
        console.error("Failed to switch network to target chain:", err);
        const info = describeWalletError(err, {
          networkName: targetChain.name,
          action: "Network switch",
        });
        if (info.severity === "info") setAuthNotice(info.message);
        else setAuthError(info.message);
      }
    }
  }, [switchChainAsync, targetChainId, targetChain.name]);

  // Check the backend session when the browser wallet connects or switches account
  useEffect(() => {
    if (explicitlyDisconnected || !wagmiConnected || !wagmiAddress) {
      setAuthStatusState(false);
      return;
    }

    let isMounted = true;
    fetchAuthMe().then((res) => {
      if (isMounted) {
        if (res.authenticated && res.address?.toLowerCase() === wagmiAddress.toLowerCase()) {
          setAuthStatusState(true);
        } else {
          clearStoredSessionToken();
          setAuthStatusState(false);
        }
      }
    });

    return () => {
      isMounted = false;
    };
  }, [wagmiConnected, wagmiAddress, explicitlyDisconnected, setAuthStatusState]);

  // Sign-in with Ethereum (EIP-4361)
  const signInWithEthereum = useCallback(
    async (targetAddress?: string): Promise<boolean> => {
      const activeAddress = targetAddress || wagmiAddress;
      if (!activeAddress) {
        setAuthError("Please connect your browser wallet first.");
        return false;
      }

      try {
        setIsAuthenticating(true);
        setAuthError(null);
        setAuthNotice(null);

        // 1. Get a one-time nonce from the server
        const nonce = await fetchSiweNonce();

        // 2. Build the standard EIP-4361 message
        const domain = typeof window !== "undefined" ? window.location.host : "localhost:3000";
        const uri =
          typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
        const issuedAt = new Date().toISOString();
        const chainId = currentChainId || activeChain.id;
        const message =
          `${domain} wants you to sign in with your Ethereum account:\n` +
          `${activeAddress}\n\n` +
          `Sign in to PINELY Operator Desk.\n\n` +
          `URI: ${uri}\n` +
          `Version: 1\n` +
          `Chain ID: ${chainId}\n` +
          `Nonce: ${nonce}\n` +
          `Issued At: ${issuedAt}`;

        // 3. Ask the user's wallet to sign it
        const signature = await signMessageAsync({
          message,
          account: activeAddress as Address,
        });

        // 4. Send it to the backend for verification
        await verifySiwe(message, signature);

        setAuthStatusState(true);
        return true;
      } catch (err: unknown) {
        console.error("SIWE error:", err);
        // Backend messages are already written for people; anything else goes through the classifier
        // so a raw library message can never reach the screen.
        if (isApiError(err)) {
          setAuthError(err.message);
        } else {
          const info = describeWalletError(err, {
            networkName: targetChain.name,
            action: "Sign-in",
          });
          if (info.severity === "info") setAuthNotice(info.message);
          else setAuthError(info.message);
        }
        return false;
      } finally {
        setIsAuthenticating(false);
      }
    },
    [wagmiAddress, currentChainId, signMessageAsync, setAuthStatusState, targetChain.name],
  );

  // Connect through the RainbowKit modal
  const connectWallet = useCallback(async () => {
    setAuthError(null);
    setAuthNotice(null);
    try {
      try {
        localStorage.removeItem("pinely_disconnected");
      } catch {
        // ignore
      }
      setExplicitlyDisconnected(false);

      if (!wagmiConnected) {
        if (openConnectModal) {
          openConnectModal();
          return;
        }
      }

      // Already connected but not signed in
      if (wagmiAddress && !isAuthenticated) {
        await signInWithEthereum(wagmiAddress);
      }
    } catch (err: unknown) {
      console.error("Wallet connection error:", err);
      const info = describeWalletError(err, {
        networkName: targetChain.name,
        action: "Connection",
      });
      if (info.severity === "info") setAuthNotice(info.message);
      else setAuthError(info.message);
    }
  }, [
    wagmiConnected,
    wagmiAddress,
    openConnectModal,
    isAuthenticated,
    signInWithEthereum,
    targetChain.name,
  ]);

  const disconnectWallet = useCallback(async () => {
    try {
      localStorage.setItem("pinely_disconnected", "1");
    } catch {
      // ignore
    }
    setExplicitlyDisconnected(true);
    clearStoredSessionToken();
    await logoutAuth();
    setAuthStatusState(false);
    if (wagmiConnected) {
      try {
        await wagmiDisconnectAsync();
      } catch {
        // ignore
      }
    }
  }, [wagmiConnected, wagmiDisconnectAsync, setAuthStatusState]);

  const toggleWallet = useCallback(async () => {
    if (explicitlyDisconnected || !wagmiConnected) {
      try {
        localStorage.removeItem("pinely_disconnected");
      } catch {
        // ignore
      }
      setExplicitlyDisconnected(false);
      if (openConnectModal) {
        openConnectModal();
      } else {
        await connectWallet();
      }
      return;
    }
    if (isWrongNetwork) {
      // Ask the wallet to switch straight to the target network. RainbowKit's chain modal is disabled
      // until the SIWE session exists and would also offer the other Robinhood network.
      await switchToTargetChain();
      return;
    }
    if (!isAuthenticated) {
      await signInWithEthereum();
      return;
    }
    if (openAccountModal) {
      openAccountModal();
    } else {
      await disconnectWallet();
    }
  }, [
    explicitlyDisconnected,
    wagmiConnected,
    isWrongNetwork,
    isAuthenticated,
    openConnectModal,
    openAccountModal,
    connectWallet,
    switchToTargetChain,
    signInWithEthereum,
    disconnectWallet,
  ]);

  const isConnected = !explicitlyDisconnected && wagmiConnected;
  const address = explicitlyDisconnected ? undefined : wagmiAddress;

  return (
    <WalletContext.Provider
      value={{
        isConnected,
        address,
        chainId: currentChainId,
        isWrongNetwork,
        targetChainId,
        targetChain,
        switchToTargetChain,
        connectWallet,
        disconnectWallet,
        toggleWallet,
        isConnecting,
        isAuthenticated,
        isAuthenticating,
        authError,
        authNotice,
        signInWithEthereum,
        openConnectModal,
        openAccountModal,
        openChainModal,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  return useContext(WalletContext);
}
