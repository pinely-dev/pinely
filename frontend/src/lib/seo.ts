import type { Metadata } from "next";
import { SITE_NAME, X_HANDLE } from "./site";

interface PageMetadataInput {
  /** Short page title. The root template appends " · PINELY". */
  title: string;
  description: string;
  /** Path of the page, for example `/docs`. Resolved against `metadataBase`. */
  path: string;
}

/**
 * Metadata for one route. Next.js replaces nested objects instead of merging them, so each page
 * states its own Open Graph, Twitter and canonical values here and none falls back to the home page.
 */
export function pageMetadata({ title, description, path }: PageMetadataInput): Metadata {
  const fullTitle = `${title} · ${SITE_NAME}`;
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      title: fullTitle,
      description,
      url: path,
    },
    twitter: {
      card: "summary_large_image",
      site: X_HANDLE,
      creator: X_HANDLE,
      title: fullTitle,
      description,
    },
  };
}
