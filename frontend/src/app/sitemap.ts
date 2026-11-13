import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site-url";

/** Content pages only. Machine detail pages depend on indexer data and are not listed. */
const PATHS = [
  "/",
  "/docs",
  "/pilot",
  "/machines",
  "/passport",
  "/map",
  "/stake",
  "/burn",
  "/legal",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PATHS.map((path) => ({ url: `${SITE_URL}${path === "/" ? "" : path}` }));
}
