import { Hono } from "hono";
import type { ApiMeta, BurnSources } from "@pinely/shared/types";
import { getChainProfile } from "@pinely/shared/chains";
import { getBackendChainId } from "../lib/config";
import { queryIndexer } from "../lib/indexer";

const burnsRoute = new Hono();

/**
 * GET /api/burns
 * Returns the history of $PINELY burn events from the indexer.
 * An unreachable indexer answers 503; an empty list means no burn has happened yet.
 */
burnsRoute.get("/", async (c) => {
  const requested = Math.trunc(Number(c.req.query("limit") ?? 50));
  const limit = Number.isFinite(requested) && requested >= 1 ? Math.min(requested, 100) : 50;

  const query = `
    select
      id,
      source,
      amount_pinely as "amountPinely",
      tx_hash as "txHash",
      block_timestamp as "blockTimestamp"
    from ponder.burns
    order by block_timestamp desc
    limit $1
  `;
  const { rows } = await queryIndexer(query, [limit]);

  return c.json({
    data: rows,
    meta: { count: rows.length, limit, indexer: "ready" },
  });
});

/**
 * GET /api/burns/summary
 * Returns the total $PINELY burned permanently, as seen by the indexer.
 */
burnsRoute.get("/summary", async (c) => {
  const query = `
    select
      coalesce(sum(amount_pinely), 0) as "totalPinelyBurned",
      count(*) as "totalBurnEvents"
    from ponder.burns
  `;
  const { rows } = await queryIndexer(query);

  return c.json({
    data: rows[0],
    meta: { indexer: "ready" },
  });
});

/**
 * Share of a fee that reaches the BurnVault, in basis points. It mirrors the contracts: the Router
 * sends 20% of each protocol fee and FleetSubscription sends 20% of each payment (`BURN_BPS`).
 * If a contract changes this value, this constant and its test must change with it.
 */
export const BURN_SHARE_BPS = 2000;

/**
 * GET /api/burns/sources
 * Breaks down money routed to the BurnVault by where it came from. Only sources the indexer can
 * measure exactly carry an amount; the others are listed as untracked with the reason, never as 0.
 * Each share is floored per event, the same rounding the contracts apply.
 */
burnsRoute.get("/sources", async (c) => {
  const query = `
    select
      (select coalesce(sum(floor(protocol_fee * $1::numeric / 10000)), 0)::text
         from ponder.swaps where protocol_fee > 0) as "protocolFee",
      (select count(*)::int from ponder.swaps where protocol_fee > 0) as "protocolFeeCount",
      (select coalesce(sum(floor(cost_stable * $1::numeric / 10000)), 0)::text
         from ponder.subscriptions) as "subscription",
      (select count(*)::int from ponder.subscriptions) as "subscriptionCount",
      (select coalesce(sum(amount_pinely), 0)::text from ponder.burns) as "burnedPinely"
  `;
  const { rows } = await queryIndexer<{
    protocolFee: string;
    protocolFeeCount: number;
    subscription: string;
    subscriptionCount: number;
    burnedPinely: string;
  }>(query, [BURN_SHARE_BPS]);
  const row = rows[0];
  const stablecoinSymbol = getChainProfile(getBackendChainId()).stablecoinSymbol;

  const data: BurnSources = {
    burnedPinely: row.burnedPinely,
    inflows: [
      {
        key: "protocol_fee",
        label: "Hook protocol fee",
        token: stablecoinSymbol,
        tracked: true,
        amount: row.protocolFee,
        count: row.protocolFeeCount,
      },
      {
        key: "fleet_subscription",
        label: "Fleet Pro & SDK subscriptions",
        token: stablecoinSymbol,
        tracked: true,
        amount: row.subscription,
        count: row.subscriptionCount,
      },
      // The CreatorFeeSplitter is not in the indexer config yet.
      {
        key: "creator_fee",
        label: "Creator fee splitter",
        token: stablecoinSymbol,
        tracked: false,
        reason: "not_indexed",
      },
      // `MachineRegistered` does not carry the fee that was charged, and the fee can change over time.
      {
        key: "registration_fee",
        label: "Machine registration fees",
        token: stablecoinSymbol,
        tracked: false,
        reason: "no_event_amount",
      },
      // The indexer updates the stake on `Slashed` but does not record the slashed amount.
      {
        key: "stake_slash",
        label: "Stake slashing",
        token: "PINELY",
        tracked: false,
        reason: "not_indexed",
      },
    ],
  };

  return c.json({ data, meta: { indexer: "ready" } satisfies ApiMeta });
});

export default burnsRoute;
