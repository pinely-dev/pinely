import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "BurnVault",
  description: "Where BurnVault income comes from and how much $PINELY has been burned.",
  path: "/burn",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
