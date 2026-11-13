import { getConnInfo } from "@hono/node-server/conninfo";
import type { Context } from "hono";

export interface RateLimiter {
  /** Returns true when the request is allowed, false when `key` is over its limit. */
  allow(key: string): boolean;
  reset(): void;
}

/**
 * Fixed-window, in-memory limiter. It protects a single backend instance; a deployment with several
 * instances needs a shared store instead.
 */
export function createRateLimiter(options: {
  windowMs: number;
  max: number;
  now?: () => number;
}): RateLimiter {
  const now = options.now ?? Date.now;
  const hits = new Map<string, { count: number; resetAt: number }>();

  return {
    allow(key) {
      const t = now();
      // Drop expired windows opportunistically so the map cannot grow without bound.
      if (hits.size > 10_000) {
        for (const [k, v] of hits) if (v.resetAt <= t) hits.delete(k);
      }
      const entry = hits.get(key);
      if (!entry || entry.resetAt <= t) {
        hits.set(key, { count: 1, resetAt: t + options.windowMs });
        return true;
      }
      entry.count += 1;
      return entry.count <= options.max;
    },
    reset() {
      hits.clear();
    },
  };
}

/**
 * Identifies the caller. `X-Forwarded-For` is trusted only when TRUST_PROXY=true (the backend is
 * behind a proxy that sets it); otherwise it is client-controlled and ignored.
 */
export function clientKey(c: Context): string {
  if (process.env.TRUST_PROXY === "true") {
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    if (forwarded) return forwarded;
  }
  try {
    return getConnInfo(c).remote.address ?? "unknown";
  } catch {
    return "unknown";
  }
}
