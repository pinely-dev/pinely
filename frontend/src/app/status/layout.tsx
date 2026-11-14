import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Status",
  description:
    "What is live and what is not: Stage 1 on mainnet, the token, the indexer, Stage 2, the audit and hardware keys.",
  path: "/status",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
