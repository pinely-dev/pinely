import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Documentation",
  description:
    "SDKs for TypeScript, Python and ROS2, the Facilitator payment flow and the contract address book.",
  path: "/docs",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
