import { ponder } from "@/generated";
import { findContractAddress } from "@pinely/shared/contracts";
import {
  burns,
  dailyMachineSpend,
  fleetPlans,
  machines,
  operators,
  paymasterCharges,
  policyViolations,
  protocolFees,
  stakes,
  subscriptions,
  swaps,
  sweeps,
} from "../ponder.schema";

// ponder.config.ts has already validated CHAIN_ID; here it is only read back.
const chainId = Number(process.env.CHAIN_ID);
const canonicalStablecoinAddress = findContractAddress(chainId, "STABLECOIN")?.toLowerCase();
if (!canonicalStablecoinAddress) {
  throw new Error(`[PINELY Ponder] Canonical stablecoin is not configured for chain ${chainId}.`);
}

// --- MachineRegistry Event Handlers ---

ponder.on("MachineRegistry:MachineRegistered", async ({ event, context }) => {
  const operatorAddress = event.args.operator.toLowerCase();

  // Make sure the operator record exists (idempotent against race conditions)
  const existingOperator = await context.db.find(operators, {
    id: operatorAddress,
  });

  if (!existingOperator) {
    try {
      await context.db.insert(operators).values({
        id: operatorAddress,
        guardian: null,
        fleetFrozen: false,
        displayName: `Operator ${operatorAddress.slice(0, 6)}`,
        createdAt: event.block.timestamp,
      });
    } catch {
      // Idempotent: the operator record was already saved by a sibling transaction
    }
  }

  // Save the new machine record
  await context.db.insert(machines).values({
    id: event.args.machineId,
    account: event.args.account.toLowerCase(),
    operator: operatorAddress,
    signer: event.args.signer.toLowerCase(),
    attestationHash: event.args.attestationHash,
    attestationValid: false,
    tier: 0, // Bronze
    frozen: false,
    maxStableOutPerSwap: 0n, // Updated from the on-chain PolicyUpdated event
    dailyStableOutCap: 0n, // Updated from the on-chain PolicyUpdated event
    policyEnabled: false,
    registeredAt: event.block.timestamp,
    registeredBlock: event.block.number,
    registeredTx: event.transaction.hash,
    lastActiveAt: event.block.timestamp,
  });
});

ponder.on("MachineRegistry:SignerUpdated", async ({ event, context }) => {
  await context.db.update(machines, { id: event.args.machineId }).set({
    signer: event.args.newSigner.toLowerCase(),
  });
});

ponder.on("MachineRegistry:PolicyUpdated", async ({ event, context }) => {
  await context.db.update(machines, { id: event.args.machineId }).set({
    maxStableOutPerSwap: BigInt(event.args.maxStableOutPerSwap),
    dailyStableOutCap: BigInt(event.args.dailyStableOutCap),
    policyEnabled: event.args.enabled,
  });
});

ponder.on("MachineRegistry:MachineFrozen", async ({ event, context }) => {
  await context.db.update(machines, { id: event.args.machineId }).set({
    frozen: true,
  });
});

ponder.on("MachineRegistry:MachineUnfrozen", async ({ event, context }) => {
  await context.db.update(machines, { id: event.args.machineId }).set({
    frozen: false,
  });
});

ponder.on("MachineRegistry:MachineOperatorTransferred", async ({ event, context }) => {
  const newOperatorAddress = event.args.newOperator.toLowerCase();

  const existingOperator = await context.db.find(operators, {
    id: newOperatorAddress,
  });

  if (!existingOperator) {
    try {
      await context.db.insert(operators).values({
        id: newOperatorAddress,
        guardian: null,
        fleetFrozen: false,
        displayName: `Operator ${newOperatorAddress.slice(0, 6)}`,
        createdAt: event.block.timestamp,
      });
    } catch {
      // Idempotent if the record is already saved
    }
  }

  await context.db.update(machines, { id: event.args.machineId }).set({
    operator: newOperatorAddress,
  });
});

ponder.on("MachineRegistry:MachineDeregistered", async ({ event, context }) => {
  await context.db.update(machines, { id: event.args.machineId }).set({
    deregistered: true,
  });
});

ponder.on("MachineRegistry:FleetFrozen", async ({ event, context }) => {
  const operatorAddress = event.args.operator.toLowerCase();
  // An operator can act before registering any machine (set a guardian, freeze an empty fleet).
  // `update` needs an existing row, so create it first instead of failing the handler.
  if (!(await context.db.find(operators, { id: operatorAddress }))) {
    try {
      await context.db.insert(operators).values({
        id: operatorAddress,
        guardian: null,
        fleetFrozen: false,
        displayName: `Operator ${operatorAddress.slice(0, 6)}`,
        createdAt: event.block.timestamp,
      });
    } catch {
      // Idempotent: another handler created the row first.
    }
  }
  await context.db.update(operators, { id: operatorAddress }).set({
    fleetFrozen: true,
  });
});

ponder.on("MachineRegistry:FleetUnfrozen", async ({ event, context }) => {
  const operatorAddress = event.args.operator.toLowerCase();
  // An operator can act before registering any machine (set a guardian, freeze an empty fleet).
  // `update` needs an existing row, so create it first instead of failing the handler.
  if (!(await context.db.find(operators, { id: operatorAddress }))) {
    try {
      await context.db.insert(operators).values({
        id: operatorAddress,
        guardian: null,
        fleetFrozen: false,
        displayName: `Operator ${operatorAddress.slice(0, 6)}`,
        createdAt: event.block.timestamp,
      });
    } catch {
      // Idempotent: another handler created the row first.
    }
  }
  await context.db.update(operators, { id: operatorAddress }).set({
    fleetFrozen: false,
  });
});

ponder.on("MachineRegistry:GuardianUpdated", async ({ event, context }) => {
  const operatorAddress = event.args.operator.toLowerCase();
  // An operator can act before registering any machine (set a guardian, freeze an empty fleet).
  // `update` needs an existing row, so create it first instead of failing the handler.
  if (!(await context.db.find(operators, { id: operatorAddress }))) {
    try {
      await context.db.insert(operators).values({
        id: operatorAddress,
        guardian: null,
        fleetFrozen: false,
        displayName: `Operator ${operatorAddress.slice(0, 6)}`,
        createdAt: event.block.timestamp,
      });
    } catch {
      // Idempotent: another handler created the row first.
    }
  }
  await context.db.update(operators, { id: operatorAddress }).set({
    guardian: event.args.guardian.toLowerCase(),
  });
});

ponder.on("MachineRegistry:AttestationUpdated", async ({ event, context }) => {
  const existingMachine = await context.db.find(machines, { id: event.args.machineId });
  let nextTier = existingMachine?.tier ?? 0;
  if (event.args.valid && nextTier < 1) {
    nextTier = 1; // Verified hardware attestation unlocks Silver tier access
  }
  await context.db.update(machines, { id: event.args.machineId }).set({
    attestationHash: event.args.attestationHash,
    attestationValid: event.args.valid,
    tier: nextTier,
  });
});

ponder.on("MachineRegistry:ViolationReported", async ({ event, context }) => {
  await context.db.insert(policyViolations).values({
    id: `${event.transaction.hash}:${event.log.logIndex}`,
    machineId: event.args.machineId,
    evidenceHash: event.args.evidenceHash,
    reportedBy: event.args.by.toLowerCase(),
    txHash: event.transaction.hash,
    blockTimestamp: event.block.timestamp,
  });

  await context.db.update(machines, { id: event.args.machineId }).set({
    lastViolationAt: event.block.timestamp,
    attestationValid: false,
    tier: 0,
  });
});

ponder.on("MachineRegistry:SpendConsumed", async ({ event, context }) => {
  const spendId = `${event.args.machineId}:${event.args.day}`;
  const existingSpend = await context.db.find(dailyMachineSpend, { id: spendId });

  if (existingSpend) {
    await context.db.update(dailyMachineSpend, { id: spendId }).set({
      stableOut: event.args.stablecoinOut,
      totalToday: event.args.totalToday,
      blockTimestamp: event.block.timestamp,
    });
  } else {
    await context.db.insert(dailyMachineSpend).values({
      id: spendId,
      machineId: event.args.machineId,
      day: event.args.day,
      stableOut: event.args.stablecoinOut,
      totalToday: event.args.totalToday,
      blockTimestamp: event.block.timestamp,
    });
  }
});

// --- PinelyRouter Event Handlers ---

ponder.on("PinelyRouter:MachineSwap", async ({ event, context }) => {
  const swapId = `${event.transaction.hash}:${event.log.logIndex}`;

  await context.db.insert(swaps).values({
    id: swapId,
    machineId: event.args.machineId,
    account: event.args.account.toLowerCase(),
    tokenIn: event.args.tokenIn.toLowerCase(),
    tokenOut: canonicalStablecoinAddress,
    amountIn: event.args.amountIn,
    amountOut: event.args.amountOut,
    stableOut: event.args.amountOut,
    protocolFee: event.args.protocolFee,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
  });

  // Update the machine's last-active timestamp
  const existingMachine = await context.db.find(machines, {
    id: event.args.machineId,
  });

  if (existingMachine) {
    await context.db.update(machines, { id: event.args.machineId }).set({
      lastActiveAt: event.block.timestamp,
    });
  }
});

// --- PinelyHook Event Handlers ---

ponder.on("PinelyHook:ProtocolFeeCollected", async ({ event, context }) => {
  await context.db.insert(protocolFees).values({
    id: `${event.transaction.hash}:${event.log.logIndex}`,
    machineId: event.args.machineId,
    amount: event.args.protocolFee,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
  });
});

// --- BurnVault Event Handlers ---

ponder.on("BurnVault:Burned", async ({ event, context }) => {
  await context.db.insert(burns).values({
    id: `${event.transaction.hash}:${event.log.logIndex}`,
    source: "BurnVault",
    amountPinely: event.args.amount,
    txHash: event.transaction.hash,
    blockTimestamp: event.block.timestamp,
  });
});

// --- PinelyStake Event Handlers ---

ponder.on("PinelyStake:Staked", async ({ event, context }) => {
  const operatorAddress = event.args.operator.toLowerCase();
  const existingStake = await context.db.find(stakes, { id: operatorAddress });

  if (existingStake) {
    await context.db.update(stakes, { id: operatorAddress }).set({
      amountPinely: existingStake.amountPinely + event.args.amount,
      updatedAt: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  } else {
    await context.db.insert(stakes).values({
      id: operatorAddress,
      amountPinely: event.args.amount,
      unbondingAmount: 0n,
      unbondingUnlockTime: 0n,
      updatedAt: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  }
});

ponder.on("PinelyStake:UnstakeRequested", async ({ event, context }) => {
  const operatorAddress = event.args.operator.toLowerCase();
  const existingStake = await context.db.find(stakes, { id: operatorAddress });

  if (existingStake) {
    const newActive =
      existingStake.amountPinely > event.args.amount
        ? existingStake.amountPinely - event.args.amount
        : 0n;
    await context.db.update(stakes, { id: operatorAddress }).set({
      amountPinely: newActive,
      unbondingAmount: existingStake.unbondingAmount + event.args.amount,
      unbondingUnlockTime: BigInt(event.args.unlockTime),
      updatedAt: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  }
});

ponder.on("PinelyStake:UnstakeCancelled", async ({ event, context }) => {
  const operatorAddress = event.args.operator.toLowerCase();
  const existingStake = await context.db.find(stakes, { id: operatorAddress });

  if (existingStake) {
    const newUnbonding =
      existingStake.unbondingAmount > event.args.amount
        ? existingStake.unbondingAmount - event.args.amount
        : 0n;
    await context.db.update(stakes, { id: operatorAddress }).set({
      amountPinely: existingStake.amountPinely + event.args.amount,
      unbondingAmount: newUnbonding,
      unbondingUnlockTime: 0n,
      updatedAt: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  }
});

ponder.on("PinelyStake:Withdrawn", async ({ event, context }) => {
  const operatorAddress = event.args.operator.toLowerCase();
  const existingStake = await context.db.find(stakes, { id: operatorAddress });

  if (existingStake) {
    const newUnbonding =
      existingStake.unbondingAmount > event.args.amount
        ? existingStake.unbondingAmount - event.args.amount
        : 0n;
    await context.db.update(stakes, { id: operatorAddress }).set({
      unbondingAmount: newUnbonding,
      unbondingUnlockTime: 0n,
      updatedAt: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  }
});

ponder.on("PinelyStake:Slashed", async ({ event, context }) => {
  const operatorAddress = event.args.operator.toLowerCase();
  const existingStake = await context.db.find(stakes, { id: operatorAddress });

  if (existingStake) {
    let remainingSlash = event.args.amount;
    let newActive = existingStake.amountPinely;
    let newUnbonding = existingStake.unbondingAmount;

    if (newActive >= remainingSlash) {
      newActive -= remainingSlash;
    } else {
      remainingSlash -= newActive;
      newActive = 0n;
      newUnbonding = newUnbonding > remainingSlash ? newUnbonding - remainingSlash : 0n;
    }

    await context.db.update(stakes, { id: operatorAddress }).set({
      amountPinely: newActive,
      unbondingAmount: newUnbonding,
      updatedAt: event.block.timestamp,
      txHash: event.transaction.hash,
    });
  }
});

// --- FleetSubscription Event Handlers ---

ponder.on("FleetSubscription:SubscribedFleetPro", async ({ event, context }) => {
  const fleetId = event.args.fleetId;
  const subscriber = event.args.operator.toLowerCase();

  await context.db.insert(subscriptions).values({
    id: `${event.transaction.hash}:${event.log.logIndex}`,
    fleetId,
    subscriber,
    plan: "FLEET_PRO",
    deviceCount: 0,
    months: event.args.months,
    validUntil: event.args.validUntil,
    costStable: event.args.amountPaid,
    txHash: event.transaction.hash,
    blockTimestamp: event.block.timestamp,
  });

  const existingPlan = await context.db.find(fleetPlans, { id: fleetId });
  if (existingPlan) {
    await context.db.update(fleetPlans, { id: fleetId }).set({
      owner: subscriber,
      fleetProValidUntil: event.args.validUntil,
      totalSpentStable: existingPlan.totalSpentStable + event.args.amountPaid,
      updatedAt: event.block.timestamp,
    });
  } else {
    await context.db.insert(fleetPlans).values({
      id: fleetId,
      owner: subscriber,
      fleetProValidUntil: event.args.validUntil,
      sdkDevicesCovered: 0,
      sdkValidUntil: 0n,
      totalSpentStable: event.args.amountPaid,
      updatedAt: event.block.timestamp,
    });
  }
});

ponder.on("FleetSubscription:SubscribedDevices", async ({ event, context }) => {
  const fleetId = event.args.fleetId;
  const subscriber = event.args.operator.toLowerCase();

  await context.db.insert(subscriptions).values({
    id: `${event.transaction.hash}:${event.log.logIndex}`,
    fleetId,
    subscriber,
    plan: "SDK_DEVICE",
    deviceCount: Number(event.args.deviceCount),
    months: event.args.months,
    validUntil: event.args.validUntil,
    costStable: event.args.amountPaid,
    txHash: event.transaction.hash,
    blockTimestamp: event.block.timestamp,
  });

  const existingPlan = await context.db.find(fleetPlans, { id: fleetId });
  if (existingPlan) {
    await context.db.update(fleetPlans, { id: fleetId }).set({
      owner: subscriber,
      sdkDevicesCovered: Number(event.args.deviceCount),
      sdkValidUntil: event.args.validUntil,
      totalSpentStable: existingPlan.totalSpentStable + event.args.amountPaid,
      updatedAt: event.block.timestamp,
    });
  } else {
    await context.db.insert(fleetPlans).values({
      id: fleetId,
      owner: subscriber,
      fleetProValidUntil: 0n,
      sdkDevicesCovered: Number(event.args.deviceCount),
      sdkValidUntil: event.args.validUntil,
      totalSpentStable: event.args.amountPaid,
      updatedAt: event.block.timestamp,
    });
  }
});

// --- SurplusSweeper Event Handlers ---

ponder.on("SurplusSweeper:SurplusSwept", async ({ event, context }) => {
  await context.db.insert(sweeps).values({
    id: `${event.transaction.hash}:${event.log.logIndex}`,
    machineId: event.args.machineId,
    account: event.args.account.toLowerCase(),
    destination: event.args.destination.toLowerCase(),
    token: event.args.token.toLowerCase(),
    amount: event.args.surplusAmount,
    reserveThreshold: event.args.reserveRemaining,
    txHash: event.transaction.hash,
    blockTimestamp: event.block.timestamp,
  });
});

// --- PinelyPaymaster Event Handlers ---

ponder.on("PinelyPaymaster:GasCharged", async ({ event, context }) => {
  await context.db.insert(paymasterCharges).values({
    id: `${event.transaction.hash}:${event.log.logIndex}`,
    account: event.args.account.toLowerCase(),
    stableCharged: event.args.stablecoinCharged,
    actualGasCostWei: event.args.actualGasCostWei,
    txHash: event.transaction.hash,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
  });
});
