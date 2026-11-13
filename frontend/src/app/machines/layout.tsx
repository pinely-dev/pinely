import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Machines",
  description:
    "Public ledger of machines registered on Robinhood Chain: operators, spend policies and settlement totals.",
  path: "/machines",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
