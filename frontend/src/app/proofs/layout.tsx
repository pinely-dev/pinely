import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Proofs",
  description:
    "The claims PINELY owes a transaction for, how to check each one, and where it stands.",
  path: "/proofs",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
