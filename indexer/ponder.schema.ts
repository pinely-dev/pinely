import { index, onchainTable } from "@ponder/core";

// PINELY Operators
export const operators = onchainTable("operators", (p) => ({
  id: p.text().primaryKey(), // Operator address lowercase
  guardian: p.text(),
  fleetFrozen: p.boolean().default(false).notNull(),
  displayName: p.text(),
  createdAt: p.bigint().notNull(),
}));

// PINELY Machines
export const machines = onchainTable(
  "machines",
  (p) => ({
    id: p.text().primaryKey(), // machineId hex
    account: p.text().notNull(),
    operator: p.text().notNull(),
    signer: p.text().notNull(),
    attestationHash: p.text(),
    attestationValid: p.boolean().default(false).notNull(),
    tier: p.integer().default(0).notNull(), // 0 = Bronze, 1 = Silver, 2 = Gold
    frozen: p.boolean().default(false).notNull(),
    maxStableOutPerSwap: p.bigint().default(0n).notNull(),
    dailyStableOutCap: p.bigint().default(0n).notNull(),
    policyEnabled: p.boolean().default(false).notNull(),
    registeredAt: p.bigint().notNull(),
    registeredBlock: p.bigint().notNull(),
    registeredTx: p.text().notNull(),
    lastActiveAt: p.bigint(),
    lastViolationAt: p.bigint(),
    deregistered: p.boolean().default(false).notNull(),
  }),
  (table) => ({
    operatorIdx: index("machines_operator_idx").on(table.operator),
    registeredAtIdx: index("machines_registered_at_idx").on(table.registeredAt),
  }),
);

// PINELY Swaps
export const swaps = onchainTable(
  "swaps",
  (p) => ({
    id: p.text().primaryKey(), // `${txHash}:${logIndex}`
    machineId: p.text().notNull(),
    account: p.text().notNull(),
    tokenIn: p.text().notNull(),
    tokenOut: p.text().notNull(),
    amountIn: p.bigint().notNull(),
    amountOut: p.bigint().notNull(),
    stableOut: p.bigint().notNull(),
    lpFee: p.bigint(),
    protocolFee: p.bigint(),
    tier: p.integer(),
    nonce: p.bigint(),
    txHash: p.text().notNull(),
    blockNumber: p.bigint().notNull(),
    blockTimestamp: p.bigint().notNull(),
  }),
  (table) => ({
    machineBlockIdx: index("swaps_machine_block_idx").on(table.machineId, table.blockTimestamp),
    accountIdx: index("swaps_account_idx").on(table.account),
  }),
);

// PINELY Daily Machine Spend Tracking
export const dailyMachineSpend = onchainTable(
  "daily_machine_spend",
  (p) => ({
    id: p.text().primaryKey(), // `${machineId}:${day}`
    machineId: p.text().notNull(),
    day: p.bigint().notNull(),
    stableOut: p.bigint().notNull(),
    totalToday: p.bigint().notNull(),
    blockTimestamp: p.bigint().notNull(),
  }),
  (table) => ({
    machineDayIdx: index("daily_spend_machine_day_idx").on(table.machineId, table.day),
  }),
);

// PINELY Protocol Fees
export const protocolFees = onchainTable(
  "protocol_fees",
  (p) => ({
    id: p.text().primaryKey(), // `${txHash}:${logIndex}`
    machineId: p.text().notNull(),
    amount: p.bigint().notNull(),
    txHash: p.text().notNull(),
    blockNumber: p.bigint().notNull(),
    blockTimestamp: p.bigint().notNull(),
  }),
  (table) => ({
    machineIdx: index("protocol_fees_machine_idx").on(table.machineId),
  }),
);

// PINELY Policy Violations
export const policyViolations = onchainTable("policy_violations", (p) => ({
  id: p.text().primaryKey(), // `${txHash}:${logIndex}`
  machineId: p.text().notNull(),
  evidenceHash: p.text().notNull(),
  reportedBy: p.text().notNull(),
  txHash: p.text().notNull(),
  blockTimestamp: p.bigint().notNull(),
}));

// PINELY Burns
export const burns = onchainTable("burns", (p) => ({
  id: p.text().primaryKey(),
  source: p.text().notNull(),
  amountPinely: p.bigint().notNull(),
  txHash: p.text().notNull(),
  blockTimestamp: p.bigint().notNull(),
}));

// PINELY Stakes
export const stakes = onchainTable("stakes", (p) => ({
  id: p.text().primaryKey(), // Operator address lowercase
  amountPinely: p.bigint().notNull(),
  unbondingAmount: p.bigint().default(0n).notNull(),
  unbondingUnlockTime: p.bigint().default(0n).notNull(),
  updatedAt: p.bigint().notNull(),
  txHash: p.text().notNull(),
}));

// PINELY Subscriptions (Fleet Pro & Pinely SDK)
export const subscriptions = onchainTable(
  "subscriptions",
  (p) => ({
    id: p.text().primaryKey(), // `${txHash}:${logIndex}`
    fleetId: p.text().notNull(),
    subscriber: p.text().notNull(),
    plan: p.text().notNull(), // 'FLEET_PRO' | 'SDK_DEVICE'
    deviceCount: p.integer().default(0).notNull(),
    months: p.bigint().notNull(),
    validUntil: p.bigint().notNull(),
    costStable: p.bigint().notNull(),
    txHash: p.text().notNull(),
    blockTimestamp: p.bigint().notNull(),
  }),
  (table) => ({
    fleetIdx: index("subscriptions_fleet_idx").on(table.fleetId),
    subscriberIdx: index("subscriptions_subscriber_idx").on(table.subscriber),
  }),
);

// PINELY Operator Fleet Plan Aggregates
export const fleetPlans = onchainTable("fleet_plans", (p) => ({
  id: p.text().primaryKey(), // fleetId lowercase hex
  owner: p.text().notNull(),
  fleetProValidUntil: p.bigint().default(0n).notNull(),
  sdkDevicesCovered: p.integer().default(0).notNull(),
  sdkValidUntil: p.bigint().default(0n).notNull(),
  totalSpentStable: p.bigint().default(0n).notNull(),
  updatedAt: p.bigint().notNull(),
}));

// PINELY Surplus Sweeps
export const sweeps = onchainTable(
  "sweeps",
  (p) => ({
    id: p.text().primaryKey(), // `${txHash}:${logIndex}`
    machineId: p.text().notNull(),
    account: p.text().notNull(),
    destination: p.text().notNull(),
    token: p.text().notNull(),
    amount: p.bigint().notNull(),
    reserveThreshold: p.bigint().notNull(),
    txHash: p.text().notNull(),
    blockTimestamp: p.bigint().notNull(),
  }),
  (table) => ({
    machineIdx: index("sweeps_machine_idx").on(table.machineId),
    destinationIdx: index("sweeps_destination_idx").on(table.destination),
  }),
);

// PINELY Paymaster Gas Charges
export const paymasterCharges = onchainTable(
  "paymaster_charges",
  (p) => ({
    id: p.text().primaryKey(), // `${txHash}:${logIndex}`
    account: p.text().notNull(),
    stableCharged: p.bigint().notNull(),
    actualGasCostWei: p.bigint().notNull(),
    txHash: p.text().notNull(),
    blockNumber: p.bigint().notNull(),
    blockTimestamp: p.bigint().notNull(),
  }),
  (table) => ({
    accountIdx: index("paymaster_charges_account_idx").on(table.account),
  }),
);
