import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Map",
  description:
    "Spatial telemetry and heartbeat monitoring for physical autonomous machines registered on Robinhood Chain.",
  path: "/map",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
