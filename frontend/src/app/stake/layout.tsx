import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Staking",
  description:
    "Stake $PINELY to qualify machines for the Gold tier: threshold, unbonding period and slashing rules.",
  path: "/stake",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
