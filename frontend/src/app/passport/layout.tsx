import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Machine Passport",
  description: "Public identity, reputation and transaction history of a registered machine.",
  path: "/passport",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
