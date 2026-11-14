import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "BurnVault",
  description:
    "Where BurnVault income is planned to come from. BurnVault is a Stage 2 contract and is not deployed, so no $PINELY has been burned.",
  path: "/burn",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
