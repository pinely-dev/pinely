import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Contracts",
  description:
    "Every PINELY contract address on Robinhood Chain, with deploy transactions, owners and commands to verify them yourself.",
  path: "/contracts",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
