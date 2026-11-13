import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Pilot Program",
  description: "Apply as a founding fleet and see what the protocol costs.",
  path: "/pilot",
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
