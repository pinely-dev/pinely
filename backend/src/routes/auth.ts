import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import { createHmac } from "node:crypto";
import type { Hex } from "viem";
import { generateSiweNonce, verifySiweAuth } from "../lib/siwe";

const authRoute = new Hono();

export function getSessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  const env = process.env.NODE_ENV;
  const isLocalDev = env === "development" || env === "test";
  const isDevDefault = secret?.startsWith("dev-insecure-") ?? false;

  if (secret && secret.length >= 32 && !isDevDefault) return secret;

  // The development default is only available when NODE_ENV is explicitly "development" or "test".
  // An unset NODE_ENV must not silently fall back to a publicly known secret.
  if (isLocalDev) return "dev-insecure-pinely-session-secret-do-not-use-in-prod!";

  throw new Error(
    "FATAL SECURITY: SESSION_SECRET must be set to a strong random key of at least 32 characters. The development default is only available when NODE_ENV is 'development' or 'test'.",
  );
}

const SESSION_SECRET = getSessionSecret();

// Simple in-memory session cache: token -> { address, expiresAt }
const sessions = new Map<string, { address: string; expiresAt: number }>();

export function createSignedSessionToken(address: string, maxAgeSeconds: number): string {
  const expiresAt = Date.now() + maxAgeSeconds * 1000;
  const payload = Buffer.from(
    JSON.stringify({ address: address.toLowerCase(), expiresAt }),
  ).toString("base64url");
  const hmac = createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  return `sess.${payload}.${hmac}`;
}

export function verifySignedSessionToken(
  token: string,
): { address: string; expiresAt: number } | null {
  if (!token.startsWith("sess.")) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [, payload, signature] = parts;
  const expectedHmac = createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
  if (signature !== expectedHmac) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf-8"));
    if (Date.now() > data.expiresAt) return null;
    return { address: data.address, expiresAt: data.expiresAt };
  } catch {
    return null;
  }
}

export function getSessionUser(token?: string): string | null {
  if (!token) return null;
  const session = sessions.get(token);
  if (session) {
    if (Date.now() > session.expiresAt) {
      sessions.delete(token);
      return null;
    }
    return session.address;
  }

  // Verify the cryptographic HMAC token so the session survives a container restart
  const verified = verifySignedSessionToken(token);
  if (verified) {
    sessions.set(token, verified);
    return verified.address;
  }

  return null;
}

authRoute.get("/nonce", (c) => {
  const nonce = generateSiweNonce();
  return c.json({ nonce });
});

authRoute.post("/verify", async (c) => {
  const body = await c.req.json<{ message?: string; signature?: Hex }>();
  if (!body.message || !body.signature) {
    return c.json({ error: "message and signature parameters are required" }, 400);
  }

  const result = await verifySiweAuth(body.message, body.signature);
  if (!result.valid || !result.address) {
    return c.json({ error: result.error ?? "SIWE verification failed" }, 401);
  }

  // Create a secure HMAC session token that survives container restarts
  const maxAge = 12 * 60 * 60; // 12 hours
  const token = createSignedSessionToken(result.address, maxAge);

  sessions.set(token, {
    address: result.address.toLowerCase(),
    expiresAt: Date.now() + maxAge * 1000,
  });

  const isProd = process.env.NODE_ENV === "production";
  setCookie(c, "pinely_session", token, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "None" : "Lax",
    maxAge,
    path: "/",
  });

  return c.json({
    status: "ok",
    address: result.address,
    token,
    expiresIn: maxAge,
  });
});

authRoute.post("/logout", (c) => {
  const token =
    getCookie(c, "pinely_session") ?? c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  if (token) {
    sessions.delete(token);
    deleteCookie(c, "pinely_session", { path: "/" });
  }
  return c.json({ status: "logged_out" });
});

authRoute.get("/me", (c) => {
  const token =
    getCookie(c, "pinely_session") ?? c.req.header("Authorization")?.replace(/^Bearer\s+/i, "");
  const address = getSessionUser(token);

  if (!address) {
    return c.json({ authenticated: false }, 401);
  }

  return c.json({
    authenticated: true,
    address,
  });
});

export default authRoute;
