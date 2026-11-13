/**
 * Response contract shared by the backend routes and the frontend API client. Aggregates that
 * PostgreSQL returns as `bigint` (`count(*)`, `sum(...)`) arrive as strings, so numeric fields are
 * typed `string | number` and must be converted with `Number()` / `BigInt()` at the call site.
 */

/** `ready` is reported only when the indexer answered the query. An unreachable indexer is HTTP 503. */
export type IndexerState = "ready";

export interface ApiMeta {
  indexer?: IndexerState;
  count?: number;
  total?: number;
  page?: number;
  limit?: number;
}

/** Body of a non-2xx response. `error` is a stable machine-readable code or a short message. */
export interface ApiErrorBody {
  error: string;
  message?: string;
}

export interface EcosystemStats {
  totalMachines: string | number;
  activeMachines: string | number;
  totalStableSwapped: string | number;
  totalSwaps: string | number;
  totalProtocolFees: string | number;
  totalOperators: string | number;
}

export interface FleetProfile {
  operator: string;
  guardian: string | null;
  fleetFrozen: boolean;
  displayName: string | null;
  createdAt: string | number | null;
}

/** One unsigned transaction the operator wallet must sign and send. */
export interface PreparedTransaction {
  to: `0x${string}`;
  data: `0x${string}`;
  /** Native value in wei, as a decimal string. */
  value: string;
  chainId: number;
  description: string;
}

/** Response of every prepare route under `/api/actions`: the transaction, plus an optional first step. */
export interface PreparedAction extends PreparedTransaction {
  /** Must be mined before `data` (for example the stablecoin approval for the registration fee). */
  approvalStep?: Omit<PreparedTransaction, "chainId">;
}

/** Where money reaches the BurnVault. Only sources the indexer can measure exactly are `tracked`. */
export type BurnInflowKey =
  "protocol_fee" | "fleet_subscription" | "creator_fee" | "registration_fee" | "stake_slash";

export interface BurnInflow {
  key: BurnInflowKey;
  label: string;
  /** Asset the amount is denominated in: the active chain's stablecoin symbol, or "PINELY" (the vault burns $PINELY after a buyback). */
  token: string;
  tracked: boolean;
  /** Raw base-unit amount routed to the BurnVault; present only when `tracked`. */
  amount?: string;
  /** Number of events that contributed; present only when `tracked`. */
  count?: number;
  /** Why an untracked source has no number. */
  reason?: "not_indexed" | "no_event_amount";
}

export interface BurnSources {
  /** Total $PINELY destroyed, from `Burned` events (raw 18-decimal units). */
  burnedPinely: string;
  inflows: BurnInflow[];
}
