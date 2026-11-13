import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";
import app from "../src/app";
import { issueAccessToken, verifyAccessToken } from "../src/lib/access-token";
import { createSignedSessionToken } from "../src/routes/auth";
import { installFixtureDeployment } from "./fixtures";

const OPERATOR_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
/** Prepare routes require an operator session in every environment. */
const sessionHeaders = () => ({
  Cookie: `pinely_session=${createSignedSessionToken(OPERATOR_ADDRESS, 3600)}`,
});

const KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const saved: Record<string, string | undefined> = {};
function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in saved)) saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
beforeAll(() => installFixtureDeployment());

async function siweLogin(domain: string, chainId: number) {
  const { nonce } = await (await app.request("/api/auth/nonce")).json();
  const account = privateKeyToAccount(KEY);
  const message =
    `${domain} wants you to sign in with your Ethereum account:\n` +
    `${account.address}\n\n` +
    `Sign in to PINELY.\n\n` +
    `URI: https://${domain}\n` +
    `Version: 1\n` +
    `Chain ID: ${chainId}\n` +
    `Nonce: ${nonce}\n` +
    `Issued At: ${new Date().toISOString()}`;
  const signature = await account.signMessage({ message });
  return app.request("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
}

describe("SIWE domain binding", () => {
  it("rejects a hosting-platform domain that anyone could register (phishing)", async () => {
    setEnv({ ALLOWED_AUTH_DOMAINS: "app.example", FRONTEND_URL: "https://app.example" });
    for (const domain of ["evil.vercel.app", "evil.up.railway.app"]) {
      const res = await siweLogin(domain, 46630);
      expect(res.status).toBe(401);
    }
  });

  it("accepts an explicitly configured domain", async () => {
    setEnv({ ALLOWED_AUTH_DOMAINS: "app.example", FRONTEND_URL: "https://app.example" });
    const res = await siweLogin("app.example", 46630);
    expect(res.status).toBe(200);
  });

  it("rejects a sign-in for another network", async () => {
    setEnv({ ALLOWED_AUTH_DOMAINS: "app.example" });
    const res = await siweLogin("app.example", 4663);
    expect(res.status).toBe(401);
  });

  it("rejects legacy domains that are no longer configured", async () => {
    setEnv({ ALLOWED_AUTH_DOMAINS: undefined, FRONTEND_URL: undefined });
    const res = await siweLogin("legacy.example.net", 46630);
    expect(res.status).toBe(401);
  });
});

describe("CORS with credentials", () => {
  it("does not reflect arbitrary or hosting-platform origins", async () => {
    setEnv({ FRONTEND_URL: "https://app.example" });
    for (const origin of ["https://evil.vercel.app", "https://evil.example", "null"]) {
      const res = await app.request("/health", { headers: { Origin: origin } });
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("allows the configured frontend origin", async () => {
    setEnv({ FRONTEND_URL: "https://app.example" });
    const res = await app.request("/health", { headers: { Origin: "https://app.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("https://app.example");
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
  });

  it("does not treat a wildcard FRONTEND_URL as permission", async () => {
    setEnv({ FRONTEND_URL: "*" });
    const res = await app.request("/health", { headers: { Origin: "https://evil.example" } });
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("Access tokens", () => {
  it("round-trips claims and rejects tampering", () => {
    const token = issueAccessToken({ machineId: "0xabc", resource: "r", settlementRef: "0xdef" });
    expect(verifyAccessToken(token)?.machineId).toBe("0xabc");

    const [prefix, payload, mac] = token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({
        machineId: "0xevil",
        resource: "r",
        settlementRef: "0xdef",
        exp: 9999999999,
      }),
    ).toString("base64url");
    expect(verifyAccessToken(`${prefix}.${forgedPayload}.${mac}`)).toBeNull();
    expect(verifyAccessToken(`${prefix}.${payload}.AAAA`)).toBeNull();
    expect(verifyAccessToken("tok_0123456789abcdef_1700000000000")).toBeNull();
  });

  it("expires", () => {
    const past = Date.now() - 10_000;
    const token = issueAccessToken(
      { machineId: "0xabc", resource: "r", settlementRef: "0xdef" },
      1,
      past,
    );
    expect(verifyAccessToken(token)).toBeNull();
  });
});

describe("Fail-closed configuration", () => {
  it("answers 503 CONTRACT_NOT_DEPLOYED instead of inventing an address", async () => {
    installFixtureDeployment();
    const book = (await import("@pinely/shared/contracts")).addresses as unknown as Record<
      string,
      Record<string, string>
    >;
    const registry = book["46630"].MachineRegistry;
    delete book["46630"].MachineRegistry;
    try {
      const res = await app.request("/api/actions/freeze/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sessionHeaders() },
        body: JSON.stringify({ machineId: `0x${"ab".repeat(32)}` }),
      });
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe("CONTRACT_NOT_DEPLOYED");
    } finally {
      book["46630"].MachineRegistry = registry;
    }
  });

  it("refuses to run on an unsupported chain id", async () => {
    setEnv({ CHAIN_ID: "12345" });
    const res = await app.request("/v1/capability");
    expect(res.status).toBe(500);
    setEnv({ CHAIN_ID: "46630" });
  });

  it("refuses the development session secret unless NODE_ENV is development or test", async () => {
    const { getSessionSecret } = await import("../src/routes/auth");
    setEnv({ NODE_ENV: undefined, SESSION_SECRET: undefined });
    expect(() => getSessionSecret()).toThrow("FATAL SECURITY");
    setEnv({ NODE_ENV: "test" });
    expect(getSessionSecret().startsWith("dev-insecure-")).toBe(true);
  });
});
