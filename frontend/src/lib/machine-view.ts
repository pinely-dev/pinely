import { formatUnits } from "viem";
import { toStable } from "./api";

/** Reputation tiers as the contracts define them: 0 Bronze, 1 Silver, 2 Gold. */
export const TIERS = [
  { name: "Bronze", fee: "0.30%", css: "bronze" },
  { name: "Silver", fee: "0.15%", css: "silver" },
  { name: "Gold", fee: "0.05%", css: "gold" },
] as const;

export function tierOf(tier: number) {
  return TIERS[tier] ?? TIERS[0];
}

/** `0x1234…abcd` for long hex strings; short values pass through. */
export function shortHex(value: string | null | undefined, head = 6, tail = 4): string {
  if (!value) return "n/a";
  return value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
}

/** Formats a raw 6-decimal stablecoin amount as `$12.34`. */
export function formatStable(raw: unknown): string {
  return `$${toStable(raw).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Whole-number formatting for indexer aggregates that arrive as strings. */
export function formatCount(raw: unknown): string {
  const n = Number(raw);
  return Number.isFinite(n) ? n.toLocaleString("en-US") : "n/a";
}

/** Percentage of `used` against `cap` (both raw amounts), clamped to 0–100. */
export function percentOf(used: unknown, cap: unknown): number {
  const capN = Number(cap);
  if (!Number.isFinite(capN) || capN <= 0) return 0;
  return Math.min(100, Math.max(0, (Number(used ?? 0) / capN) * 100));
}

/** Formats a raw 18-decimal $PINELY amount (string from the indexer) for display. */
export function formatPinely(raw: unknown): string {
  try {
    const whole = String(raw ?? "0").split(".")[0] || "0";
    const value = Number(formatUnits(BigInt(whole), 18));
    return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} $PINELY`;
  } catch {
    return "n/a";
  }
}
