"use client";

import { QueryClient, QueryClientProvider, isServer } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState, useEffect } from "react";
import { WagmiProvider, type State, useAccount } from "wagmi";
import {
  RainbowKitProvider,
  RainbowKitAuthenticationProvider,
  createAuthenticationAdapter,
  type AuthenticationStatus,
} from "@rainbow-me/rainbowkit";
import { wagmiConfig } from "@/lib/wagmi";
import { getPinelyTheme } from "@/lib/rainbowTheme";
import { WalletProvider } from "./WalletContext";
import {
  fetchSiweNonce,
  verifySiwe,
  logoutAuth,
  fetchAuthMe,
  clearStoredSessionToken,
} from "@/lib/api";
import { shouldRetryRequest } from "@/lib/http";

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: true,
        // Retry transient failures only; a definitive 4xx or an unavailable indexer is not retried.
        retry: shouldRetryRequest,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined = undefined;

function getQueryClient() {
  if (isServer) {
    return makeQueryClient();
  } else {
    if (!browserQueryClient) browserQueryClient = makeQueryClient();
    return browserQueryClient;
  }
}

function RainbowKitInner({ children }: { children: ReactNode }) {
  const { address, isConnected } = useAccount();
  const [authStatus, setAuthStatus] = useState<AuthenticationStatus>("loading");

  useEffect(() => {
    if (!isConnected || !address) {
      setAuthStatus("unauthenticated");
      return;
    }

    let isMounted = true;
    fetchAuthMe().then((res) => {
      if (isMounted) {
        if (res.authenticated && res.address?.toLowerCase() === address.toLowerCase()) {
          setAuthStatus("authenticated");
        } else {
          clearStoredSessionToken();
          setAuthStatus("unauthenticated");
        }
      }
    });

    return () => {
      isMounted = false;
    };
  }, [isConnected, address]);

  const authAdapter = useMemo(
    () =>
      createAuthenticationAdapter({
        getNonce: async () => {
          return await fetchSiweNonce();
        },
        createMessage: ({ nonce, address: msgAddress, chainId }) => {
          const domain = typeof window !== "undefined" ? window.location.host : "localhost:3000";
          const uri =
            typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
          const issuedAt = new Date().toISOString();
          return (
            `${domain} wants you to sign in with your Ethereum account:\n` +
            `${msgAddress}\n\n` +
            `Sign in to PINELY Operator Desk.\n\n` +
            `URI: ${uri}\n` +
            `Version: 1\n` +
            `Chain ID: ${chainId}\n` +
            `Nonce: ${nonce}\n` +
            `Issued At: ${issuedAt}`
          );
        },
        verify: async ({ message, signature }) => {
          try {
            await verifySiwe(message, signature);
            setAuthStatus("authenticated");
            return true;
          } catch (err) {
            console.error("RainbowKit SIWE verification failed:", err);
            return false;
          }
        },
        signOut: async () => {
          try {
            if (typeof window !== "undefined") {
              localStorage.setItem("pinely_disconnected", "1");
            }
          } catch {
            // ignore
          }
          await logoutAuth();
          clearStoredSessionToken();
          setAuthStatus("unauthenticated");
        },
      }),
    [],
  );

  return (
    <RainbowKitAuthenticationProvider adapter={authAdapter} status={authStatus}>
      <RainbowKitProvider locale="en-US" theme={getPinelyTheme()} modalSize="compact">
        <WalletProvider externalAuthStatus={authStatus} setExternalAuthStatus={setAuthStatus}>
          {children}
        </WalletProvider>
      </RainbowKitProvider>
    </RainbowKitAuthenticationProvider>
  );
}

export function Web3Provider({
  children,
  initialState,
}: {
  children: ReactNode;
  initialState?: State;
}) {
  const queryClient = getQueryClient();

  return (
    <WagmiProvider config={wagmiConfig} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitInner>{children}</RainbowKitInner>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
