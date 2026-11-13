import "dotenv/config";
import { pool, ensureSchemas } from "../src/db/connection";

const APP_SCHEMA = process.env.DATABASE_SCHEMA ?? "app";
const PONDER_SCHEMA = process.env.PONDER_SCHEMA ?? "ponder";

async function seed() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to seed sample data in production.");
    process.exit(1);
  }

  console.log(`🌱 Seeding the PINELY database (schema: ${APP_SCHEMA} & ${PONDER_SCHEMA})...`);

  try {
    // 1. Verify the connection
    await pool.query("select 1");
    console.log("✔ Connected to PostgreSQL.");

    // 2. Create the schemas and tables if they do not exist
    await ensureSchemas();
    await pool.query(`create schema if not exists "${PONDER_SCHEMA}"`);

    // Make sure the base ponder tables exist for staging when ponder has not synced from the start block
    await pool.query(`
      create table if not exists "${PONDER_SCHEMA}".operators (
        id text primary key,
        guardian text,
        fleet_frozen boolean not null default false,
        display_name text,
        created_at bigint not null
      );

      create table if not exists "${PONDER_SCHEMA}".machines (
        id text primary key,
        account text not null,
        operator text not null,
        signer text not null,
        attestation_hash text,
        attestation_valid boolean not null default false,
        tier integer not null default 0,
        frozen boolean not null default false,
        max_stable_out_per_swap bigint not null default 0,
        daily_stable_out_cap bigint not null default 0,
        policy_enabled boolean not null default false,
        registered_at bigint not null,
        registered_block bigint not null default 1,
        registered_tx text not null default '0x0',
        last_active_at bigint,
        last_violation_at bigint,
        deregistered boolean not null default false
      );
      alter table "${PONDER_SCHEMA}".machines add column if not exists deregistered boolean not null default false;
      alter table "${PONDER_SCHEMA}".machines add column if not exists last_violation_at bigint;

      create table if not exists "${PONDER_SCHEMA}".swaps (
        id text primary key,
        machine_id text not null,
        account text not null,
        token_in text not null,
        token_out text not null,
        amount_in bigint not null,
        amount_out bigint not null,
        stable_out bigint not null,
        lp_fee bigint,
        protocol_fee bigint,
        tier integer,
        nonce bigint,
        tx_hash text not null,
        block_number bigint not null default 1,
        block_timestamp bigint not null
      );

      create table if not exists "${PONDER_SCHEMA}".burns (
        id text primary key,
        source text not null,
        amount_pinely numeric not null,
        tx_hash text not null,
        block_timestamp bigint not null
      );

      create table if not exists "${PONDER_SCHEMA}".policy_violations (
        id text primary key,
        machine_id text not null,
        evidence_hash text not null,
        reported_by text not null,
        tx_hash text not null,
        block_number bigint not null default 1,
        block_timestamp bigint not null
      );

      create table if not exists "${PONDER_SCHEMA}".daily_machine_spend (
        id text primary key,
        machine_id text not null,
        day bigint not null,
        stable_out bigint not null,
        total_today bigint not null,
        block_timestamp bigint not null
      );
    `);
    console.log("✔ Skema & tabel database tervalidasi.");

    const now = Math.floor(Date.now() / 1000);
    const dayAgo = now - 86400;
    const weekAgo = now - 7 * 86400;

    const operator1 = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
    const operator2 = "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc";

    // 3. Seed Operators
    await pool.query(
      `
      insert into "${PONDER_SCHEMA}".operators (id, guardian, fleet_frozen, display_name, created_at)
      values 
        ($1, $2, false, 'Alpha Autonomous Fleet', $3),
        ($4, null, false, 'Neo Robotics Corp', $5)
      on conflict (id) do update set
        display_name = excluded.display_name;
    `,
      [
        operator1,
        "0x15d34aaf54267db7d7c367839aaf71a00a2c6a65",
        BigInt(weekAgo),
        operator2,
        BigInt(weekAgo),
      ],
    );
    console.log("✔ Operator profiles seeded.");

    // 4. Seed Machines
    const sampleMachines = [
      {
        id: "0x945ebb5391f1f3ec0eaf55d0bd160c4bc4df67364d7e08086e5c1b2bf39fc3c1",
        account: "0x88880000000000000000000000000000f39fd6e5",
        operator: operator1,
        signer: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
        attestationHash: "0x0cdf3a9ae8168f084e69e21afacd60f43271e7fd2f8bb6b69dc4ccb4261f08a5",
        attestationValid: true,
        tier: 2, // Gold
        frozen: false,
        maxStable: 25_000_000n, // $25
        dailyCap: 100_000_000n, // $100
        registeredAt: BigInt(weekAgo),
      },
      {
        id: "0xa11ce00000000000000000000000000000000000000000000000000000000001",
        account: "0x8888000000000000000000000000000000000001",
        operator: operator1,
        signer: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
        attestationHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        attestationValid: true,
        tier: 1, // Silver
        frozen: false,
        maxStable: 15_000_000n,
        dailyCap: 60_000_000n,
        registeredAt: BigInt(weekAgo + 86400),
      },
      {
        id: "0xb22ce00000000000000000000000000000000000000000000000000000000002",
        account: "0x8888000000000000000000000000000000000002",
        operator: operator1,
        signer: "0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc",
        attestationHash: null,
        attestationValid: false,
        tier: 0, // Bronze
        frozen: false,
        maxStable: 10_000_000n,
        dailyCap: 50_000_000n,
        registeredAt: BigInt(dayAgo),
      },
      {
        id: "0xc33ce00000000000000000000000000000000000000000000000000000000003",
        account: "0x8888000000000000000000000000000000000003",
        operator: operator2,
        signer: "0x90f79bf6eb2c4f870365e785982e1f101e93b906",
        attestationHash: "0x0000000000000000000000000000000000000000000000000000000000000003",
        attestationValid: true,
        tier: 1,
        frozen: false,
        maxStable: 10_000_000n,
        dailyCap: 40_000_000n,
        registeredAt: BigInt(weekAgo),
      },
    ];

    for (const m of sampleMachines) {
      await pool.query(
        `
        insert into "${PONDER_SCHEMA}".machines (
          id, account, operator, signer, attestation_hash, attestation_valid,
          tier, frozen, max_stable_out_per_swap, daily_stable_out_cap, policy_enabled,
          registered_at, registered_block, registered_tx, last_active_at
        ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true, $11, 147007192, '0xsample_tx', $12)
        on conflict (id) do update set
          tier = excluded.tier,
          frozen = excluded.frozen,
          last_active_at = excluded.last_active_at;
      `,
        [
          m.id,
          m.account,
          m.operator,
          m.signer,
          m.attestationHash,
          m.attestationValid,
          m.tier,
          m.frozen,
          m.maxStable,
          m.dailyCap,
          m.registeredAt,
          BigInt(now - 300),
        ],
      );
    }
    console.log(`✔ ${sampleMachines.length} sample machines seeded.`);

    // 5. Seed Swaps
    await pool.query(`
      insert into "${PONDER_SCHEMA}".swaps (
        id, machine_id, account, token_in, token_out, amount_in, amount_out, stable_out,
        lp_fee, protocol_fee, tier, nonce, tx_hash, block_number, block_timestamp
      ) values 
        ('0xsample_swap_1', '${sampleMachines[0].id}', '${sampleMachines[0].account}', '0x7777777777777777777777777777777777777777', '0x4444444444444444444444444444444444444444', 20000000, 19930000, 19930000, 60000, 10000, 2, 1, '0xtx1', 147007200, ${now - 3600}),
        ('0xsample_swap_2', '${sampleMachines[1].id}', '${sampleMachines[1].account}', '0x7777777777777777777777777777777777777777', '0x4444444444444444444444444444444444444444', 12000000, 11964000, 11964000, 18000, 6000, 1, 2, '0xtx2', 147007210, ${now - 7200})
      on conflict (id) do nothing;
    `);
    console.log("✔ Sample swap events seeded.");

    // 6. Seed Burns
    await pool.query(`
      insert into "${PONDER_SCHEMA}".burns (
        id, source, amount_pinely, tx_hash, block_timestamp
      ) values
        ('0xburn_1', 'protocol_fee', 500000000000000000000, '0xburntx1', ${now - 86400}),
        ('0xburn_2', 'creator_fee', 750000000000000000000, '0xburntx2', ${now - 43200})
      on conflict (id) do nothing;
    `);
    console.log("✔ Sample burn events seeded.");

    // 7. Seed Subscriptions (app schema)
    await pool.query(`
      insert into "${APP_SCHEMA}".fleet_subscriptions (
        operator, plan, max_machines, monthly_quota_stable, features, renews_at
      ) values 
        ('${operator1}', 'pro', 25, '500.00', '["mass_kill_switch", "policy_editor", "surplus_sweeper", "csv_export"]'::jsonb, now() + interval '30 days')
      on conflict (operator) do update set
        plan = excluded.plan;
    `);
    console.log("✔ Fleet subscription seeded in app schema.");

    console.log("\n🎉 Database seeding finished successfully!");
    process.exit(0);
  } catch (err) {
    console.warn("⚠ Seeding skipped or failed:", err instanceof Error ? err.message : err);
    console.warn("  (Make sure PostgreSQL is running to test seeding locally / on staging)");
    process.exit(0);
  }
}

seed();
