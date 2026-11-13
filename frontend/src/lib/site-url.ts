/**
 * The public origin of the site, used for canonical links, Open Graph and the sitemap. Server only:
 * `VERCEL_PROJECT_PRODUCTION_URL` is not exposed to the browser.
 *
 * Order: `NEXT_PUBLIC_SITE_URL`, then Vercel's production URL, then localhost outside production.
 * A production build with neither fails instead of guessing, so a wrong domain can never ship quietly.
 */
function resolveSiteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;

  if (process.env.NODE_ENV !== "production") return "http://localhost:3000";

  throw new Error(
    "[PINELY] NEXT_PUBLIC_SITE_URL must be set for a production build (for example https://pinely-wine.vercel.app).",
  );
}

export const SITE_URL = resolveSiteUrl();
