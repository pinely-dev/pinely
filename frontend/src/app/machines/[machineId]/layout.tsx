import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pageMetadata } from "@/lib/seo";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ machineId: string }>;
}): Promise<Metadata> {
  const { machineId } = await params;
  return pageMetadata({
    title: "Machine detail",
    description: "Spend policy, status and recent settlements of one registered machine.",
    path: `/machines/${encodeURIComponent(machineId)}`,
  });
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
