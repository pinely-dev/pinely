import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const APP_SCHEMA = process.env.DATABASE_SCHEMA ?? "app";
const PONDER_SCHEMA = process.env.PONDER_SCHEMA ?? "ponder";

/**
 * `search_path` points at the `app` schema so unprefixed queries stay in the backend's own schema.
 * Indexer tables are always addressed with the `ponder.` prefix and are read-only.
 *
 * There is deliberately no fallback URL: copy `.env.example` to `.env` for local development.
 */
function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (url) return url;
  throw new Error("[PINELY] DATABASE_URL must be set (see backend/.env.example).");
}

export const pool = new Pool({
  connectionString: getDatabaseUrl(),
  max: Number(process.env.DATABASE_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  application_name: "pinely-backend",
  options: `-c search_path=${APP_SCHEMA},public`,
});

export const db = drizzle(pool);

export type DatabaseStatus = {
  ok: boolean;
  latencyMs: number;
  schemas: {
    app: boolean;
    ponder: boolean;
  };
  error?: string;
};

export async function ensureSchemas(): Promise<void> {
  await pool.query(`create schema if not exists "${APP_SCHEMA}"`);
  await pool.query(`create schema if not exists "${PONDER_SCHEMA}"`);
  await pool.query(`
    create table if not exists "${APP_SCHEMA}".fleet_subscriptions (
      operator text primary key,
      plan text not null default 'free',
      max_machines integer not null default 5,
      monthly_quota_stable text not null default '100.00',
      features jsonb not null default '[]'::jsonb,
      renews_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create table if not exists "${APP_SCHEMA}".facilitator_settlements (
      id text primary key,
      machine_id text not null,
      nonce text not null,
      recipient text not null,
      amount text not null,
      rail text not null,
      tx_hash text,
      status text not null default 'settled',
      created_at timestamptz not null default now()
    );
    create unique index if not exists settlements_machine_nonce_idx
      on "${APP_SCHEMA}".facilitator_settlements (machine_id, nonce);
    create table if not exists "${APP_SCHEMA}".pilot_applications (
      id serial primary key,
      operator_name text not null,
      machine_type text not null,
      device_count integer not null,
      email text not null,
      status text not null default 'new',
      created_at timestamptz not null default now()
    );
    alter table "${APP_SCHEMA}".pilot_applications add column if not exists organization text;
    alter table "${APP_SCHEMA}".pilot_applications add column if not exists hardware_enclave text;
    alter table "${APP_SCHEMA}".pilot_applications add column if not exists notes text;

    -- Ponder schema baseline DDL for staging & production (empty tables, zero sample data)
    create table if not exists "${PONDER_SCHEMA}".operators (
      id text primary key,
      guardian text,
      fleet_frozen boolean not null default false,
      display_name text,
      created_at bigint not null default 0
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
      registered_at bigint not null default 0,
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
      amount_in bigint not null default 0,
      amount_out bigint not null default 0,
      stable_out bigint not null default 0,
      lp_fee bigint,
      protocol_fee bigint,
      tier integer,
      nonce bigint,
      tx_hash text not null default '',
      block_number bigint not null default 1,
      block_timestamp bigint not null default 0
    );

    create table if not exists "${PONDER_SCHEMA}".burns (
      id text primary key,
      source text not null,
      amount_pinely numeric not null default 0,
      tx_hash text not null default '',
      block_timestamp bigint not null default 0
    );

    create table if not exists "${PONDER_SCHEMA}".policy_violations (
      id text primary key,
      machine_id text not null,
      evidence_hash text not null,
      reported_by text not null,
      tx_hash text not null default '',
      block_number bigint not null default 1,
      block_timestamp bigint not null default 0
    );

    create table if not exists "${PONDER_SCHEMA}".daily_machine_spend (
      id text primary key,
      machine_id text not null,
      day bigint not null default 0,
      stable_out bigint not null default 0,
      total_today bigint not null default 0,
      block_timestamp bigint not null default 0
    );

    create table if not exists "${PONDER_SCHEMA}".protocol_fees (
      id text primary key,
      machine_id text not null,
      amount numeric not null default 0,
      tx_hash text not null default '',
      block_number bigint not null default 1,
      block_timestamp bigint not null default 0
    );

    create table if not exists "${PONDER_SCHEMA}".stakes (
      id text primary key,
      operator text not null,
      staked_pinely numeric not null default 0,
      tier integer not null default 0,
      cooldown_until bigint not null default 0,
      unbonding_amount numeric not null default 0,
      updated_at bigint not null default 0
    );

    create table if not exists "${PONDER_SCHEMA}".subscriptions (
      id text primary key,
      operator text not null,
      plan_id bigint not null default 0,
      active boolean not null default false,
      started_at bigint not null default 0,
      expires_at bigint not null default 0
    );

    create table if not exists "${PONDER_SCHEMA}".fleet_plans (
      id text primary key,
      fee_stable numeric not null default 0,
      duration_days bigint not null default 30,
      max_machines bigint not null default 5,
      active boolean not null default true
    );

    create table if not exists "${PONDER_SCHEMA}".sweeps (
      id text primary key,
      machine_id text not null,
      token text not null,
      amount numeric not null default 0,
      destination text not null,
      tx_hash text not null default '',
      block_timestamp bigint not null default 0
    );

    create table if not exists "${PONDER_SCHEMA}".paymaster_charges (
      id text primary key,
      machine_account text not null,
      gas_used bigint not null default 0,
      stable_debited numeric not null default 0,
      tx_hash text not null default '',
      block_timestamp bigint not null default 0
    );
  `);
}

export async function checkDatabase(): Promise<DatabaseStatus> {
  const startedAt = Date.now();

  try {
    await pool.query("select 1");

    const { rows } = await pool.query<{ schema_name: string }>(
      "select schema_name from information_schema.schemata where schema_name = any($1::text[])",
      [[APP_SCHEMA, PONDER_SCHEMA]],
    );
    const found = new Set(rows.map((row) => row.schema_name));
    const schemas = {
      app: found.has(APP_SCHEMA),
      ponder: found.has(PONDER_SCHEMA),
    };
    const requirePonder = process.env.RUN_INDEXER === "true";

    return {
      ok: schemas.app && (!requirePonder || schemas.ponder),
      latencyMs: Date.now() - startedAt,
      schemas,
    };
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      schemas: { app: false, ponder: false },
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}

export { APP_SCHEMA, PONDER_SCHEMA };
