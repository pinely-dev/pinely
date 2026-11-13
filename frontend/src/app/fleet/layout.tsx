import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Fleet Control",
  description:
    "Operator desk to manage your machines: spend policy, kill switch, session keys, guardian and sweeper.",
  path: "/fleet",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
