import { createHmac, timingSafeEqual } from "node:crypto";

export interface AccessTokenClaims {
  machineId: string;
  resource: string;
  /** Settlement reference: the confirmed transaction hash, or the UserOperation hash. */
  settlementRef: string;
  /** Unix expiry in seconds. */
  exp: number;
}

function signingSecret(): string {
  const secret = process.env.FACILITATOR_TOKEN_SECRET ?? process.env.SESSION_SECRET;
  const env = process.env.NODE_ENV;
  if (secret && secret.length >= 32) return secret;
  if (env === "test" || env === "development") {
    return "dev-insecure-pinely-access-token-secret-not-for-production";
  }
  throw new Error(
    "FATAL SECURITY: FACILITATOR_TOKEN_SECRET (or SESSION_SECRET) must be a random key of at least 32 characters.",
  );
}

/**
 * Issues an unforgeable, expiring access token bound to one machine, one resource and one settlement.
 * The previous token format was a predictable string derived from the transaction hash and clock.
 */
export function issueAccessToken(
  claims: Omit<AccessTokenClaims, "exp">,
  ttlSeconds = 900,
  nowMs = Date.now(),
): string {
  const payload = Buffer.from(
    JSON.stringify({ ...claims, exp: Math.floor(nowMs / 1000) + ttlSeconds }),
  ).toString("base64url");
  const mac = createHmac("sha256", signingSecret()).update(payload).digest("base64url");
  return `acc.${payload}.${mac}`;
}

/** Returns the claims of a valid, unexpired token, or `null`. */
export function verifyAccessToken(token: string, nowMs = Date.now()): AccessTokenClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "acc") return null;
  const [, payload, mac] = parts;

  const expected = createHmac("sha256", signingSecret()).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as AccessTokenClaims;
    if (typeof claims.exp !== "number" || claims.exp * 1000 < nowMs) return null;
    return claims;
  } catch {
    return null;
  }
}
