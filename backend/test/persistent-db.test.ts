import { describe, expect, it } from "bun:test";
import { appSchema, facilitatorSettlements, fleetSubscriptions } from "../src/db/schema";
import { startQueueWorker, stopQueueWorker, triggerSurplusSweepJob } from "../src/jobs/worker";
import {
  isPaymentNonceSettled,
  isPaymentNonceSettledAsync,
  loadSettledPaymentNoncesFromDb,
  recordSettledPaymentNonce,
} from "../src/services/payment-rails";
import { getSessionSecret } from "../src/routes/auth";

describe("Backend Persistent Database & Queue Worker", () => {
  it("should have correct Drizzle schema definitions for app schema", () => {
    expect(appSchema.schemaName).toBe("app");
    expect(fleetSubscriptions).toBeDefined();
    expect(facilitatorSettlements).toBeDefined();
  });

  it("should record and verify settled payment nonces with replay protection", async () => {
    const machineId = "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef";
    const nonce = BigInt(Date.now() * 1000 + Math.floor(Math.random() * 1000));

    expect(isPaymentNonceSettled(machineId, nonce)).toBe(false);
    expect(await isPaymentNonceSettledAsync(machineId, nonce)).toBe(false);

    await recordSettledPaymentNonce(machineId, nonce, {
      recipient: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
      amount: 1000000n,
      rail: "erc4337-paymaster",
    });

    expect(isPaymentNonceSettled(machineId, nonce)).toBe(true);
    expect(await isPaymentNonceSettledAsync(machineId, nonce)).toBe(true);

    // Re-loading from DB does not crash even without live DB
    await loadSettledPaymentNoncesFromDb();
    expect(isPaymentNonceSettled(machineId, nonce)).toBe(true);
    expect(await isPaymentNonceSettledAsync(machineId, nonce)).toBe(true);
  });

  it("should enforce fail-fast security for SESSION_SECRET in production mode", () => {
    const origEnv = process.env.NODE_ENV;
    const origSecret = process.env.SESSION_SECRET;

    try {
      process.env.NODE_ENV = "production";
      delete process.env.SESSION_SECRET;

      expect(() => getSessionSecret()).toThrow("FATAL SECURITY");

      process.env.SESSION_SECRET = "short";
      expect(() => getSessionSecret()).toThrow("FATAL SECURITY");

      process.env.SESSION_SECRET = "dev-insecure-pinely-session-secret-do-not-use-in-prod!";
      expect(() => getSessionSecret()).toThrow("FATAL SECURITY");

      process.env.SESSION_SECRET = "super-strong-secure-production-random-secret-key-32b!";
      expect(getSessionSecret()).toBe("super-strong-secure-production-random-secret-key-32b!");
    } finally {
      process.env.NODE_ENV = origEnv;
      if (origSecret) process.env.SESSION_SECRET = origSecret;
      else delete process.env.SESSION_SECRET;
    }
  });

  it("should safely handle pg-boss worker lifecycle when DATABASE_URL is not connected", async () => {
    // If DATABASE_URL is not set or invalid, startQueueWorker returns gracefully without throwing
    const worker = await startQueueWorker();
    const jobId = await triggerSurplusSweepJob({ machineId: "0x1111" });

    if (!worker) {
      expect(jobId).toBeNull();
    }

    await stopQueueWorker();
  }, 15000);
});
