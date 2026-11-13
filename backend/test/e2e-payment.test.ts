import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { decodeFunctionData, recoverMessageAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildSettlementUserOp,
  deserializeUserOperation,
  getUserOpHash,
  Pinely,
  serializeUserOperation,
  type PreparedSettlement,
} from "@pinely/sdk";
import { pinelyAccountAbi } from "@pinely/shared/contracts";
import app from "../src/app";
import { verifyAccessToken } from "../src/lib/access-token";
import { FIXTURE_ADDRESSES, installFixtureDeployment, startMockChain } from "./fixtures";

/**
 * End to end: the real SDK (machine side) talks to the real Hono app (facilitator side) over a fetch
 * that routes the facilitator URL into `app.request`. The chain and the bundler are a mock JSON-RPC
 * server. If the two halves disagree about the protocol, these tests fail.
 */

const FACILITATOR = "https://facilitator.example";
const SIGNER_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const SIGNER: Address = privateKeyToAccount(SIGNER_KEY).address;
const MACHINE_ACCOUNT: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const MERCHANT: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const OTHER: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const stablecoin: Address = "0x5555555555555555555555555555555555555555";
const ENTRY_POINT: Address = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const RESOURCE = `${FACILITATOR}/v1/charge/dock-001?amount=250000&payTo=${MERCHANT}`;

const realFetch = globalThis.fetch;
const saved: Record<string, string | undefined> = {};
function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in saved)) saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

/** Routes facilitator URLs into the app; everything else (the mock chain) goes over the network. */
function routeFacilitator(intercept?: (path: string, response: Response) => Promise<Response>) {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith(FACILITATOR)) return realFetch(input as string, init);
    const path = url.slice(FACILITATOR.length);
    const response = await app.request(path, init);
    return intercept ? intercept(path.split("?")[0], response) : response;
  }) as typeof fetch;
}

async function machine() {
  const pinely = await Pinely.connect({
    chain: "robinhoodTestnet",
    registryAddress: FIXTURE_ADDRESSES.MachineRegistry,
    paymasterAddress: FIXTURE_ADDRESSES.PinelyPaymaster,
    stablecoinAddress: stablecoin,
    keyStore: { type: "file-dev-only", privateKey: SIGNER_KEY },
  });
  return pinely.machines.create({ name: "e2e-bot", operator: OTHER, account: MACHINE_ACCOUNT });
}

beforeAll(() => installFixtureDeployment());
afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const chainEnv = (url: string) => ({
  FACILITATOR_SIMULATION: undefined,
  RPC_URL: url,
  BUNDLER_RPC_URL: url,
  BUNDLER_RECEIPT_POLL_MS: "20",
  BUNDLER_RECEIPT_TIMEOUT_MS: "400",
  FACILITATOR_FEE_RECIPIENT: undefined,
});

describe("End to end: SDK machine <-> facilitator <-> mock chain", () => {
  it("pays through challenge, prepare, machine signature and on-chain confirmation", async () => {
    const chain = startMockChain({ account: MACHINE_ACCOUNT, signer: SIGNER, entryPointNonce: 3n });
    try {
      setEnv(chainEnv(chain.url));
      routeFacilitator();

      const result = await (
        await machine()
      ).pay({
        url: RESOURCE,
        maxAmount: 300_000n,
        facilitatorUrl: FACILITATOR,
      });

      expect(result.status).toBe("settled");
      expect(result.amountStable).toBe(250_000n);
      expect(result.txHash).toBe(chain.txHash);
      expect(verifyAccessToken(result.accessToken!)?.settlementRef).toBe(chain.txHash);

      // What reached the bundler is exactly what the machine signed.
      const send = chain.calls.find((call) => call.method === "eth_sendUserOperation");
      const [rawOp, entryPoint] = send!.params as [
        Parameters<typeof deserializeUserOperation>[0],
        Address,
      ];
      expect(entryPoint.toLowerCase()).toBe(ENTRY_POINT.toLowerCase());
      const op = deserializeUserOperation(rawOp);
      expect(op.nonce).toBe(3n);
      expect(decodeFunctionData({ abi: pinelyAccountAbi, data: op.callData }).functionName).toBe(
        "execute",
      );

      const hash = getUserOpHash({ ...op, signature: "0x" }, ENTRY_POINT, 46630);
      const signer = await recoverMessageAddress({
        message: { raw: hash },
        signature: op.signature,
      });
      expect(signer.toLowerCase()).toBe(SIGNER.toLowerCase());
    } finally {
      chain.stop();
    }
  });

  it("pays the facilitator fee in the same operation, within the cap the machine accepts", async () => {
    const chain = startMockChain({ account: MACHINE_ACCOUNT, signer: SIGNER });
    try {
      setEnv({
        ...chainEnv(chain.url),
        FACILITATOR_FEE_RECIPIENT: OTHER,
        FACILITATOR_FEE_BPS: "10",
      });
      routeFacilitator();

      const result = await (
        await machine()
      ).pay({
        url: RESOURCE,
        maxAmount: 300_000n,
        facilitatorUrl: FACILITATOR,
      });
      expect(result.status).toBe("settled");

      const send = chain.calls.find((call) => call.method === "eth_sendUserOperation");
      const op = deserializeUserOperation(
        send!.params[0] as Parameters<typeof deserializeUserOperation>[0],
      );
      expect(decodeFunctionData({ abi: pinelyAccountAbi, data: op.callData }).functionName).toBe(
        "executeBatch",
      );
    } finally {
      chain.stop();
    }
  });

  it("refuses a facilitator that asks for a fee above the machine's cap", async () => {
    const chain = startMockChain({ account: MACHINE_ACCOUNT, signer: SIGNER });
    try {
      setEnv({
        ...chainEnv(chain.url),
        FACILITATOR_FEE_RECIPIENT: OTHER,
        FACILITATOR_FEE_BPS: "500",
      });
      routeFacilitator();

      const result = await (
        await machine()
      ).pay({
        url: RESOURCE,
        maxAmount: 300_000n,
        facilitatorUrl: FACILITATOR,
      });
      expect(result.status).toBe("failed");
      expect(result.error).toContain("Facilitator fee exceeds");
      expect(chain.calls.some((call) => call.method === "eth_sendUserOperation")).toBe(false);
    } finally {
      chain.stop();
    }
  });

  it("does not sign when a man in the middle rewrites the recipient in the prepared operation", async () => {
    const chain = startMockChain({ account: MACHINE_ACCOUNT, signer: SIGNER });
    try {
      setEnv(chainEnv(chain.url));
      // Rewrite the facilitator's prepare answer into a self-consistent operation that pays OTHER.
      routeFacilitator(async (path, response) => {
        if (path !== "/v1/settle/prepare" || !response.ok) return response;
        const honest = (await response.json()) as PreparedSettlement;
        const op = deserializeUserOperation(honest.userOp);
        const evil = buildSettlementUserOp({
          sender: op.sender,
          nonce: op.nonce,
          stablecoin: stablecoin,
          merchant: OTHER,
          amount: 250_000n,
          paymaster: FIXTURE_ADDRESSES.PinelyPaymaster,
        });
        return new Response(
          JSON.stringify({
            ...honest,
            userOp: serializeUserOperation(evil),
            userOpHash: getUserOpHash(evil, ENTRY_POINT, 46630),
          }),
          { status: 200 },
        );
      });

      const result = await (
        await machine()
      ).pay({
        url: RESOURCE,
        maxAmount: 300_000n,
        facilitatorUrl: FACILITATOR,
      });
      expect(result.status).toBe("failed");
      expect(result.error).toContain("Refused to sign the UserOperation");
      expect(chain.calls.some((call) => call.method === "eth_sendUserOperation")).toBe(false);
    } finally {
      chain.stop();
    }
  });

  it("reports failure, with no token, when the bundler never confirms", async () => {
    const chain = startMockChain({ account: MACHINE_ACCOUNT, signer: SIGNER, receipt: "never" });
    try {
      setEnv(chainEnv(chain.url));
      routeFacilitator();

      const result = await (
        await machine()
      ).pay({
        url: RESOURCE,
        maxAmount: 300_000n,
        facilitatorUrl: FACILITATOR,
      });
      expect(result.status).toBe("failed");
      expect(result.accessToken).toBeUndefined();
      expect(result.error).toContain("HTTP 504");
    } finally {
      chain.stop();
    }
  });

  it("is refused for a frozen machine", async () => {
    const chain = startMockChain({ account: MACHINE_ACCOUNT, signer: SIGNER, frozen: true });
    try {
      setEnv(chainEnv(chain.url));
      routeFacilitator();

      const result = await (
        await machine()
      ).pay({
        url: RESOURCE,
        maxAmount: 300_000n,
        facilitatorUrl: FACILITATOR,
      });
      expect(result.status).toBe("failed");
      expect(result.error).toContain("HTTP 403");
    } finally {
      chain.stop();
    }
  });
});
