import { Hono } from "hono";
import { APP_SCHEMA, pool } from "../db/connection";
import { queryIndexer } from "../lib/indexer";

const machinesRoute = new Hono();

/** Parses a positive integer query parameter; falls back to `fallback` and is capped at `max`. */
function parsePositiveInt(raw: string | undefined, fallback: number, max: number): number {
  const parsed = Math.trunc(Number(raw));
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

export function computeEffectiveTier(machine: {
  tier?: number | string | null;
  attestationValid?: boolean | null;
  registeredAt?: number | string | null;
  lastActiveAt?: number | string | null;
  lastViolationAt?: number | string | null;
}): number {
  const currentTier = Number(machine.tier ?? 0);
  const regAt = Number(machine.registeredAt ?? 0);
  const lastActive = Number(machine.lastActiveAt ?? 0);
  const lastViol = Number(machine.lastViolationAt ?? 0);
  const nowSec = Math.floor(Date.now() / 1000);

  // If there is a violation in the last 30 days, demote to Bronze (0)
  if (lastViol > 0 && nowSec - lastViol < 30 * 86400) {
    return 0;
  }

  // Gold Tier (2): if the indexer says Gold, verify the 90-day violation window
  if (currentTier >= 2) {
    if (lastViol > 0 && nowSec - lastViol < 90 * 86400) {
      return 1;
    }
    return 2;
  }

  // Silver Tier (1):
  // Valid hardware attestation OR (registered >= 30 days, has been active > 0, and active in the last 30 days)
  const isAttested = Boolean(machine.attestationValid);
  const isTimeQualified =
    regAt > 0 &&
    nowSec - regAt >= 30 * 86400 &&
    lastActive > 0 &&
    nowSec - lastActive <= 30 * 86400;

  if (isAttested || isTimeQualified) {
    return 1;
  }

  return 0;
}

/**
 * GET /api/machines
 * Gets the machine list from the ponder indexer schema with optional filters (tier, frozen, operator).
 */
machinesRoute.get("/", async (c) => {
  const tier = c.req.query("tier");
  const frozen = c.req.query("frozen");
  const operator = c.req.query("operator");
  const includeDeregistered = c.req.query("includeDeregistered") === "true";
  const limit = parsePositiveInt(c.req.query("limit"), 50, 100);
  const page = parsePositiveInt(c.req.query("page"), 1, 100_000);
  const offset = (page - 1) * limit;

  const conditions: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (!includeDeregistered) {
    conditions.push(`coalesce(m.deregistered, false) = false`);
  }

  if (tier !== undefined) {
    conditions.push(`tier = $${idx++}`);
    values.push(Number(tier));
  }
  if (frozen !== undefined) {
    conditions.push(`frozen = $${idx++}`);
    values.push(frozen === "true");
  }
  if (operator !== undefined) {
    conditions.push(`operator = $${idx++}`);
    values.push(operator.toLowerCase());
  }
  // Prefix search over machine id, account and operator. LIKE wildcards in the input are escaped.
  const search = c.req.query("search")?.trim().toLowerCase().slice(0, 80);
  if (search) {
    const pattern = `${search.replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(
      `(lower(m.id) like $${idx} or lower(m.account) like $${idx} or lower(m.operator) like $${idx})`,
    );
    values.push(pattern);
    idx += 1;
  }

  const whereClause = conditions.length > 0 ? `where ${conditions.join(" and ")}` : "";

  const query = `
      select 
        m.id as "machineId",
        m.account,
        m.operator,
        m.signer,
        m.attestation_hash as "attestationHash",
        m.attestation_valid as "attestationValid",
        m.tier,
        m.frozen,
        m.max_stable_out_per_swap as "maxStableOutPerSwap",
        m.daily_stable_out_cap as "dailyStableOutCap",
        m.policy_enabled as "policyEnabled",
        m.registered_at as "registeredAt",
        m.registered_block as "registeredBlock",
        m.registered_tx as "registeredTx",
        m.last_active_at as "lastActiveAt",
        m.last_violation_at as "lastViolationAt",
        coalesce(m.deregistered, false) as "deregistered",
        coalesce((
          select count(*) from ponder.policy_violations v where v.machine_id = m.id
        ), 0) as "violations",
        coalesce((
          select total_today from ponder.daily_machine_spend d
          where d.id = m.id || ':' || (extract(epoch from now())::bigint / 86400)
        ), 0) as "usedToday",
        coalesce((
          select sum(stable_out) from ponder.swaps s where s.machine_id = m.id
        ), 0) as "totalStableOut",
        coalesce((
          select count(*) from ponder.swaps s where s.machine_id = m.id
        ), 0) as "totalSwaps",
        coalesce((
          select sum(amount::numeric) from "${APP_SCHEMA}".facilitator_settlements f
          where f.machine_id = lower(m.id) and f.status = 'settled'
        ), 0) as "totalFacilitatorSpent"
      from ponder.machines m
      ${whereClause}
      order by m.registered_at desc
      limit $${idx} offset $${idx + 1}
    `;
  const countQuery = `select count(*)::int as "total" from ponder.machines m ${whereClause}`;

  // The filter values are shared by both queries; paging values apply to the list query only.
  const { rows: countRows } = await queryIndexer<{ total: number }>(countQuery, values);
  const { rows } = await queryIndexer(query, [...values, limit, offset]);

  const enrichedRows = rows.map((row) => ({
    ...row,
    tier: computeEffectiveTier(row),
  }));

  return c.json({
    data: enrichedRows,
    meta: {
      count: enrichedRows.length,
      total: countRows[0]?.total ?? 0,
      page,
      limit,
      indexer: "ready",
    },
  });
});

/**
 * GET /api/machines/:machineId
 * Gets the details of a specific machine together with its swap volume aggregates.
 */
machinesRoute.get("/:machineId", async (c) => {
  const machineId = c.req.param("machineId");

  const machineQuery = `
      select 
        id as "machineId",
        account,
        operator,
        signer,
        attestation_hash as "attestationHash",
        attestation_valid as "attestationValid",
        tier,
        frozen,
        max_stable_out_per_swap as "maxStableOutPerSwap",
        daily_stable_out_cap as "dailyStableOutCap",
        policy_enabled as "policyEnabled",
        registered_at as "registeredAt",
        registered_block as "registeredBlock",
        registered_tx as "registeredTx",
        last_active_at as "lastActiveAt",
        last_violation_at as "lastViolationAt",
        coalesce(deregistered, false) as "deregistered"
      from ponder.machines
      where id = $1
    `;
  const { rows: machineRows } = await queryIndexer(machineQuery, [machineId]);

  if (machineRows.length === 0) {
    return c.json({ error: "Machine not found in indexer" }, 404);
  }

  const machine = {
    ...machineRows[0],
    tier: computeEffectiveTier(machineRows[0]),
  };

  // Agregat swap
  const statsQuery = `
      select 
        coalesce(sum(amount_in), 0) as "totalVolumeIn",
        coalesce(sum(stable_out), 0) as "totalStableOut",
        count(*) as "totalSwaps"
      from ponder.swaps
      where machine_id = $1
    `;
  const { rows: statsRows } = await queryIndexer(statsQuery, [machineId]);

  // Policy violations & today's usage (Kill Switch)
  const auxQuery = `
      select
        (select count(*) from ponder.policy_violations v where v.machine_id = $1) as "violations",
        coalesce((
          select total_today from ponder.daily_machine_spend d
          where d.id = $1 || ':' || (extract(epoch from now())::bigint / 86400)
        ), 0) as "usedToday",
        coalesce((
          select sum(amount::numeric) from "${APP_SCHEMA}".facilitator_settlements f
          where f.machine_id = lower($1) and f.status = 'settled'
        ), 0) as "totalFacilitatorSpent"
    `;
  const { rows: auxRows } = await queryIndexer(auxQuery, [machineId]);

  return c.json({
    data: {
      ...machine,
      totals: statsRows[0] ?? {
        totalVolumeIn: "0",
        totalStableOut: "0",
        totalSwaps: 0,
      },
      violations: Number(auxRows[0]?.violations ?? 0),
      usedToday: String(auxRows[0]?.usedToday ?? "0"),
      totalFacilitatorSpent: String(auxRows[0]?.totalFacilitatorSpent ?? "0"),
    },
  });
});

/**
 * GET /api/machines/:machineId/activity
 * Gets a machine's swap and payment history.
 */
machinesRoute.get("/:machineId/activity", async (c) => {
  const machineId = c.req.param("machineId");
  const limit = parsePositiveInt(c.req.query("limit"), 20, 50);

  const query = `
      select 
        id,
        machine_id as "machineId",
        account,
        token_in as "tokenIn",
        token_out as "tokenOut",
        amount_in as "amountIn",
        amount_out as "amountOut",
        stable_out as "stableOut",
        protocol_fee as "protocolFee",
        tx_hash as "txHash",
        block_number as "blockNumber",
        block_timestamp as "blockTimestamp"
      from ponder.swaps
      where machine_id = $1
      order by block_timestamp desc
      limit $2
    `;
  const { rows } = await queryIndexer(query, [machineId, limit]);

  return c.json({
    data: rows,
    meta: { count: rows.length },
  });
});

/**
 * GET /api/machines/:machineId/passport
 * Gets the public identity and reputation passport data of a device.
 */
machinesRoute.get("/:machineId/passport", async (c) => {
  const machineId = c.req.param("machineId");

  const query = `
      select 
        m.id as "machineId",
        m.account,
        m.operator,
        m.signer,
        m.attestation_hash as "attestationHash",
        m.attestation_valid as "attestationValid",
        m.tier,
        m.frozen,
        m.registered_at as "registeredAt",
        m.registered_block as "registeredBlock",
        m.registered_tx as "registeredTx",
        m.last_active_at as "lastActiveAt",
        coalesce(sum(s.stable_out), 0) as "lifetimeStableOut",
        count(s.id) as "totalSuccessfulSwaps"
      from ponder.machines m
      left join ponder.swaps s on s.machine_id = m.id
      where m.id = $1
      group by m.id
    `;
  const { rows } = await queryIndexer(query, [machineId]);

  if (rows.length === 0) {
    return c.json({ error: "Machine passport not found" }, 404);
  }

  const row = rows[0];
  const tierNames = ["Bronze", "Silver", "Gold"];

  return c.json({
    data: {
      passportVersion: 1,
      machineId: row.machineId,
      account: row.account,
      operator: row.operator,
      signer: row.signer,
      tierName: tierNames[row.tier] ?? "Bronze",
      tier: row.tier,
      hardwareAttestation: {
        hash: row.attestationHash,
        valid: row.attestationValid,
      },
      status: row.frozen ? "FROZEN" : "ACTIVE",
      registeredAt: row.registeredAt,
      registeredBlock: row.registeredBlock,
      registeredTx: row.registeredTx,
      lastActiveAt: row.lastActiveAt,
      metrics: {
        lifetimeStableOut: row.lifetimeStableOut,
        totalSuccessfulSwaps: Number(row.totalSuccessfulSwaps),
      },
    },
  });
});

/**
 * GET /api/machines/:machineId/payments
 * Service payments this machine made through the Facilitator and that were confirmed onchain.
 * They live in the backend database (not the indexer), so this route does not depend on Ponder.
 * Only settled payments that carry a transaction hash are listed.
 */
machinesRoute.get("/:machineId/payments", async (c) => {
  const machineId = c.req.param("machineId");
  if (!/^0x[0-9a-fA-F]{64}$/.test(machineId)) {
    return c.json({ error: "machineId must be a 32-byte hex string" }, 400);
  }
  const limit = parsePositiveInt(c.req.query("limit"), 20, 50);

  const { rows } = await pool.query(
    `select
       id,
       recipient,
       amount,
       rail,
       tx_hash as "txHash",
       extract(epoch from created_at)::bigint::text as "createdAt"
     from "${APP_SCHEMA}".facilitator_settlements
     where machine_id = lower($1) and status = 'settled' and tx_hash is not null
     order by created_at desc
     limit $2`,
    [machineId, limit],
  );

  return c.json({ data: rows, meta: { count: rows.length, limit } });
});

export default machinesRoute;
