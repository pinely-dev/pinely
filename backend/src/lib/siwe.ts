import { randomBytes } from "node:crypto";
import { type Address, type Hex, verifyMessage } from "viem";
import { getBackendChainId } from "./config";

export interface SiweParsedMessage {
  domain: string;
  address: Address;
  statement?: string;
  uri: string;
  version: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
}

// In-memory nonce store with a 5-minute TTL
const nonceStore = new Map<string, { createdAt: number; expiresAt: number }>();

/**
 * Generates a random single-use cryptographic nonce.
 */
export function generateSiweNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(16);
  let nonce = "";
  for (let i = 0; i < 16; i++) {
    nonce += chars.charAt(bytes[i] % chars.length);
  }

  const now = Date.now();
  nonceStore.set(nonce, {
    createdAt: now,
    expiresAt: now + 5 * 60 * 1000, // 5 minutes
  });

  return nonce;
}

/**
 * Validates that a nonce is valid and not expired. If valid it is consumed immediately (single-use).
 */
export function consumeSiweNonce(nonce: string): boolean {
  const record = nonceStore.get(nonce);
  if (!record) return false;

  nonceStore.delete(nonce);
  return Date.now() <= record.expiresAt;
}

/**
 * Simple parser for the standard EIP-4361 SIWE format.
 */
export function parseSiweMessage(message: string): SiweParsedMessage | null {
  try {
    const lines = message.split("\n");
    if (lines.length < 5) return null;

    // Line 0: "domain wants you to sign in with your Ethereum account:"
    const domainMatch = lines[0].match(/^([^\s]+) wants you to sign in/);
    if (!domainMatch) return null;
    const domain = domainMatch[1];

    // Line 1: Address
    const address = lines[1].trim() as Address;
    if (!address.startsWith("0x") || address.length !== 42) return null;

    let statement: string | undefined;
    let uri = "";
    let version = "1";
    let chainId = 0;
    let nonce = "";
    let issuedAt = "";
    let expirationTime: string | undefined;

    for (let i = 2; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (line.startsWith("URI: ")) uri = line.replace("URI: ", "");
      else if (line.startsWith("Version: ")) version = line.replace("Version: ", "");
      else if (line.startsWith("Chain ID: ")) chainId = Number(line.replace("Chain ID: ", ""));
      else if (line.startsWith("Nonce: ")) nonce = line.replace("Nonce: ", "");
      else if (line.startsWith("Issued At: ")) issuedAt = line.replace("Issued At: ", "");
      else if (line.startsWith("Expiration Time: "))
        expirationTime = line.replace("Expiration Time: ", "");
      else if (!line.includes(": ") && !statement) statement = line;
    }

    if (!nonce || !issuedAt || !Number.isInteger(chainId) || chainId <= 0) return null;

    return {
      domain,
      address,
      statement,
      uri,
      version,
      chainId,
      nonce,
      issuedAt,
      expirationTime,
    };
  } catch {
    return null;
  }
}

/**
 * Verifies the SIWE message and the ECDSA signature from the operator's wallet.
 */
export async function verifySiweAuth(
  message: string,
  signature: Hex,
): Promise<{ valid: boolean; address?: Address; error?: string }> {
  const parsed = parseSiweMessage(message);
  if (!parsed) {
    return { valid: false, error: "Invalid SIWE message format" };
  }

  // Verifikasi nonce
  const nonceValid = consumeSiweNonce(parsed.nonce);
  if (!nonceValid) {
    return { valid: false, error: "Invalid or expired nonce" };
  }

  // Verify the expiration time if one is given
  if (parsed.expirationTime && new Date(parsed.expirationTime).getTime() < Date.now()) {
    return { valid: false, error: "SIWE message has expired" };
  }

  // The message must be for the network this backend serves.
  if (parsed.chainId !== getBackendChainId()) {
    return {
      valid: false,
      error: `SIWE Chain ID ${parsed.chainId} does not match the active network`,
    };
  }

  // Allowed domains
  const frontendDomains = process.env.FRONTEND_URL
    ? process.env.FRONTEND_URL.split(",")
        .map((u) => {
          try {
            return new URL(u.trim()).host.toLowerCase();
          } catch {
            return u
              .trim()
              .replace(/^https?:\/\//, "")
              .split("/")[0]
              .toLowerCase();
          }
        })
        .filter(Boolean)
    : [];

  const isProduction = process.env.NODE_ENV === "production";
  const allowedDomains = (process.env.ALLOWED_AUTH_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);

  const parsedHost = (parsed.domain.split(":")[0] || "").toLowerCase();
  const isLocalHost = parsedHost === "localhost" || parsedHost === "127.0.0.1";
  // Only explicitly configured domains (ALLOWED_AUTH_DOMAINS, FRONTEND_URL) may request a sign-in.
  // Hosting-platform wildcards (*.vercel.app, *.up.railway.app) are rejected on purpose: anyone can
  // register one, which would let a phishing page collect valid sign-in signatures.
  const domainAllowed =
    allowedDomains.includes(parsed.domain.toLowerCase()) ||
    allowedDomains.includes(parsedHost) ||
    frontendDomains.includes(parsedHost) ||
    frontendDomains.includes(parsed.domain.toLowerCase()) ||
    (!isProduction && isLocalHost);

  if (!domainAllowed) {
    return { valid: false, error: `Message domain '${parsed.domain}' is not allowed` };
  }

  // Verifikasi tandatangan kriptografis
  try {
    const isSignatureValid = await verifyMessage({
      address: parsed.address,
      message,
      signature,
    });

    if (!isSignatureValid) {
      return { valid: false, error: "Invalid ECDSA signature" };
    }

    return { valid: true, address: parsed.address };
  } catch (err) {
    return {
      valid: false,
      error: err instanceof Error ? err.message : "Failed to verify signature",
    };
  }
}
