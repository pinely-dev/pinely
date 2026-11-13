import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { decodeFunctionData, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  computeMachineId,
  DevKeyStore,
  getPinelyFacilitatorDomain,
  getUserOpHash,
  PAYMENT_402_TYPES,
  verifyPreparedSettlement,
  type PreparedSettlement,
} from "@pinely/sdk";
import { pinelyAccountAbi } from "@pinely/shared/contracts";
import app from "../src/app";
import { verifyAccessToken } from "../src/lib/access-token";
import { FIXTURE_ADDRESSES, installFixtureDeployment, startMockChain } from "./fixtures";

const SIGNER_KEY: Hex = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const OTHER_KEY: Hex = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const SIGNER: Address = privateKeyToAccount(SIGNER_KEY).address;
const MACHINE_ACCOUNT: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const MERCHANT: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const OTHER_MERCHANT: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const stablecoin: Address = "0x5555555555555555555555555555555555555555"; // external address book, testnet
const ENTRY_POINT: Address = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const MACHINE_ID = computeMachineId(MACHINE_ACCOUNT);
const AMOUNT = 100_000n;

let nonceCounter = BigInt(Date.now()) * 1000n;

async function signedRequest() {
  const nonce = ++nonceCounter;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
  const intent = {
    machineId: MACHINE_ID,
    resource: "https://facilitator.example/v1/charge/dock-001",
    amountStable: AMOUNT,
    nonce,
    deadline,
  };
  const signature = await new DevKeyStore(SIGNER_KEY).signTypedData({
    domain: getPinelyFacilitatorDomain(FIXTURE_ADDRESSES.MachineRegistry, 46630n),
    types: PAYMENT_402_TYPES,
    primaryType: "Payment402Intent",
    message: intent,
  });
  return {
    intent: {
      ...intent,
      amountStable: intent.amountStable.toString(),
      nonce: nonce.toString(),
      deadline: deadline.toString(),
    },
    signature,
    machineAccount: MACHINE_ACCOUNT,
    merchantAddress: MERCHANT,
  };
}

function post(path: string, body: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** What a machine does: check the prepared operation itself, then sign its hash with the session key. */
async function machineSigns(prepared: PreparedSettlement, key: Hex = SIGNER_KEY) {
  verifyPreparedSettlement(prepared, {
    sender: MACHINE_ACCOUNT,
    stablecoin: stablecoin,
    merchant: MERCHANT,
    grossAmount: AMOUNT,
    paymaster: FIXTURE_ADDRESSES.PinelyPaymaster,
    entryPoint: ENTRY_POINT,
    chainId: 46630,
  });
  return new DevKeyStore(key).signMessage({ raw: prepared.userOpHash });
}

const saved: Record<string, string | undefined> = {};
function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (!(key in saved)) saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeAll(() => installFixtureDeployment());
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Settlement: explicit simulation mode", () => {
  it("settles locally only when FACILITATOR_SIMULATION=true, and says so", async () => {
    setEnv({ FACILITATOR_SIMULATION: "true", FACILITATOR_FEE_RECIPIENT: undefined });
    const res = await post("/v1/settle", await signedRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("settled");
    expect(json.simulated).toBe(true);
    expect(json.onChain).toBe(false);
    expect(json.facilitatorFee).toBe("0");

    // A single transfer is wrapped in PinelyAccount.execute.
    const decoded = decodeFunctionData({ abi: pinelyAccountAbi, data: json.userOp.callData });
    expect(decoded.functionName).toBe("execute");
  });

  it("charges and transfers the facilitator fee in the same UserOperation when configured", async () => {
    setEnv({
      FACILITATOR_SIMULATION: "true",
      FACILITATOR_FEE_RECIPIENT: OTHER_MERCHANT,
      FACILITATOR_FEE_BPS: "10",
    });
    const json = await (await post("/v1/settle", await signedRequest())).json();
    expect(json.facilitatorFee).toBe("100"); // 0.10% of 100,000
    expect(json.netMerchantAmount).toBe("99900");
    const decoded = decodeFunctionData({ abi: pinelyAccountAbi, data: json.userOp.callData });
    expect(decoded.functionName).toBe("executeBatch");
  });

  it("rejects a settlement that has no machine account", async () => {
    setEnv({ FACILITATOR_SIMULATION: "true" });
    const body = await signedRequest();
    delete (body as Record<string, unknown>).machineAccount;
    const res = await post("/v1/settle", body);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("MACHINE_ACCOUNT_REQUIRED");
  });

  it("never simulates in production, even when the flag is set", async () => {
    // Build the signed request first: DevKeyStore itself refuses to run when NODE_ENV=production.
    const body = await signedRequest();
    setEnv({
      FACILITATOR_SIMULATION: "true",
      NODE_ENV: "production",
      BUNDLER_RPC_URL: undefined,
      FRONTEND_URL: "https://app.example",
    });
    const res = await post("/v1/settle", body);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("BUNDLER_UNAVAILABLE");
  });
});

describe("Settlement: prepare -> machine signs -> settle, against a mock chain and bundler", () => {
  const baseEnv = (url: string) => ({
    FACILITATOR_SIMULATION: undefined,
    RPC_URL: url,
    BUNDLER_RPC_URL: url,
    BUNDLER_RECEIPT_POLL_MS: "20",
    BUNDLER_RECEIPT_TIMEOUT_MS: "400",
    FACILITATOR_FEE_RECIPIENT: undefined,
  });

  async function prepare(request: Awaited<ReturnType<typeof signedRequest>>) {
    const res = await post("/v1/settle/prepare", request);
    return {
      res,
      prepared: res.ok ? ((await res.clone().json()) as PreparedSettlement) : undefined,
    };
  }

  it("fails closed without a bundler", async () => {
    setEnv({ FACILITATOR_SIMULATION: undefined, BUNDLER_RPC_URL: undefined, RPC_URL: undefined });
    const res = await post("/v1/settle", await signedRequest());
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("BUNDLER_UNAVAILABLE");
  });

  it("asks for the UserOperation signature instead of settling without it", async () => {
    const chain = startMockChain({ account: MACHINE_ACCOUNT, signer: SIGNER });
    try {
      setEnv(baseEnv(chain.url));
      const res = await post("/v1/settle", await signedRequest());
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("USEROP_SIGNATURE_REQUIRED");
      expect(chain.calls.some((call) => call.method === "eth_sendUserOperation")).toBe(false);
    } finally {
      chain.stop();
    }
  });

  it("issues an access token only after the machine-signed UserOperation is confirmed on-chain", async () => {
    const chain = startMockChain({ account: MACHINE_ACCOUNT, signer: SIGNER, entryPointNonce: 7n });
    try {
      setEnv(baseEnv(chain.url));
      const request = await signedRequest();
      const { res, prepared } = await prepare(request);
      expect(res.status).toBe(200);
      expect(prepared!.userOp.nonce).toBe("0x7");
      expect(prepared!.userOp.signature).toBe("0x");

      const userOpSignature = await machineSigns(prepared!);
      const settleRes = await post("/v1/settle", {
        ...request,
        userOp: prepared!.userOp,
        userOpSignature,
      });
      expect(settleRes.status).toBe(200);
      const json = await settleRes.json();
      expect(json.status).toBe("settled");
      expect(json.onChain).toBe(true);
      expect(json.simulated).toBe(false);
      expect(json.txHash).toBe(chain.txHash);

      const claims = verifyAccessToken(json.accessToken);
      expect(claims?.machineId).toBe(MACHINE_ID);
      expect(claims?.settlementRef).toBe(chain.txHash);

      // eth_sendUserOperation gets [signedUserOp, entryPoint]; the bundler is never reached before this.
      const send = chain.calls.find((call) => call.method === "eth_sendUserOperation");
      const [userOp, entryPoint] = send!.params as [Record<string, string>, string];
      expect(entryPoint.toLowerCase()).toBe(ENTRY_POINT.toLowerCase());
      expect(userOp.signature).toBe(userOpSignature);
      expect(
        userOp.paymasterAndData.toLowerCase().startsWith(FIXTURE_ADDRESSES.PinelyPaymaster),
      ).toBe(true);
    } finally {
      chain.stop();
    }
  });

  it("prepares an operation whose hash a machine can recompute on its own", async () => {
    const chain = startMockChain({ account: MACHINE_ACCOUNT, signer: SIGNER });
    try {
      setEnv(baseEnv(chain.url));
      const { prepared } = await prepare(await signedRequest());
      const { deserializeUserOperation } = await import("@pinely/sdk");
      expect(prepared!.userOpHash).toBe(
        getUserOpHash(deserializeUserOperation(prepared!.userOp), ENTRY_POINT, 46630),
      );
    } finally {
      chain.stop();
    }
  });

  it("transfers the facilitator fee in the same UserOperation, which the machine can verify", async () => {
    const chain = startMockChain({ account: MACHINE_ACCOUNT, signer: SIGNER });
    try {
      setEnv({
        ...baseEnv(chain.url),
        FACILITATOR_FEE_RECIPIENT: OTHER_MERCHANT,
        FACILITATOR_FEE_BPS: "10",
      });
      const request = await signedRequest();
      const { prepared } = await prepare(request);
      expect(prepared!.facilitatorFee).toBe("100");
      expect(prepared!.feeRecipient).toBe(OTHER_MERCHANT);
      expect(
        decodeFunctionData({ abi: pinelyAccountAbi, data: prepared!.userOp.callData }).functionName,
      ).toBe("executeBatch");

      const userOpSignature = await machineSigns(prepared!);
      const res = await post("/v1/settle", {
        ...request,
        userOp: prepared!.userOp,
        userOpSignature,
      });
      expect(res.status).toBe(200);
    } finally {
      chain.stop();
    }
  });

  it("rejects a UserOperation that was altered after the machine signed it", async () => {
    const chain = startMockChain({ account: MACHINE_ACCOUNT, signer: SIGNER });
    try {
      setEnv(baseEnv(chain.url));
      const request = await signedRequest();
      const { prepared } = await prepare(request);
      const userOpSignature = await machineSigns(prepared!);

      // Swap the recipient inside the call data (the machine's signature no longer matches the call).
      const tampered = {
        ...prepared!.userOp,
        callData: prepared!.userOp.callData.replace(
          MERCHANT.slice(2).toLowerCase(),
          OTHER_MERCHANT.slice(2).toLowerCase(),
        ) as Hex,
      };
      expect(tampered.callData).not.toBe(prepared!.userOp.callData);

      const res = await post("/v1/settle", { ...request, userOp: tampered, userOpSignature });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("USEROP_MISMATCH");
      expect(chain.calls.some((call) => call.method === "eth_sendUserOperation")).toBe(false);
    } finally {
      chain.stop();
    }
  });

  it("rejects a malformed UserOperation", async () => {
    const chain = startMockChain({ account: MACHINE_ACCOUNT, signer: SIGNER });
    try {
      setEnv(baseEnv(chain.url));
      const request = await signedRequest();
      const res = await post("/v1/settle", {
        ...request,
        userOp: { sender: "nope" },
        userOpSignature: `0x${"11".repeat(65)}`,
      });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("USEROP_MISMATCH");
    } finally {
      chain.stop();
    }
  });

  it("asks to prepare again when the EntryPoint nonce moved in the meantime", async () => {
    const chain = startMockChain({ account: MACHINE_ACCOUNT, signer: SIGNER, entryPointNonce: 7n });
    try {
      setEnv(baseEnv(chain.url));
      const request = await signedRequest();
      const { prepared } = await prepare(request);
      const userOpSignature = await machineSigns(prepared!);

      chain.setNonce(8n); // another operation from the same account was included
      const res = await post("/v1/settle", {
        ...request,
        userOp: prepared!.userOp,
        userOpSignature,
      });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe("USEROP_MISMATCH");
    } finally {
      chain.stop();
    }
  });

  it("rejects a UserOperation signed by a key other than the registered session key", async () => {
    const chain = startMockChain({ account: MACHINE_ACCOUNT, signer: SIGNER });
    try {
      setEnv(baseEnv(chain.url));
      const request = await signedRequest();
      const { prepared } = await prepare(request);
      const userOpSignature = await machineSigns(prepared!, OTHER_KEY);

      const res = await post("/v1/settle", {
        ...request,
        userOp: prepared!.userOp,
        userOpSignature,
      });
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("USEROP_SIGNATURE_INVALID");
      expect(chain.calls.some((call) => call.method === "eth_sendUserOperation")).toBe(false);
    } finally {
      chain.stop();
    }
  });

  it("rejects a malformed UserOperation signature", async () => {
    const chain = startMockChain({ account: MACHINE_ACCOUNT, signer: SIGNER });
    try {
      setEnv(baseEnv(chain.url));
      const request = await signedRequest();
      const { prepared } = await prepare(request);
      const res = await post("/v1/settle", {
        ...request,
        userOp: prepared!.userOp,
        userOpSignature: "0x1234",
      });
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("USEROP_SIGNATURE_INVALID");
    } finally {
      chain.stop();
    }
  });

  it("returns 502 when the bundler answers with a different userOpHash", async () => {
    const chain = startMockChain({
      account: MACHINE_ACCOUNT,
      signer: SIGNER,
      returnHash: `0x${"aa".repeat(32)}`,
    });
    try {
      setEnv(baseEnv(chain.url));
      const request = await signedRequest();
      const { prepared } = await prepare(request);
      const userOpSignature = await machineSigns(prepared!);
      const res = await post("/v1/settle", {
        ...request,
        userOp: prepared!.userOp,
        userOpSignature,
      });
      expect(res.status).toBe(502);
      expect((await res.json()).accessToken).toBeUndefined();
    } finally {
      chain.stop();
    }
  });

  for (const [label, options, status, code] of [
    [
      "the bundler rejects the UserOperation",
      { sendUserOp: "reject" as const },
      502,
      "BUNDLER_ERROR",
    ],
    [
      "the UserOperation is included but reverts",
      { receipt: "reverted" as const },
      502,
      "BUNDLER_ERROR",
    ],
    ["no receipt arrives in time", { receipt: "never" as const }, 504, "BUNDLER_TIMEOUT"],
  ] as const) {
    it(`answers ${status} and issues no token when ${label}`, async () => {
      const chain = startMockChain({ account: MACHINE_ACCOUNT, signer: SIGNER, ...options });
      try {
        setEnv(baseEnv(chain.url));
        const request = await signedRequest();
        const { prepared } = await prepare(request);
        const userOpSignature = await machineSigns(prepared!);
        const res = await post("/v1/settle", {
          ...request,
          userOp: prepared!.userOp,
          userOpSignature,
        });
        expect(res.status).toBe(status);
        const json = await res.json();
        expect(json.code).toBe(code);
        expect(json.accessToken).toBeUndefined();
      } finally {
        chain.stop();
      }
    });
  }

  it("refuses to prepare for a signer that is not the registered machine signer", async () => {
    const chain = startMockChain({ account: MACHINE_ACCOUNT, signer: OTHER_MERCHANT });
    try {
      setEnv(baseEnv(chain.url));
      const { res } = await prepare(await signedRequest());
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("MACHINE_NOT_AUTHORIZED");
    } finally {
      chain.stop();
    }
  });

  it("refuses to prepare for a frozen machine", async () => {
    const chain = startMockChain({ account: MACHINE_ACCOUNT, signer: SIGNER, frozen: true });
    try {
      setEnv(baseEnv(chain.url));
      const { res } = await prepare(await signedRequest());
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("MACHINE_NOT_AUTHORIZED");
    } finally {
      chain.stop();
    }
  });

  it("refuses a machineId that does not belong to the machine account", async () => {
    const chain = startMockChain({ account: MACHINE_ACCOUNT, signer: SIGNER });
    try {
      setEnv(baseEnv(chain.url));
      const request = await signedRequest();
      request.machineAccount = MERCHANT; // wrong account for this machineId
      const { res } = await prepare(request);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("MACHINE_NOT_AUTHORIZED");
    } finally {
      chain.stop();
    }
  });

  it("does not prepare an intent that was already settled (replay)", async () => {
    const chain = startMockChain({ account: MACHINE_ACCOUNT, signer: SIGNER });
    try {
      setEnv(baseEnv(chain.url));
      const request = await signedRequest();
      const { prepared } = await prepare(request);
      const userOpSignature = await machineSigns(prepared!);
      const first = await post("/v1/settle", {
        ...request,
        userOp: prepared!.userOp,
        userOpSignature,
      });
      expect(first.status).toBe(200);

      const again = await prepare(request);
      expect(again.res.status).toBe(409);
      expect((await again.res.json()).code).toBe("NONCE_REPLAYED");
    } finally {
      chain.stop();
    }
  });
});
