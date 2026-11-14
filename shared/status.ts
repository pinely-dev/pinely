// Single source of truth for "what is live and what is not".
//
// Every badge, banner, roadmap card and status page reads from here, so two pages can never disagree.
//
// Two kinds of entries:
//   - DERIVED: computed from the address book (`contracts/addresses.ts`, `contracts/external.ts`). They flip
//     by themselves the moment an address is synced, and they cannot claim "live" without an address.
//   - HAND-SET: facts no address can prove (audit, hardware keys, the first machine UserOperation, the
//     mainnet indexer). Each carries the date it was last checked. Update STATUS_AS_OF when you re-check them.
import { robinhoodMainnet } from "./chains";
import { findContractAddress, resolvePinelyTokenCa } from "./contracts";

/** Date the hand-set facts below were last checked. */
export const STATUS_AS_OF = "2026-11-14";

/** `live` = running and verifiable; `pending` = in progress; `not-deployed` = nothing onchain yet;
 *  `planned` = designed, not built; `none` = does not exist. */
export type StatusLevel = "live" | "pending" | "not-deployed" | "planned" | "none";

export type StatusId =
  | "stage1-mainnet"
  | "token"
  | "userop-mainnet"
  | "indexer-mainnet"
  | "stage2"
  | "audit"
  | "hardware-keys"
  | "spend-cap-onchain";

export interface StatusEntry {
  id: StatusId;
  label: string;
  level: StatusLevel;
  /** One plain sentence. Never a guarantee. */
  detail: string;
  /** `derived` entries follow the address book; `hand-set` entries were checked by a person on `STATUS_AS_OF`. */
  source: "derived" | "hand-set";
}

/** Chain where the production contracts and the $PINELY token live. */
const MAINNET_ID = robinhoodMainnet.id;

const STAGE_1_CONTRACTS = [
  "MachineRegistry",
  "PinelyAccountFactory",
  "PinelyPaymaster",
  "SurplusSweeper",
] as const;

const STAGE_2_CONTRACTS = ["PinelyHook", "PinelyRouter", "BurnVault", "PinelyStake"] as const;

function deployedCount(names: readonly string[]): number {
  return names.filter((name) => findContractAddress(MAINNET_ID, name) !== undefined).length;
}

function stage1(): StatusEntry {
  const count = deployedCount(STAGE_1_CONTRACTS);
  if (count === STAGE_1_CONTRACTS.length) {
    return {
      id: "stage1-mainnet",
      label: "Stage 1 on mainnet",
      level: "live",
      source: "derived",
      detail:
        "MachineRegistry, PinelyAccountFactory, PinelyPaymaster and SurplusSweeper are deployed on Robinhood Chain Mainnet. Unaudited.",
    };
  }
  return {
    id: "stage1-mainnet",
    label: "Stage 1 on mainnet",
    level: count === 0 ? "not-deployed" : "pending",
    source: "derived",
    detail: `${count} of ${STAGE_1_CONTRACTS.length} Stage 1 contracts have a mainnet address.`,
  };
}

function token(): StatusEntry {
  const ca = resolvePinelyTokenCa(MAINNET_ID);
  return {
    id: "token",
    label: "$PINELY token",
    level: ca.status === "live" ? "live" : "not-deployed",
    source: "derived",
    detail:
      ca.status === "live"
        ? "The $PINELY token contract exists on Robinhood Chain Mainnet."
        : "No $PINELY token address is configured.",
  };
}

function stage2(): StatusEntry {
  const count = deployedCount(STAGE_2_CONTRACTS);
  const level: StatusLevel =
    count === 0 ? "not-deployed" : count === STAGE_2_CONTRACTS.length ? "live" : "pending";
  return {
    id: "stage2",
    label: "Stage 2 (Hook, Router, Burn, Stake)",
    level,
    source: "derived",
    detail:
      level === "not-deployed"
        ? "PinelyHook, PinelyRouter, BurnVault and PinelyStake are not deployed on mainnet. Nothing is staked or burned onchain."
        : `${count} of ${STAGE_2_CONTRACTS.length} Stage 2 contracts have a mainnet address.`,
  };
}

function spendCap(): StatusEntry {
  const hookLive = findContractAddress(MAINNET_ID, "PinelyHook") !== undefined;
  return {
    id: "spend-cap-onchain",
    label: "Onchain spend cap",
    level: hookLive ? "live" : "not-deployed",
    source: "derived",
    detail: hookLive
      ? "The daily limit is enforced onchain by PinelyHook."
      : "Stage 1 has no onchain spend cap. The daily limit is enforced by PinelyHook, which is a Stage 2 contract.",
  };
}

/** Hand-set facts. Re-check them, then bump STATUS_AS_OF. */
const HAND_SET: Record<
  "userop-mainnet" | "indexer-mainnet" | "audit" | "hardware-keys",
  StatusEntry
> = {
  "userop-mainnet": {
    id: "userop-mainnet",
    label: "First machine UserOperation on mainnet",
    level: "pending",
    source: "hand-set",
    detail: "No machine UserOperation has been recorded on mainnet yet.",
  },
  "indexer-mainnet": {
    id: "indexer-mainnet",
    label: "App, API and indexer",
    level: "pending",
    source: "hand-set",
    detail:
      "The website is live. The PINELY indexer for Robinhood Chain Mainnet is being deployed, so machine data is not available yet.",
  },
  audit: {
    id: "audit",
    label: "External audit",
    level: "none",
    source: "hand-set",
    detail: "The contracts have not been externally audited.",
  },
  "hardware-keys": {
    id: "hardware-keys",
    label: "Hardware key storage",
    level: "planned",
    source: "hand-set",
    detail:
      "Machine keys are software keys today. TPM and Secure Element storage is planned, not available.",
  },
};

/** The status of every tracked component. */
export const platformStatus: Record<StatusId, StatusEntry> = {
  "stage1-mainnet": stage1(),
  token: token(),
  "userop-mainnet": HAND_SET["userop-mainnet"],
  "indexer-mainnet": HAND_SET["indexer-mainnet"],
  stage2: stage2(),
  audit: HAND_SET.audit,
  "hardware-keys": HAND_SET["hardware-keys"],
  "spend-cap-onchain": spendCap(),
};

/**
 * Who owns each Stage 1 contract on mainnet. Hand-set: read from the chain on STATUS_AS_OF (`owner()` of
 * MachineRegistry and PinelyPaymaster is the protocol Safe; PinelyAccountFactory and SurplusSweeper have no
 * owner role). The address book cannot prove this, so re-check it before editing.
 */
export const MAINNET_CONTRACT_OWNERS: Record<string, "safe" | "none"> = {
  MachineRegistry: "safe",
  PinelyPaymaster: "safe",
  PinelyAccountFactory: "none",
  SurplusSweeper: "none",
};

/** Safe multisig that owns the protocol contracts: `getThreshold()` and the number of owners, read on STATUS_AS_OF. */
export const PROTOCOL_SAFE = { threshold: 2, owners: 3 } as const;

/** The one line every page shows about audits and risk. */
export const RISK_DISCLAIMER =
  "Contracts are unaudited. $PINELY carries risk of total loss. Not investment advice.";
