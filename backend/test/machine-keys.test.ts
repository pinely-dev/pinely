import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { decodeFunctionData, zeroAddress, type Address, type Hex } from "viem";
import { machineRegistryAbi, pinelyAccountAbi } from "@pinely/shared/contracts";
import app from "../src/app";
import { createSignedSessionToken } from "../src/routes/auth";
import { FIXTURE_ADDRESSES, installFixtureDeployment, startMockChain } from "./fixtures";

/**
 * Prepare routes for machine keys and lifecycle: revoke / rotate the session key, deregister, set the
 * guardian, and read the asset allowlist. The chain is a mock JSON-RPC server.
 */

const OPERATOR: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const OTHER_OPERATOR: Address = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
const ACCOUNT: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const SIGNER: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const NEW_KEY: Address = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";
const GUARDIAN: Address = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
const ASSET: Address = "0x5555555555555555555555555555555555555555";
const MACHINE_ID: Hex = `0x${"ab".repeat(32)}`;
const SECONDS_PER_DAY = 86_400;

const saved: Record<string, string | undefined> = {};
let chain: ReturnType<typeof startMockChain> | undefined;

function useChain(options: Partial<Parameters<typeof startMockChain>[0]> = {}) {
  chain = startMockChain({
    account: ACCOUNT,
    signer: SIGNER,
    operator: OPERATOR,
    accountOwner: OPERATOR,
    ...options,
  });
  process.env.RPC_URL = chain.url;
}

const session = (address: Address = OPERATOR) => ({
  Cookie: `pinely_session=${createSignedSessionToken(address, 3600)}`,
});

function post(path: string, body: unknown, headers: Record<string, string> = session()) {
  return app.request(`/api/actions${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeAll(() => installFixtureDeployment());
beforeEach(() => {
  saved.RPC_URL = process.env.RPC_URL;
});
afterEach(() => {
  chain?.stop();
  chain = undefined;
  if (saved.RPC_URL === undefined) delete process.env.RPC_URL;
  else process.env.RPC_URL = saved.RPC_URL;
});

describe("POST /session-key/revoke/prepare", () => {
  it("answers 401 without a session", async () => {
    useChain();
    const res = await post("/session-key/revoke/prepare", { machineId: MACHINE_ID }, {});
    expect(res.status).toBe(401);
  });

  it("prepares revokeSessionKey on the machine account", async () => {
    useChain();
    const res = await post("/session-key/revoke/prepare", { machineId: MACHINE_ID });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.to).toBe(ACCOUNT);
    expect(json.chainId).toBe(46630);
    expect(decodeFunctionData({ abi: pinelyAccountAbi, data: json.data }).functionName).toBe(
      "revokeSessionKey",
    );
  });

  it("refuses a wallet that is not the registry operator", async () => {
    useChain();
    const res = await post(
      "/session-key/revoke/prepare",
      { machineId: MACHINE_ID },
      session(OTHER_OPERATOR),
    );
    expect(res.status).toBe(403);
  });

  it("refuses the registry operator when another address owns the machine account", async () => {
    useChain({ accountOwner: OTHER_OPERATOR });
    const res = await post("/session-key/revoke/prepare", { machineId: MACHINE_ID });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("machine account");
  });

  it("answers 404 for a machine the registry does not know", async () => {
    useChain({ machineMissing: true });
    const res = await post("/session-key/revoke/prepare", { machineId: MACHINE_ID });
    expect(res.status).toBe(404);
  });

  it("rejects a malformed machine id and a non-JSON body", async () => {
    useChain();
    expect((await post("/session-key/revoke/prepare", { machineId: "0x1234" })).status).toBe(400);
    expect((await post("/session-key/revoke/prepare", "{not json")).status).toBe(400);
  });

  it("answers 503 chain_unavailable when the RPC cannot be reached", async () => {
    process.env.RPC_URL = "http://127.0.0.1:1";
    const res = await post("/session-key/revoke/prepare", { machineId: MACHINE_ID });
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("chain_unavailable");
  });
});

describe("POST /session-key/rotate/prepare", () => {
  it("prepares the two-step rotation: account key first, registry signer second", async () => {
    useChain();
    const before = Math.floor(Date.now() / 1000);
    const res = await post("/session-key/rotate/prepare", {
      machineId: MACHINE_ID,
      newKey: NEW_KEY,
      validForDays: 7,
    });
    expect(res.status).toBe(200);
    const json = await res.json();

    // Main transaction: MachineRegistry.setSigner(machineId, newKey)
    expect(json.to).toBe(FIXTURE_ADDRESSES.MachineRegistry);
    const main = decodeFunctionData({ abi: machineRegistryAbi, data: json.data });
    expect(main.functionName).toBe("setSigner");
    expect(main.args?.[0]).toBe(MACHINE_ID);
    expect((main.args?.[1] as string).toLowerCase()).toBe(NEW_KEY.toLowerCase());

    // First step: PinelyAccount.setSessionKey(newKey, validUntil, 0)
    expect(json.approvalStep.to).toBe(ACCOUNT);
    const step = decodeFunctionData({ abi: pinelyAccountAbi, data: json.approvalStep.data });
    expect(step.functionName).toBe("setSessionKey");
    expect((step.args?.[0] as string).toLowerCase()).toBe(NEW_KEY.toLowerCase());
    const validUntil = Number(step.args?.[1]);
    expect(validUntil).toBeGreaterThanOrEqual(before + 7 * SECONDS_PER_DAY);
    expect(validUntil).toBeLessThanOrEqual(before + 7 * SECONDS_PER_DAY + 10);
    expect(Number(step.args?.[2])).toBe(0);
  });

  it("defaults the validity to the 30-day maximum", async () => {
    useChain();
    const before = Math.floor(Date.now() / 1000);
    const res = await post("/session-key/rotate/prepare", {
      machineId: MACHINE_ID,
      newKey: NEW_KEY,
    });
    const json = await res.json();
    const step = decodeFunctionData({ abi: pinelyAccountAbi, data: json.approvalStep.data });
    expect(Number(step.args?.[1])).toBeGreaterThanOrEqual(before + 30 * SECONDS_PER_DAY);
  });

  it("rejects a zero or invalid new key and an out-of-range validity", async () => {
    useChain();
    const bad = [
      { machineId: MACHINE_ID, newKey: zeroAddress },
      { machineId: MACHINE_ID, newKey: "0x123" },
      { machineId: MACHINE_ID },
      { machineId: MACHINE_ID, newKey: NEW_KEY, validForDays: 0 },
      { machineId: MACHINE_ID, newKey: NEW_KEY, validForDays: 31 },
      { machineId: MACHINE_ID, newKey: NEW_KEY, validForDays: 1.5 },
      { machineId: MACHINE_ID, newKey: NEW_KEY, validForDays: "7" },
    ];
    for (const body of bad) {
      expect((await post("/session-key/rotate/prepare", body)).status).toBe(400);
    }
  });

  it("refuses a wallet that is not the operator and needs a session", async () => {
    useChain();
    const body = { machineId: MACHINE_ID, newKey: NEW_KEY };
    expect((await post("/session-key/rotate/prepare", body, session(OTHER_OPERATOR))).status).toBe(
      403,
    );
    expect((await post("/session-key/rotate/prepare", body, {})).status).toBe(401);
  });
});

describe("POST /deregister/prepare", () => {
  it("prepares deregisterMachine for the operator", async () => {
    useChain();
    const res = await post("/deregister/prepare", { machineId: MACHINE_ID });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.to).toBe(FIXTURE_ADDRESSES.MachineRegistry);
    const call = decodeFunctionData({ abi: machineRegistryAbi, data: json.data });
    expect(call.functionName).toBe("deregisterMachine");
    expect(call.args?.[0]).toBe(MACHINE_ID);
    expect(json.description).toContain("cannot be restored");
  });

  it("refuses another operator, an unknown machine and a missing session", async () => {
    useChain();
    expect(
      (await post("/deregister/prepare", { machineId: MACHINE_ID }, session(OTHER_OPERATOR)))
        .status,
    ).toBe(403);
    expect((await post("/deregister/prepare", { machineId: MACHINE_ID }, {})).status).toBe(401);
    chain?.stop();
    useChain({ machineMissing: true });
    expect((await post("/deregister/prepare", { machineId: MACHINE_ID })).status).toBe(404);
  });
});

describe("POST /guardian/prepare", () => {
  it("prepares setGuardian with the new guardian", async () => {
    const res = await post("/guardian/prepare", { guardian: GUARDIAN });
    expect(res.status).toBe(200);
    const json = await res.json();
    const call = decodeFunctionData({ abi: machineRegistryAbi, data: json.data });
    expect(call.functionName).toBe("setGuardian");
    expect((call.args?.[0] as string).toLowerCase()).toBe(GUARDIAN.toLowerCase());
    expect(json.description).toContain("cannot unfreeze");
  });

  it("clears the guardian with null or an omitted field", async () => {
    for (const body of [{ guardian: null }, {}]) {
      const res = await post("/guardian/prepare", body);
      expect(res.status).toBe(200);
      const call = decodeFunctionData({
        abi: machineRegistryAbi,
        data: (await res.json()).data,
      });
      expect(call.args?.[0]).toBe(zeroAddress);
    }
  });

  it("rejects an invalid guardian and the operator itself", async () => {
    expect((await post("/guardian/prepare", { guardian: "0xnope" })).status).toBe(400);
    expect((await post("/guardian/prepare", { guardian: 5 })).status).toBe(400);
    expect((await post("/guardian/prepare", { guardian: OPERATOR })).status).toBe(400);
    expect((await post("/guardian/prepare", "{not json")).status).toBe(400);
  });

  it("answers 401 without a session", async () => {
    expect((await post("/guardian/prepare", { guardian: GUARDIAN }, {})).status).toBe(401);
  });
});

describe("GET /allowlist/status", () => {
  const get = (query: string) => app.request(`/api/actions/allowlist/status?${query}`);

  it("reports whether the asset is allowed", async () => {
    useChain({ assetAllowed: true });
    const yes = await get(`machineId=${MACHINE_ID}&asset=${ASSET}`);
    expect(yes.status).toBe(200);
    expect((await yes.json()).data.allowed).toBe(true);

    chain?.stop();
    useChain({ assetAllowed: false });
    const no = await get(`machineId=${MACHINE_ID}&asset=${ASSET}`);
    expect((await no.json()).data.allowed).toBe(false);
  });

  it("validates its query and answers 503 when the chain is unreachable", async () => {
    useChain();
    expect((await get(`machineId=0x12&asset=${ASSET}`)).status).toBe(400);
    expect((await get(`machineId=${MACHINE_ID}&asset=nope`)).status).toBe(400);
    process.env.RPC_URL = "http://127.0.0.1:1";
    const res = await get(`machineId=${MACHINE_ID}&asset=${ASSET}`);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("chain_unavailable");
  });
});
