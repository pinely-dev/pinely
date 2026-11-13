import { http, cookieStorage, createStorage, createConfig } from "wagmi";
import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import type { Chain, Transport } from "viem";
import { isPublicChainId, supportedChains, type SupportedChainId } from "@pinely/shared/chains";
import {
  customMetaMaskWallet,
  customPhantomWallet,
  customRabbyWallet,
  customWalletConnectWallet,
} from "./customWallets";

const transports = Object.fromEntries(
  supportedChains.map((chain: Chain) => [chain.id, http()]),
) as Record<SupportedChainId, Transport>;

// WalletConnect Cloud Project ID.
// When the build targets mainnet, the project must use its own Project ID:
// the public demo fallback ID is not allowed because it gets rate-limited during the pilot.
// Dev/testnet may still use the fallback so local onboarding does not get stuck.
const explicitMainnetBuild = isPublicChainId(Number(process.env.NEXT_PUBLIC_CHAIN_ID || 0));
if (explicitMainnetBuild && !process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID) {
  throw new Error("[PINELY] NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is required for mainnet build.");
}
export const walletConnectProjectId =
  process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "044601f65212332475a09bc14ceb3c34";

const connectors = connectorsForWallets(
  [
    {
      groupName: "Popular",
      wallets: [
        customMetaMaskWallet,
        customPhantomWallet,
        customRabbyWallet,
        customWalletConnectWallet,
      ],
    },
  ],
  {
    appName: "PINELY",
    projectId: walletConnectProjectId,
  },
);

export const wagmiConfig = createConfig({
  connectors,
  chains: supportedChains,
  transports,
  ssr: true,
  storage: createStorage({
    storage: cookieStorage,
  }),
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

export { supportedChains };
