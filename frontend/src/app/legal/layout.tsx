import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Legal",
  description: "Terms, privacy and disclaimers for PINELY.",
  path: "/legal",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
