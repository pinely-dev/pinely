import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { decodeFunctionData, erc20Abi, type Address, type Hex } from "viem";
import { addresses, pinelyStakeAbi } from "@pinely/shared/contracts";
import app from "../src/app";
import { createSignedSessionToken } from "../src/routes/auth";
import { FIXTURE_ADDRESSES, installFixtureDeployment, startMockChain } from "./fixtures";

/**
 * Staking routes: current position (read from the chain) and prepared stake / unstake / cancel /
 * withdraw transactions. The chain is a mock JSON-RPC server.
 */

const OPERATOR: Address = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const ACCOUNT: Address = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const SIGNER: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const TOKEN: Address = "0x9999999999999999999999999999999999999999";
const ONE = 10n ** 18n;
const GOLD_MIN = 10_000n * ONE;

const saved: Record<string, string | undefined> = {};
let chain: ReturnType<typeof startMockChain> | undefined;

function useChain(stake: NonNullable<Parameters<typeof startMockChain>[0]["stake"]> = {}) {
  chain = startMockChain({ account: ACCOUNT, signer: SIGNER, stake: { token: TOKEN, ...stake } });
  process.env.RPC_URL = chain.url;
}

const session = () => ({
  Cookie: `pinely_session=${createSignedSessionToken(OPERATOR, 3600)}`,
});

function post(path: string, body: unknown, headers: Record<string, string> = session()) {
  return app.request(`/api/stake${path}`, {
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

describe("GET /api/stake/:operator", () => {
  it("returns the position read from the chain as strings", async () => {
    useChain({
      staked: 12_000n * ONE,
      unbonding: 500n * ONE,
      unlockTime: 1_900_000_000n,
      balance: 7n * ONE,
      allowance: 3n * ONE,
    });
    const res = await app.request(`/api/stake/${OPERATOR}`);
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toMatchObject({
      operator: OPERATOR,
      stakeContract: FIXTURE_ADDRESSES.PinelyStake,
      token: TOKEN,
      staked: (12_000n * ONE).toString(),
      unbonding: (500n * ONE).toString(),
      unlockTime: "1900000000",
      hasMinStakeGold: true,
      minStakeGold: GOLD_MIN.toString(),
      unbondingPeriodSeconds: "604800",
      balance: (7n * ONE).toString(),
      allowance: (3n * ONE).toString(),
    });
  });

  it("reports no Gold below the threshold", async () => {
    useChain({ staked: GOLD_MIN - 1n });
    const { data } = await (await app.request(`/api/stake/${OPERATOR}`)).json();
    expect(data.hasMinStakeGold).toBe(false);
  });

  it("rejects an invalid operator address", async () => {
    useChain();
    expect((await app.request("/api/stake/not-an-address")).status).toBe(400);
  });

  it("answers 503 chain_unavailable instead of a zero stake when the RPC is down", async () => {
    process.env.RPC_URL = "http://127.0.0.1:1";
    const res = await app.request(`/api/stake/${OPERATOR}`);
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("chain_unavailable");
  });

  it("answers 503 when PinelyStake is not deployed", async () => {
    useChain();
    const book = addresses as unknown as Record<string, Record<string, string>>;
    const stakeAddress = book["46630"].PinelyStake;
    delete book["46630"].PinelyStake;
    try {
      const res = await app.request(`/api/stake/${OPERATOR}`);
      expect(res.status).toBe(503);
      expect((await res.json()).code).toBe("CONTRACT_NOT_DEPLOYED");
    } finally {
      book["46630"].PinelyStake = stakeAddress;
    }
  });
});

describe("POST /stake/prepare", () => {
  it("answers 401 without a session", async () => {
    useChain({ balance: ONE });
    expect((await post("/stake/prepare", { amount: "1" }, {})).status).toBe(401);
  });

  it("rejects amounts that are not a positive whole number", async () => {
    useChain({ balance: 100n * ONE });
    for (const body of [
      { amount: "0" },
      { amount: "-1" },
      { amount: "1.5" },
      { amount: "abc" },
      { amount: 5 },
      { amount: `1${"0".repeat(80)}` },
      {},
      "{not json",
    ]) {
      expect((await post("/stake/prepare", body)).status).toBe(400);
    }
  });

  it("refuses to stake more than the wallet holds", async () => {
    useChain({ balance: ONE });
    const res = await post("/stake/prepare", { amount: (2n * ONE).toString() });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("Insufficient");
  });

  it("adds an exact-amount approval first when the allowance is too low", async () => {
    useChain({ balance: 50n * ONE, allowance: 1n * ONE });
    const amount = 10n * ONE;
    const res = await post("/stake/prepare", { amount: amount.toString() });
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.to).toBe(FIXTURE_ADDRESSES.PinelyStake);
    const main = decodeFunctionData({ abi: pinelyStakeAbi, data: json.data });
    expect(main.functionName).toBe("stake");
    expect(main.args?.[0]).toBe(amount);

    expect(json.approvalStep.to).toBe(TOKEN);
    const approval = decodeFunctionData({ abi: erc20Abi, data: json.approvalStep.data as Hex });
    expect(approval.functionName).toBe("approve");
    expect((approval.args?.[0] as string).toLowerCase()).toBe(
      FIXTURE_ADDRESSES.PinelyStake.toLowerCase(),
    );
    // Exact amount, never an unlimited approval.
    expect(approval.args?.[1]).toBe(amount);
  });

  it("skips the approval when the allowance already covers the amount", async () => {
    useChain({ balance: 50n * ONE, allowance: 10n * ONE });
    const res = await post("/stake/prepare", { amount: (10n * ONE).toString() });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.approvalStep).toBeUndefined();
  });
});

describe("POST /unstake/prepare", () => {
  it("refuses to unstake more than the active stake", async () => {
    useChain({ staked: 5n * ONE });
    expect((await post("/unstake/prepare", { amount: (6n * ONE).toString() })).status).toBe(400);
  });

  it("prepares requestUnstake and warns that it can drop below Gold", async () => {
    useChain({ staked: GOLD_MIN });
    const res = await post("/unstake/prepare", { amount: ONE.toString() });
    expect(res.status).toBe(200);
    const json = await res.json();
    const call = decodeFunctionData({ abi: pinelyStakeAbi, data: json.data });
    expect(call.functionName).toBe("requestUnstake");
    expect(call.args?.[0]).toBe(ONE);
    expect(json.description).toContain("below");
    expect(json.description).toContain("restarts the timer");
  });

  it("does not warn about Gold when the stake stays above the threshold", async () => {
    useChain({ staked: 2n * GOLD_MIN });
    const json = await (await post("/unstake/prepare", { amount: ONE.toString() })).json();
    expect(json.description).not.toContain("needed for Gold");
  });
});

describe("POST /cancel-unstake/prepare", () => {
  it("refuses when nothing is unbonding", async () => {
    useChain({ unbonding: 0n });
    expect((await post("/cancel-unstake/prepare", {})).status).toBe(400);
  });

  it("prepares cancelUnstake", async () => {
    useChain({ unbonding: 3n * ONE, unlockTime: 4_000_000_000n });
    const res = await post("/cancel-unstake/prepare", {});
    expect(res.status).toBe(200);
    const call = decodeFunctionData({ abi: pinelyStakeAbi, data: (await res.json()).data });
    expect(call.functionName).toBe("cancelUnstake");
  });
});

describe("POST /withdraw/prepare", () => {
  it("refuses when nothing is unbonding", async () => {
    useChain({ unbonding: 0n });
    expect((await post("/withdraw/prepare", {})).status).toBe(400);
  });

  it("refuses before the unbonding period ends and says when it ends", async () => {
    const unlock = BigInt(Math.floor(Date.now() / 1000) + 3600);
    useChain({ unbonding: ONE, unlockTime: unlock });
    const res = await post("/withdraw/prepare", {});
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toContain("not ended");
    expect(json.unlocksAt).toBe(unlock.toString());
  });

  it("prepares withdrawUnstaked once the period has ended", async () => {
    useChain({ unbonding: ONE, unlockTime: 1_000n });
    const res = await post("/withdraw/prepare", {});
    expect(res.status).toBe(200);
    const call = decodeFunctionData({ abi: pinelyStakeAbi, data: (await res.json()).data });
    expect(call.functionName).toBe("withdrawUnstaked");
  });

  it("answers 401 without a session on every prepare route", async () => {
    useChain({ unbonding: ONE, unlockTime: 1_000n, balance: ONE, staked: ONE });
    for (const path of [
      "/stake/prepare",
      "/unstake/prepare",
      "/cancel-unstake/prepare",
      "/withdraw/prepare",
    ]) {
      expect((await post(path, { amount: "1" }, {})).status).toBe(401);
    }
  });
});
