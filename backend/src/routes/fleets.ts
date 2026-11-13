import { Hono } from "hono";
import { queryIndexer } from "../lib/indexer";

const fleetsRoute = new Hono();

/**
 * GET /api/fleets/:operator/summary
 * Gets the metrics summary of a given operator's fleet.
 */
fleetsRoute.get("/:operator/summary", async (c) => {
  const operator = c.req.param("operator").toLowerCase();

  // Info operator
  const operatorQuery = `
      select 
        id as "operator",
        guardian,
        fleet_frozen as "fleetFrozen",
        display_name as "displayName",
        created_at as "createdAt"
      from ponder.operators
      where id = $1
    `;
  const { rows: opRows } = await queryIndexer(operatorQuery, [operator]);

  // Fleet machine summary
  const machinesQuery = `
      select 
        count(*) as "totalMachines",
        count(*) filter (where not frozen) as "activeMachines",
        count(*) filter (where frozen) as "frozenMachines",
        count(*) filter (where tier = 0) as "bronzeCount",
        count(*) filter (where tier = 1) as "silverCount",
        count(*) filter (where tier = 2) as "goldCount"
      from ponder.machines
      where operator = $1
    `;
  const { rows: mRows } = await queryIndexer(machinesQuery, [operator]);

  // Total fleet swap volume
  const swapQuery = `
      select 
        coalesce(sum(s.stable_out), 0) as "totalStableOut",
        count(s.id) as "totalSwaps"
      from ponder.swaps s
      join ponder.machines m on m.id = s.machine_id
      where m.operator = $1
    `;
  const { rows: sRows } = await queryIndexer(swapQuery, [operator]);

  return c.json({
    data: {
      operator,
      // null when the indexer has not seen this operator yet; never an invented profile.
      profile: opRows[0] ?? null,
      fleet: mRows[0] ?? {
        totalMachines: 0,
        activeMachines: 0,
        frozenMachines: 0,
        bronzeCount: 0,
        silverCount: 0,
        goldCount: 0,
      },
      volume: sRows[0] ?? {
        totalStableOut: "0",
        totalSwaps: 0,
      },
    },
  });
});

/**
 * GET /api/fleets/:operator/violations
 * Gets the list of policy violation incidents for the operator's fleet.
 */
fleetsRoute.get("/:operator/violations", async (c) => {
  const operator = c.req.param("operator").toLowerCase();

  const query = `
      select 
        v.id,
        v.machine_id as "machineId",
        v.evidence_hash as "evidenceHash",
        v.reported_by as "reportedBy",
        v.tx_hash as "txHash",
        v.block_timestamp as "blockTimestamp"
      from ponder.policy_violations v
      join ponder.machines m on m.id = v.machine_id
      where m.operator = $1
      order by v.block_timestamp desc
      limit 50
    `;
  const { rows } = await queryIndexer(query, [operator]);

  return c.json({
    data: rows,
    meta: { count: rows.length },
  });
});

export default fleetsRoute;
