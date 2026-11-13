import { integer, jsonb, pgSchema, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const appSchema = pgSchema("app");

/**
 * app.fleet_subscriptions
 * Stores the subscription status of PINELY fleet operators (Free, Pro, Enterprise).
 */
export const fleetSubscriptions = appSchema.table("fleet_subscriptions", {
  operator: text("operator").primaryKey(), // normalized lowercase address
  plan: text("plan").notNull().default("free"), // 'free' | 'pro' | 'enterprise'
  maxMachines: integer("max_machines").notNull().default(5),
  monthlyQuotaStable: text("monthly_quota_stable").notNull().default("100.00"),
  features: jsonb("features").notNull().$type<string[]>(),
  renewsAt: timestamp("renews_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * app.facilitator_settlements
 * Stores the persistent log of x402 autonomous machine payment settlements (EIP-3009 / ERC-4337).
 */
export const facilitatorSettlements = appSchema.table(
  "facilitator_settlements",
  {
    id: text("id").primaryKey(), // `${machineId}:${nonce}`
    machineId: text("machine_id").notNull(),
    nonce: text("nonce").notNull(),
    recipient: text("recipient").notNull(),
    amount: text("amount").notNull(),
    rail: text("rail").notNull(), // 'eip3009' | 'erc4337-paymaster'
    txHash: text("tx_hash"),
    status: text("status").notNull().default("settled"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    machineNonceIdx: uniqueIndex("settlements_machine_nonce_idx").on(table.machineId, table.nonce),
  }),
);

export type FleetSubscription = typeof fleetSubscriptions.$inferSelect;
export type NewFleetSubscription = typeof fleetSubscriptions.$inferInsert;
export type FacilitatorSettlement = typeof facilitatorSettlements.$inferSelect;
export type NewFacilitatorSettlement = typeof facilitatorSettlements.$inferInsert;
