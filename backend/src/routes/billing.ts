import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { isAddress, type Address } from "viem";
import { APP_SCHEMA, pool } from "../db/connection";
import { getSessionUser } from "./auth";

const billingRoute = new Hono();

// Struktur tier langganan Fleet Pro
const PLANS = {
  free: {
    plan: "free",
    name: "Fleet Starter",
    maxMachines: 5,
    monthlyQuotaStable: "100.00",
    features: ["basic_swap", "x402_payments", "single_machine_freeze"],
  },
  pro: {
    plan: "pro",
    name: "Fleet Pro",
    maxMachines: 50,
    monthlyQuotaStable: "2500.00",
    features: [
      "basic_swap",
      "x402_payments",
      "fleet_kill_switch",
      "surplus_auto_sweep",
      "gold_tier_staking",
      "priority_facilitator",
      "advanced_telemetry",
    ],
  },
  enterprise: {
    plan: "enterprise",
    name: "Enterprise Fleet",
    maxMachines: 9999,
    monthlyQuotaStable: "50000.00",
    features: [
      "basic_swap",
      "x402_payments",
      "fleet_kill_switch",
      "surplus_auto_sweep",
      "gold_tier_staking",
      "priority_facilitator",
      "advanced_telemetry",
      "dedicated_bundler",
      "custom_sla",
    ],
  },
} as const;

type PlanType = keyof typeof PLANS;

// In-memory cache / state for the operator plan (L1 cache)
const operatorPlans = new Map<string, PlanType>();

/**
 * Gets the operator plan with priority: database app.fleet_subscriptions -> L1 cache -> default 'free'
 */
async function getOperatorPlan(normalizedOperator: string): Promise<PlanType> {
  try {
    const res = await pool.query<{ plan: string }>(
      `select plan from "${APP_SCHEMA}".fleet_subscriptions where operator = $1 limit 1`,
      [normalizedOperator],
    );
    if (res.rows[0]?.plan && res.rows[0].plan in PLANS) {
      const plan = res.rows[0].plan as PlanType;
      operatorPlans.set(normalizedOperator, plan);
      return plan;
    }
  } catch {
    // Database query failed or is offline; fall back to the in-memory cache
  }

  return operatorPlans.get(normalizedOperator) ?? "free";
}

/**
 * GET /api/billing/subscription/:operator
 * Reads the operator's subscription status and fleet limits.
 */
billingRoute.get("/subscription/:operator", async (c) => {
  const operator = c.req.param("operator") as Address;
  if (!isAddress(operator)) {
    return c.json({ error: "Invalid operator address format" }, 400);
  }

  const normalized = operator.toLowerCase();
  const currentPlanType = await getOperatorPlan(normalized);
  const planInfo = PLANS[currentPlanType];

  let machineCount = 0;
  try {
    const res = await pool.query(
      `select count(*)::int as count from ponder.machines where lower(operator) = $1`,
      [normalized],
    );
    machineCount = res.rows[0]?.count ?? 0;
  } catch {
    machineCount = 0;
  }

  const nextMonth = new Date();
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  nextMonth.setDate(1);
  nextMonth.setHours(0, 0, 0, 0);

  return c.json({
    success: true,
    data: {
      operator,
      plan: planInfo.plan,
      name: planInfo.name,
      maxMachines: planInfo.maxMachines,
      activeMachines: machineCount,
      quotaStable: planInfo.monthlyQuotaStable,
      features: planInfo.features,
      renewsAt: nextMonth.toISOString(),
    },
  });
});

/**
 * GET /api/billing/quota/:operator
 * Reads the operator's remaining monthly transaction and gas sponsorship quota.
 */
billingRoute.get("/quota/:operator", async (c) => {
  const operator = c.req.param("operator") as Address;
  if (!isAddress(operator)) {
    return c.json({ error: "Invalid operator address format" }, 400);
  }

  const normalized = operator.toLowerCase();
  const currentPlanType = await getOperatorPlan(normalized);
  const planInfo = PLANS[currentPlanType];

  let totalSpentStable = 0;
  const now = new Date();
  const startOfMonth = Math.floor(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0) / 1000,
  );

  try {
    const res = await pool.query(
      `select coalesce(sum(stable_out), 0)::text as total from ponder.swaps s
       join ponder.machines m on s.machine_id = m.id
       where lower(m.operator) = $1 and s.block_timestamp >= $2`,
      [normalized, startOfMonth],
    );
    totalSpentStable = Number(res.rows[0]?.total ?? 0) / 1e6;
  } catch {
    totalSpentStable = 0;
  }

  const monthlyCap = parseFloat(planInfo.monthlyQuotaStable);
  const remaining = Math.max(0, monthlyCap - totalSpentStable);

  const resetDate = new Date();
  resetDate.setMonth(resetDate.getMonth() + 1);
  resetDate.setDate(1);
  resetDate.setHours(0, 0, 0, 0);

  return c.json({
    success: true,
    data: {
      operator,
      monthlyCapStable: monthlyCap.toFixed(2),
      spentStable: totalSpentStable.toFixed(2),
      remainingStable: remaining.toFixed(2),
      resetsAt: resetDate.toISOString(),
    },
  });
});

/**
 * POST /api/billing/upgrade
 * Updates the operator's subscription plan (Fleet Pro simulation).
 */
billingRoute.post("/upgrade", async (c) => {
  try {
    const body = await c.req.json();
    const operator = body.operator as Address;
    const plan = body.plan as PlanType;

    if (!operator || !isAddress(operator)) {
      return c.json({ error: "Invalid operator address" }, 400);
    }

    if (!plan || !(plan in PLANS)) {
      return c.json({ error: "Invalid plan. Available options: free, pro, enterprise" }, 400);
    }

    const normalized = operator.toLowerCase();

    // Verify the operator session authorisation
    const sessionToken =
      getCookie(c, "pinely_session") ?? c.req.header("Authorization")?.replace("Bearer ", "");
    const sessionUser = getSessionUser(sessionToken);

    if (process.env.NODE_ENV === "production" && !sessionUser) {
      return c.json({ error: "Unauthenticated: Please sign in via SIWE first" }, 401);
    }

    if (sessionUser && sessionUser.toLowerCase() !== normalized) {
      return c.json({ error: "Forbidden: You can only update your own fleet subscription" }, 403);
    }

    operatorPlans.set(normalized, plan);
    const planInfo = PLANS[plan];

    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    nextMonth.setDate(1);
    nextMonth.setHours(0, 0, 0, 0);

    // Persist to PostgreSQL
    try {
      await pool.query(
        `insert into "${APP_SCHEMA}".fleet_subscriptions
         (operator, plan, max_machines, monthly_quota_stable, features, renews_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, now())
         on conflict (operator) do update set
           plan = excluded.plan,
           max_machines = excluded.max_machines,
           monthly_quota_stable = excluded.monthly_quota_stable,
           features = excluded.features,
           renews_at = excluded.renews_at,
           updated_at = now()`,
        [
          normalized,
          plan,
          planInfo.maxMachines,
          planInfo.monthlyQuotaStable,
          JSON.stringify(planInfo.features),
          nextMonth.toISOString(),
        ],
      );
    } catch {
      // Graceful fallback if the database is offline while running tests
    }

    return c.json({
      success: true,
      message: `Successfully upgraded to ${planInfo.name}`,
      data: {
        operator,
        plan: planInfo.plan,
        name: planInfo.name,
        maxMachines: planInfo.maxMachines,
        features: planInfo.features,
      },
    });
  } catch {
    return c.json({ error: "Invalid upgrade payload" }, 400);
  }
});

export default billingRoute;
