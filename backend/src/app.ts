import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { createPublicClient, http } from "viem";
import { getActiveChain } from "@pinely/shared/chains";
import type { ApiMeta, EcosystemStats } from "@pinely/shared/types";
import { checkDatabase } from "./db/connection";
import { ContractNotDeployedError, getBackendChainId, notDeployedBody } from "./lib/config";
import { IndexerUnavailableError, indexerUnavailableBody, queryIndexer } from "./lib/indexer";
import { ChainUnavailableError, chainUnavailableBody } from "./lib/machine-reads";
import actionsRoute from "./routes/actions";
import authRoute from "./routes/auth";
import billingRoute from "./routes/billing";
import burnsRoute from "./routes/burns";
import facilitatorRoute from "./routes/facilitator";
import fleetsRoute from "./routes/fleets";
import machinesRoute from "./routes/machines";
import pilotRoute from "./routes/pilot";
import stakeRoute from "./routes/stake";

const app = new Hono();

/**
 * FRONTEND_URL holds the allowed browser origins, comma separated.
 * Credentials are enabled, so origins are never wildcarded and hosting-platform domains
 * (*.vercel.app, *.up.railway.app) are never accepted: anyone can register those.
 * In production FRONTEND_URL is mandatory (fail-closed).
 */
if (process.env.NODE_ENV === "production" && !process.env.FRONTEND_URL) {
  throw new Error("[PINELY] FRONTEND_URL must be set explicitly in production.");
}
function getAllowedOrigins(): string[] {
  return (process.env.FRONTEND_URL ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin && origin !== "*");
}

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => {
      // Requests without an Origin header are not browser cross-origin requests.
      if (!origin) return null;
      // Any localhost port, outside production only.
      if (
        process.env.NODE_ENV !== "production" &&
        /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
      ) {
        return origin;
      }
      return getAllowedOrigins().includes(origin) ? origin : null;
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-PAYMENT"],
    credentials: true,
  }),
);

// A route that needs an undeployed contract answers honestly instead of inventing an address.
app.onError((err, c) => {
  if (err instanceof ContractNotDeployedError) {
    return c.json(notDeployedBody(err.contract), 503);
  }
  if (err instanceof IndexerUnavailableError) {
    return c.json(indexerUnavailableBody(), 503);
  }
  if (err instanceof ChainUnavailableError) {
    return c.json(chainUnavailableBody(), 503);
  }
  console.error("[PINELY Backend] Unhandled error:", err);
  return c.json({ error: "Internal Server Error" }, 500);
});

// Health & Readiness Endpoints
app.get("/health", (c) => c.json({ status: "ok" }));

/** Reads the chain id from the configured RPC; the backend must point at the chain it is configured for. */
async function checkRpc(): Promise<{
  ok: boolean;
  chainId?: number;
  expected: number;
  error?: string;
}> {
  const expected = getBackendChainId();
  try {
    const client = createPublicClient({
      chain: getActiveChain(expected),
      transport: http(process.env.RPC_URL || undefined, { timeout: 3_000, retryCount: 0 }),
    });
    const chainId = await client.getChainId();
    return { ok: chainId === expected, chainId, expected };
  } catch (error) {
    console.error(
      "[PINELY Backend] RPC readiness check failed:",
      error instanceof Error ? error.message : error,
    );
    return { ok: false, expected, error: "rpc_unreachable" };
  }
}

async function checkIndexer(): Promise<{ ok: boolean }> {
  try {
    await queryIndexer("select 1 from ponder.machines limit 1");
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

app.get("/ready", async (c) => {
  const [database, rpc, indexer] = await Promise.all([checkDatabase(), checkRpc(), checkIndexer()]);
  const ready = database.ok && rpc.ok && indexer.ok;
  const body = {
    status: ready ? "ready" : "not_ready",
    database,
    rpc,
    indexer,
    uptimeSeconds: Math.round(process.uptime()),
  };

  return c.json(body, ready ? 200 : 503);
});

// Ecosystem Stats Aggregate
app.get("/api/stats", async (c) => {
  // An unreachable indexer answers 503 (see onError); it is never reported as "zero machines".
  const statsQuery = `
    select
      (select count(*) from ponder.machines) as "totalMachines",
      (select count(*) from ponder.machines where not frozen) as "activeMachines",
      (select coalesce(sum(stable_out), 0) from ponder.swaps) as "totalStableSwapped",
      (select count(*) from ponder.swaps) as "totalSwaps",
      (select coalesce(sum(amount), 0) from ponder.protocol_fees) as "totalProtocolFees",
      (select count(*) from ponder.operators) as "totalOperators"
  `;
  const { rows } = await queryIndexer<EcosystemStats>(statsQuery);

  return c.json({
    data: rows[0],
    meta: { indexer: "ready" } satisfies ApiMeta,
  });
});

// Modular Routes
app.route("/api/auth", authRoute);
app.route("/v1", facilitatorRoute);
app.route("/api/machines", machinesRoute);
app.route("/api/pilot", pilotRoute);
app.route("/api/fleets", fleetsRoute);
app.route("/api/actions", actionsRoute);
app.route("/api/burns", burnsRoute);
app.route("/api/billing", billingRoute);
app.route("/api/stake", stakeRoute);

export default app;
