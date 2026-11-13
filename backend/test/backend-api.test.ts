import { afterEach, beforeAll, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { privateKeyToAccount } from "viem/accounts";
import { DevKeyStore, getPinelyFacilitatorDomain, PAYMENT_402_TYPES } from "@pinely-protocol/sdk";
import app from "../src/app";
import { pool } from "../src/db/connection";
import { computeEffectiveTier } from "../src/routes/machines";
import { createSignedSessionToken } from "../src/routes/auth";
import { BURN_SHARE_BPS } from "../src/routes/burns";
import { pilotRateLimiter } from "../src/routes/pilot";
import { FIXTURE_ADDRESSES, installFixtureDeployment } from "./fixtures";

const TEST_PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const EXPECTED_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const REGISTRY_ADDRESS = FIXTURE_ADDRESSES.MachineRegistry;
const MERCHANT_ADDRESS = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const OPERATOR_ADDRESS = EXPECTED_ADDRESS;
/** Prepare routes require an operator session in every environment. */
const sessionHeaders = () => ({
  Cookie: `pinely_session=${createSignedSessionToken(OPERATOR_ADDRESS, 3600)}`,
});

describe("Backend API & Facilitator — Integration Test Suite", () => {
  beforeAll(() => {
    installFixtureDeployment();
    // Local simulation is an explicit opt-in; it is ignored in production.
    process.env.FACILITATOR_SIMULATION = "true";
  });

  // Restore any `pool.query` spy so a mocked database never leaks into the next test.
  afterEach(() => {
    mock.restore();
  });

  describe("Health & System Status", () => {
    it("should respond 200 OK on /health", async () => {
      const res = await app.request("/health");
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe("ok");
    });

    it("should return ecosystem stats from the indexer on /api/stats", async () => {
      const row = {
        totalMachines: "2",
        activeMachines: "1",
        totalStableSwapped: "5000000",
        totalSwaps: "3",
        totalProtocolFees: "0",
        totalOperators: "1",
      };
      spyOn(pool, "query").mockResolvedValue({ rows: [row] } as never);
      const res = await app.request("/api/stats");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.totalMachines).toBe("2");
      expect(json.meta.indexer).toBe("ready");
    });

    it("should answer 503 instead of zeros when the indexer is unavailable on /api/stats", async () => {
      spyOn(pool, "query").mockRejectedValue(
        new Error('relation "ponder.machines" does not exist'),
      );
      const res = await app.request("/api/stats");
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(JSON.parse(text).error).toBe("indexer_unavailable");
      // Database error text must never reach the client.
      expect(text).not.toContain("does not exist");
    });
  });

  describe("Operator SIWE Authentication", () => {
    it("should issue random nonce on /api/auth/nonce", async () => {
      const res = await app.request("/api/auth/nonce");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.nonce).toBeDefined();
      expect(json.nonce.length).toBeGreaterThanOrEqual(16);
    });

    it("should verify valid SIWE message and issue session cookie", async () => {
      // 1. Dapatkan nonce
      const nonceRes = await app.request("/api/auth/nonce");
      const { nonce } = await nonceRes.json();

      // 2. Build the SIWE message
      const account = privateKeyToAccount(TEST_PRIVATE_KEY);
      const issuedAt = new Date().toISOString();
      const message =
        `localhost wants you to sign in with your Ethereum account:\n` +
        `${account.address}\n\n` +
        `Masuk ke PINELY Fleet Pro Dashboard.\n\n` +
        `URI: http://localhost:3000\n` +
        `Version: 1\n` +
        `Chain ID: 46630\n` +
        `Nonce: ${nonce}\n` +
        `Issued At: ${issuedAt}`;

      // 3. Sign the message
      const signature = await account.signMessage({ message });

      // 4. Verifikasi ke backend
      const verifyRes = await app.request("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });

      expect(verifyRes.status).toBe(200);
      const verifyJson = await verifyRes.json();
      expect(verifyJson.status).toBe("ok");
      expect(verifyJson.address.toLowerCase()).toBe(EXPECTED_ADDRESS.toLowerCase());

      // Periksa Set-Cookie
      const cookie = verifyRes.headers.get("Set-Cookie");
      expect(cookie).toBeDefined();
      expect(cookie?.includes("pinely_session=")).toBe(true);
    });

    it("should reject expired or reused nonce", async () => {
      const account = privateKeyToAccount(TEST_PRIVATE_KEY);
      const message =
        `localhost wants you to sign in with your Ethereum account:\n` +
        `${account.address}\n\n` +
        `Masuk ke PINELY.\n\n` +
        `URI: http://localhost:3000\n` +
        `Version: 1\n` +
        `Chain ID: 46630\n` +
        `Nonce: FAKE_OR_EXPIRED_NONCE\n` +
        `Issued At: ${new Date().toISOString()}`;

      const signature = await account.signMessage({ message });

      const res = await app.request("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });
  });

  describe("PINELY Facilitator x402 Protocol", () => {
    it("should respond HTTP 402 with x402 requirements on /v1/charge/:id", async () => {
      const res = await app.request(`/v1/charge/dock-001?amount=250000&payTo=${MERCHANT_ADDRESS}`);
      expect(res.status).toBe(402);

      const json = await res.json();
      expect(json.x402Version).toBe(1);
      expect(json.error).toBe("Payment required");
      expect(json.accepts).toBeDefined();
      expect(json.accepts.length).toBeGreaterThan(0);
      expect(json.accepts[0].maxAmountRequired).toBe("250000");
      expect(json.accepts[0].network).toBe("robinhood-testnet");
      expect(json.accepts[0].extra.verifyingContract).toBe(REGISTRY_ADDRESS);
    });

    it("should return capability detection on /v1/capability", async () => {
      const res = await app.request("/v1/capability");
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.rail).toBeDefined();
      expect(json.chainId).toBe(46630);
    });

    it("should verify and settle valid Payment402Intent signed by machine keystore", async () => {
      const keystore = new DevKeyStore(TEST_PRIVATE_KEY);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const nonce = BigInt(Date.now() * 1000 + 1);
      const machineId = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
      const resource = "https://facilitator.example/v1/charge/dock-001";
      const amountStable = 100_000n;

      const intent = {
        machineId,
        resource,
        amountStable,
        nonce,
        deadline,
      };

      const signature = await keystore.signTypedData({
        domain: getPinelyFacilitatorDomain(REGISTRY_ADDRESS, 46630n),
        types: PAYMENT_402_TYPES,
        primaryType: "Payment402Intent",
        message: intent,
      });

      // 1. Verifikasi
      const verifyRes = await app.request("/v1/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: {
            ...intent,
            amountStable: amountStable.toString(),
            nonce: nonce.toString(),
            deadline: deadline.toString(),
          },
          signature,
        }),
      });

      expect(verifyRes.status).toBe(200);
      const verifyJson = await verifyRes.json();
      expect(verifyJson.valid).toBe(true);
      expect(verifyJson.signer.toLowerCase()).toBe(EXPECTED_ADDRESS.toLowerCase());

      // 2. Settlement
      const settleRes = await app.request("/v1/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: {
            ...intent,
            amountStable: amountStable.toString(),
            nonce: nonce.toString(),
            deadline: deadline.toString(),
          },
          signature,
          machineAccount: EXPECTED_ADDRESS,
          merchantAddress: EXPECTED_ADDRESS,
        }),
      });

      expect(settleRes.status).toBe(200);
      const settleJson = await settleRes.json();
      expect(settleJson.status).toBe("settled");
      expect(settleJson.txHash).toBeDefined();
      expect(settleJson.accessToken).toBeDefined();
      expect(settleJson.facilitatorFee).toBeDefined();
      expect(settleJson.netMerchantAmount).toBeDefined();

      // 3. Replay attack rejection test
      const replayRes = await app.request("/v1/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: {
            ...intent,
            amountStable: amountStable.toString(),
            nonce: nonce.toString(),
            deadline: deadline.toString(),
          },
          signature,
          machineAccount: EXPECTED_ADDRESS,
          merchantAddress: EXPECTED_ADDRESS,
        }),
      });

      expect(replayRes.status).toBe(409);
      const replayJson = await replayRes.json();
      expect(replayJson.code).toBe("NONCE_REPLAYED");
    });

    it("should settle via ERC-4337 paymaster fallback rail with valid PackedUserOperation", async () => {
      const keystore = new DevKeyStore(TEST_PRIVATE_KEY);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const nonce = BigInt(Date.now() * 1000 + 4337);
      const machineId = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
      const resource = "https://facilitator.example/v1/charge/dock-002";
      const amountStable = 500_000n; // $0.50 stablecoin

      const intent = {
        machineId,
        resource,
        amountStable,
        nonce,
        deadline,
      };

      const signature = await keystore.signTypedData({
        domain: getPinelyFacilitatorDomain(REGISTRY_ADDRESS, 46630n),
        types: PAYMENT_402_TYPES,
        primaryType: "Payment402Intent",
        message: intent,
      });

      const settleRes = await app.request("/v1/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: {
            ...intent,
            amountStable: amountStable.toString(),
            nonce: nonce.toString(),
            deadline: deadline.toString(),
          },
          signature,
          machineAccount: EXPECTED_ADDRESS,
          merchantAddress: EXPECTED_ADDRESS,
        }),
      });

      expect(settleRes.status).toBe(200);
      const json = await settleRes.json();
      expect(json.status).toBe("settled");
      expect(json.rail).toBe("erc4337-paymaster");
      expect(json.userOp).toBeDefined();
      expect(json.userOp.sender.toLowerCase()).toBe(EXPECTED_ADDRESS.toLowerCase());
      expect(json.userOp.callData).toBeDefined();
      // callData must be wrapped in PinelyAccount.execute (selector 0xb61d27f6)
      expect(json.userOp.callData.startsWith("0xb61d27f6")).toBe(true);
      expect(json.userOp.paymasterAndData).toBeDefined();
      expect(json.txHash).toBeDefined();
      expect(json.accessToken).toBeDefined();
    });

    it("should reject settlement when merchantAddress is missing", async () => {
      const keystore = new DevKeyStore(TEST_PRIVATE_KEY);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const nonce = BigInt(Date.now() * 1000 + 9991);
      const machineId = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
      const resource = "https://facilitator.example/v1/charge/dock-missing-merchant";
      const amountStable = 100_000n;

      const intent = {
        machineId,
        resource,
        amountStable,
        nonce,
        deadline,
      };

      const signature = await keystore.signTypedData({
        domain: getPinelyFacilitatorDomain(REGISTRY_ADDRESS, 46630n),
        types: PAYMENT_402_TYPES,
        primaryType: "Payment402Intent",
        message: intent,
      });

      const res = await app.request("/v1/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent: {
            ...intent,
            amountStable: amountStable.toString(),
            nonce: nonce.toString(),
            deadline: deadline.toString(),
          },
          signature,
          // deliberately omits merchantAddress
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.code).toBe("MERCHANT_ADDRESS_REQUIRED");
    });
  });

  describe("Operator Action Preparation", () => {
    it("should prepare valid registration calldata", async () => {
      const res = await app.request("/api/actions/register/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sessionHeaders() },
        body: JSON.stringify({
          account: EXPECTED_ADDRESS,
          signer: EXPECTED_ADDRESS,
          maxStableOutPerSwap: "10000000",
          dailyStableOutCap: "50000000",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.to).toBeDefined();
      expect(json.data.startsWith("0x")).toBe(true);
      expect(json.chainId).toBe(46630);
    });

    it("should handle 20-byte address passed as attestationHash without size mismatch", async () => {
      const res = await app.request("/api/actions/register/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sessionHeaders() },
        body: JSON.stringify({
          account: EXPECTED_ADDRESS,
          signer: EXPECTED_ADDRESS,
          attestationHash: "0x9720E0b6eac667904847b576c84073A4c355188E",
          maxStableOutPerSwap: "10000000",
          dailyStableOutCap: "50000000",
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.to).toBeDefined();
      expect(json.data.startsWith("0x")).toBe(true);
    });

    it("should reject registration prepare when maxStableOutPerSwap exceeds dailyStableOutCap", async () => {
      const res = await app.request("/api/actions/register/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sessionHeaders() },
        body: JSON.stringify({
          account: EXPECTED_ADDRESS,
          signer: EXPECTED_ADDRESS,
          maxStableOutPerSwap: "60000000",
          dailyStableOutCap: "50000000",
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("maxStableOutPerSwap cannot exceed dailyStableOutCap");
    });

    it("should reject policy prepare when maxStableOutPerSwap exceeds dailyStableOutCap", async () => {
      const res = await app.request("/api/actions/policy/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sessionHeaders() },
        body: JSON.stringify({
          machineId: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
          maxStableOutPerSwap: "100000000",
          dailyStableOutCap: "50000000",
          enabled: true,
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain("maxStableOutPerSwap cannot exceed dailyStableOutCap");
    });

    it("should prepare valid freeze machine and fleet kill switch calldata", async () => {
      // Individual freeze
      const machineRes = await app.request("/api/actions/freeze/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sessionHeaders() },
        body: JSON.stringify({
          machineId: "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
        }),
      });
      expect(machineRes.status).toBe(200);
      const machineJson = await machineRes.json();
      expect(machineJson.data.startsWith("0x")).toBe(true);

      // Fleet kill switch
      const fleetRes = await app.request("/api/actions/freeze/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sessionHeaders() },
        body: JSON.stringify({ freezeFleet: true }),
      });
      expect(fleetRes.status).toBe(200);
      const fleetJson = await fleetRes.json();
      expect(fleetJson.data.startsWith("0x")).toBe(true);
    });
  });

  describe("Machines & Fleets Query Endpoints", () => {
    it("should page the machine list and report the total on /api/machines", async () => {
      const calls: unknown[][] = [];
      spyOn(pool, "query").mockImplementation((async (_sql: string, values: unknown[]) => {
        calls.push(values);
        return calls.length === 1 ? { rows: [{ total: 45 }] } : { rows: [] };
      }) as never);

      const res = await app.request("/api/machines?page=2&limit=20");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.meta).toMatchObject({ total: 45, page: 2, limit: 20, indexer: "ready" });
      // The list query receives the paging values: limit 20, offset 20 (page 2).
      expect(calls[1]).toEqual([20, 20]);
    });

    it("should clamp an oversized or invalid page size on /api/machines", async () => {
      const calls: unknown[][] = [];
      spyOn(pool, "query").mockImplementation((async (_sql: string, values: unknown[]) => {
        calls.push(values);
        return calls.length === 1 ? { rows: [{ total: 0 }] } : { rows: [] };
      }) as never);

      await app.request("/api/machines?limit=100000&page=abc");
      expect(calls[1]).toEqual([100, 0]);
    });

    it("should answer 503 when the indexer is unavailable on /api/machines", async () => {
      spyOn(pool, "query").mockRejectedValue(new Error("connection refused"));
      const res = await app.request("/api/machines");
      expect(res.status).toBe(503);
      expect((await res.json()).error).toBe("indexer_unavailable");
    });

    it("should answer 503 when the indexer is unavailable on the other indexer routes", async () => {
      spyOn(pool, "query").mockRejectedValue(new Error("connection refused"));
      for (const path of [
        "/api/burns",
        "/api/burns/summary",
        "/api/burns/sources",
        `/api/fleets/${EXPECTED_ADDRESS}/summary`,
        `/api/fleets/${EXPECTED_ADDRESS}/violations`,
        "/api/machines/0xabc/activity",
      ]) {
        const res = await app.request(path);
        expect(res.status).toBe(503);
      }
    });

    it("should break BurnVault inflows down by source and mark unmeasured ones untracked", async () => {
      const query = spyOn(pool, "query").mockResolvedValue({
        rows: [
          {
            protocolFee: "400000",
            protocolFeeCount: 7,
            subscription: "19800000",
            subscriptionCount: 2,
            burnedPinely: "1500000000000000000",
          },
        ],
      } as never);

      const res = await app.request("/api/burns/sources");
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.meta.indexer).toBe("ready");
      expect(json.data.burnedPinely).toBe("1500000000000000000");

      const byKey = Object.fromEntries(json.data.inflows.map((i: { key: string }) => [i.key, i]));
      expect(byKey.protocol_fee).toMatchObject({ tracked: true, amount: "400000", count: 7 });
      expect(byKey.fleet_subscription).toMatchObject({
        tracked: true,
        amount: "19800000",
        count: 2,
      });
      // Unmeasured sources carry a reason and no amount: never a fabricated zero.
      for (const key of ["creator_fee", "registration_fee", "stake_slash"]) {
        expect(byKey[key].tracked).toBe(false);
        expect(byKey[key].reason).toBeDefined();
        expect(byKey[key]).not.toHaveProperty("amount");
      }
      expect(byKey.stake_slash.token).toBe("PINELY");
      // The burn share handed to the SQL matches the contracts (20%).
      expect(query.mock.calls[0][1]).toEqual([BURN_SHARE_BPS]);
    });

    it("should list settled facilitator payments for a machine", async () => {
      const row = {
        id: "p1",
        recipient: MERCHANT_ADDRESS,
        amount: "250000",
        rail: "erc4337-paymaster",
        txHash: `0x${"ef".repeat(32)}`,
        createdAt: "1700000000",
      };
      const query = spyOn(pool, "query").mockResolvedValue({ rows: [row] } as never);
      const machineId = `0x${"AB".repeat(32)}`;

      const res = await app.request(`/api/machines/${machineId}/payments?limit=500`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toEqual([row]);
      // The id is a bound parameter and the limit is clamped to 50.
      expect(query.mock.calls[0][1]).toEqual([machineId, 50]);
      expect(String(query.mock.calls[0][0])).toContain("status = 'settled'");
      expect(String(query.mock.calls[0][0])).toContain("tx_hash is not null");
    });

    it("should reject a malformed machine id on the payments route", async () => {
      const query = spyOn(pool, "query").mockResolvedValue({ rows: [] } as never);
      const res = await app.request("/api/machines/not-an-id/payments");
      expect(res.status).toBe(400);
      expect(query).not.toHaveBeenCalled();
    });

    it("should not leak database errors from the payments route", async () => {
      spyOn(pool, "query").mockRejectedValue(new Error('relation "app.secret" does not exist'));
      const res = await app.request(`/api/machines/0x${"ab".repeat(32)}/payments`);
      expect(res.status).toBe(500);
      expect(await res.text()).not.toContain("does not exist");
    });

    it("should list recorded policy violations for an operator fleet", async () => {
      const row = {
        id: "v1",
        machineId: `0x${"ab".repeat(32)}`,
        evidenceHash: `0x${"cd".repeat(32)}`,
        reportedBy: EXPECTED_ADDRESS,
        txHash: `0x${"ef".repeat(32)}`,
        blockTimestamp: "1700000000",
      };
      const query = spyOn(pool, "query").mockResolvedValue({ rows: [row] } as never);

      const res = await app.request(`/api/fleets/${EXPECTED_ADDRESS}/violations`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toEqual([row]);
      expect(json.meta.count).toBe(1);
      // The operator filter is passed lower-cased as a bound parameter.
      expect(query.mock.calls[0][1]).toEqual([EXPECTED_ADDRESS.toLowerCase()]);
    });

    it("should return a null profile for an operator the indexer has not seen", async () => {
      let call = 0;
      spyOn(pool, "query").mockImplementation((async () => {
        call += 1;
        if (call === 1) return { rows: [] };
        if (call === 2) {
          return {
            rows: [
              {
                totalMachines: "0",
                activeMachines: "0",
                frozenMachines: "0",
                bronzeCount: "0",
                silverCount: "0",
                goldCount: "0",
              },
            ],
          };
        }
        return { rows: [{ totalStableOut: "0", totalSwaps: "0" }] };
      }) as never);

      const res = await app.request(`/api/fleets/${EXPECTED_ADDRESS}/summary`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.operator.toLowerCase()).toBe(EXPECTED_ADDRESS.toLowerCase());
      expect(json.data.profile).toBeNull();
      expect(json.data.fleet).toBeDefined();
      expect(json.data.volume).toBeDefined();
    });
  });

  describe("Fleet Pro Billing & Quota Service", () => {
    beforeEach(async () => {
      try {
        await pool.query(`delete from app.fleet_subscriptions where operator = $1`, [
          EXPECTED_ADDRESS.toLowerCase(),
        ]);
      } catch {}
    });

    it("should return starter subscription status for operator", async () => {
      const res = await app.request(`/api/billing/subscription/${EXPECTED_ADDRESS}`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(json.data.operator).toBe(EXPECTED_ADDRESS);
      expect(json.data.plan).toBe("free");
      expect(json.data.maxMachines).toBe(5);
      expect(json.data.features).toContain("x402_payments");
      expect(json.data.renewsAt).toBeDefined();
    });

    it("should reject invalid operator address on billing endpoints", async () => {
      const res = await app.request("/api/billing/subscription/not-an-address");
      expect(res.status).toBe(400);
    });

    it("should return monthly quota tracking envelope", async () => {
      const res = await app.request(`/api/billing/quota/${EXPECTED_ADDRESS}`);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);
      expect(parseFloat(json.data.monthlyCapStable)).toBeGreaterThan(0);
      expect(parseFloat(json.data.remainingStable)).toBeGreaterThanOrEqual(0);
      expect(json.data.resetsAt).toBeDefined();
    });

    it("should allow operator to upgrade plan to Fleet Pro", async () => {
      const upgradeRes = await app.request("/api/billing/upgrade", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operator: EXPECTED_ADDRESS,
          plan: "pro",
        }),
      });

      expect(upgradeRes.status).toBe(200);
      const upgradeJson = await upgradeRes.json();
      expect(upgradeJson.success).toBe(true);
      expect(upgradeJson.data.plan).toBe("pro");
      expect(upgradeJson.data.maxMachines).toBe(50);

      // Verify query reflects new plan
      const subRes = await app.request(`/api/billing/subscription/${EXPECTED_ADDRESS}`);
      const subJson = await subRes.json();
      expect(subJson.data.plan).toBe("pro");
      expect(subJson.data.maxMachines).toBe(50);
      expect(subJson.data.features).toContain("fleet_kill_switch");
    });

    it("should reject authenticated operator upgrading other fleet", async () => {
      // 1. Authenticate as EXPECTED_ADDRESS
      const nonceRes = await app.request("/api/auth/nonce");
      const { nonce } = await nonceRes.json();
      const account = privateKeyToAccount(TEST_PRIVATE_KEY);
      const issuedAt = new Date().toISOString();
      const message =
        `localhost wants you to sign in with your Ethereum account:\n` +
        `${account.address}\n\n` +
        `Masuk ke PINELY Fleet Pro Dashboard.\n\n` +
        `URI: http://localhost:3000\n` +
        `Version: 1\n` +
        `Chain ID: 46630\n` +
        `Nonce: ${nonce}\n` +
        `Issued At: ${issuedAt}`;
      const signature = await account.signMessage({ message });
      const verifyRes = await app.request("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      const cookieHeader = verifyRes.headers.get("set-cookie") ?? "";

      // 2. Try to upgrade someone else's fleet
      const strangerAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const upgradeRes = await app.request("/api/billing/upgrade", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: cookieHeader,
        },
        body: JSON.stringify({
          operator: strangerAddress,
          plan: "enterprise",
        }),
      });

      expect(upgradeRes.status).toBe(403);
    });
  });

  describe("Pilot Program Applications (P1-P3)", () => {
    const validApplication = {
      operatorName: "Aurora Logistics",
      organization: "Aurora Logistics Ltd",
      email: "Fleet@Example.com",
      machineType: "Autonomous Delivery Rover",
      deviceCount: 10,
      hardwareEnclave: "NXP SE050 TPM",
      notes: "Warehouse pilot",
    };
    const post = (payload: unknown, raw = false) =>
      app.request("/api/pilot/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: raw ? (payload as string) : JSON.stringify(payload),
      });

    beforeEach(() => pilotRateLimiter.reset());

    it("should store a valid application and return the backend-issued id", async () => {
      const query = spyOn(pool, "query").mockResolvedValue({
        rows: [{ id: 42, createdAt: "2026-11-10T00:00:00.000Z" }],
      } as never);
      const res = await post(validApplication);
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json).toEqual({
        status: "received",
        data: { id: 42, createdAt: "2026-11-10T00:00:00.000Z" },
      });
      // Email is normalised and every field reaches the insert.
      const values = query.mock.calls[0][1] as unknown[];
      expect(values).toEqual([
        "Aurora Logistics",
        "Aurora Logistics Ltd",
        "Autonomous Delivery Rover",
        10,
        "NXP SE050 TPM",
        "fleet@example.com",
        "Warehouse pilot",
      ]);
    });

    it("should not leak database error text when storing fails", async () => {
      spyOn(pool, "query").mockRejectedValue(new Error('relation "app.pilot_applications" broke'));
      const res = await post(validApplication);
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text).error).toBe("Failed to record pilot application");
      expect(text).not.toContain("broke");
    });

    it("should reject the legacy payload that uses fleetSize instead of deviceCount", async () => {
      const { deviceCount: _unused, ...rest } = validApplication;
      const res = await post({ ...rest, fleetSize: 10 });
      expect(res.status).toBe(400);
    });

    it("should reject malformed JSON, non-object bodies and non-string fields", async () => {
      expect((await post("{not json", true)).status).toBe(400);
      expect((await post([1, 2, 3])).status).toBe(400);
      expect((await post({ ...validApplication, operatorName: { a: 1 } })).status).toBe(400);
      expect((await post({ ...validApplication, deviceCount: "10" })).status).toBe(400);
    });

    it("should reject over-long fields and oversized bodies", async () => {
      expect((await post({ ...validApplication, notes: "x".repeat(2001) })).status).toBe(400);
      const huge = JSON.stringify({ ...validApplication, notes: "x".repeat(20_000) });
      expect((await post(huge, true)).status).toBe(413);
    });

    it("should rate limit repeated applications from one caller", async () => {
      spyOn(pool, "query").mockResolvedValue({
        rows: [{ id: 1, createdAt: "2026-11-10T00:00:00.000Z" }],
      } as never);
      const statuses: number[] = [];
      for (let i = 0; i < 7; i++) statuses.push((await post(validApplication)).status);
      expect(statuses.slice(0, 5).every((st) => st === 201)).toBe(true);
      expect(statuses.slice(5)).toEqual([429, 429]);
    });

    it("should reject application without operator name", async () => {
      const res = await app.request("/api/pilot/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          machineType: "Charging stations",
          deviceCount: 10,
          email: "fleet@example.com",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("should reject application with invalid email", async () => {
      const res = await app.request("/api/pilot/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorName: "Aurora Logistics",
          machineType: "Delivery robots",
          deviceCount: 10,
          email: "not-an-email",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("should reject application with unknown machine type or zero devices", async () => {
      const badType = await app.request("/api/pilot/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorName: "Aurora Logistics",
          machineType: "Kapal selam",
          deviceCount: 10,
          email: "fleet@example.com",
        }),
      });
      expect(badType.status).toBe(400);

      const zeroDevices = await app.request("/api/pilot/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorName: "Aurora Logistics",
          machineType: "Drones",
          deviceCount: 0,
          email: "fleet@example.com",
        }),
      });
      expect(zeroDevices.status).toBe(400);
    });
  });

  describe("Prepare routes require an operator session in every environment (C-17)", () => {
    const ROUTES = ["register", "policy", "freeze", "unfreeze", "sweeper", "allowlist"] as const;

    for (const route of ROUTES) {
      it(`should answer 401 on /api/actions/${route}/prepare without a session`, async () => {
        const res = await app.request(`/api/actions/${route}/prepare`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(res.status).toBe(401);
      });
    }

    it("should reject a tampered session token", async () => {
      const res = await app.request("/api/actions/freeze/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: "pinely_session=not-a-real-token" },
        body: JSON.stringify({ freezeFleet: true }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe("Allowlist & Sweeper Prepare (HON)", () => {
    it("should prepare setAssetAllowed calldata for a valid asset", async () => {
      const res = await app.request("/api/actions/allowlist/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sessionHeaders() },
        body: JSON.stringify({
          machineId: `0x${"ab".repeat(32)}`,
          asset: "0x2222222222222222222222222222222222222222",
          allowed: true,
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.to).toBeDefined();
      expect(json.data).toMatch(/^0x/);
      expect(json.description).toContain("allowlist");
    });

    it("should reject allowlist prepare with invalid asset address", async () => {
      const res = await app.request("/api/actions/allowlist/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sessionHeaders() },
        body: JSON.stringify({
          machineId: `0x${"ab".repeat(32)}`,
          asset: "REWARD, stablecoin",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("should prepare sweeper config calldata for a machine", async () => {
      const res = await app.request("/api/actions/sweeper/prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...sessionHeaders() },
        body: JSON.stringify({
          machineId: `0x${"ab".repeat(32)}`,
          reserveThreshold: "500000000",
          destination: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
          enabled: true,
        }),
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.to).toBeDefined();
      expect(json.data).toMatch(/^0x/);
    });
  });

  describe("On-chain Parity for Machine Tier Evaluation", () => {
    it("should keep dormant machine in Bronze tier even if registered > 30 days ago", () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const tier = computeEffectiveTier({
        tier: 0,
        registeredAt: nowSec - 60 * 86400,
        lastActiveAt: 0, // Dormant, has never transacted
        attestationValid: false,
      });
      expect(tier).toBe(0);
    });

    it("should demote attested machine to Bronze if policy violation occurred within 30 days", () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const tier = computeEffectiveTier({
        tier: 1,
        attestationValid: true,
        lastViolationAt: nowSec - 10 * 86400, // Violation 10 days ago
      });
      expect(tier).toBe(0);
    });

    it("should promote active, non-violating machine with valid attestation to Silver", () => {
      const tier = computeEffectiveTier({
        tier: 0,
        attestationValid: true,
        lastViolationAt: 0,
      });
      expect(tier).toBe(1);
    });

    it("should demote Gold tier machine to Silver if violation occurred between 30 and 90 days ago", () => {
      const nowSec = Math.floor(Date.now() / 1000);
      const tier = computeEffectiveTier({
        tier: 2,
        attestationValid: true,
        lastViolationAt: nowSec - 45 * 86400, // Violation 45 days ago
      });
      expect(tier).toBe(1);
    });
  });
});
