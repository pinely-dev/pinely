"use client";

import { useQuery } from "@tanstack/react-query";
import { keccak256, encodeAbiParameters, parseAbiParameters, type Address, type Hash } from "viem";
import type {
  ApiMeta,
  BurnSources,
  EcosystemStats,
  FleetProfile,
  PreparedAction,
  PilotApplicationRequest,
  PilotApplicationResponse,
} from "@pinely/shared/types";
import { apiFetch, isApiReachable, setStoredSessionToken, clearStoredSessionToken } from "./http";

export {
  API_BASE_URL,
  DATA_SOURCE,
  ApiError,
  apiFetch,
  isApiError,
  isApiReachable,
  getAuthHeaders,
  getStoredSessionToken,
  setStoredSessionToken,
  clearStoredSessionToken,
} from "./http";
export type { EcosystemStats, PreparedAction as ActionPrepareResponse };

// --- Response types (mirror the backend; see shared/types/api.ts) ---

/** One machine as the indexer reports it. Optional fields are absent when the indexer has no value. */
export interface BackendMachine {
  id?: string;
  machineId?: string;
  account: string;
  operator: string;
  signer: string;
  attestationHash: string | null;
  attestationValid: boolean;
  tier: number;
  frozen: boolean;
  maxStableOutPerSwap: string;
  dailyStableOutCap: string;
  policyEnabled: boolean;
  registeredAt: number;
  lastActiveAt: number | null;
  /** `true` once the operator has removed the machine from the registry. */
  deregistered?: boolean;
  violations?: number | string;
  usedToday?: string;
  totalStableOut?: string;
  totalSwaps?: number | string;
  totalFacilitatorSpent?: string;
  totals?: {
    totalVolumeIn?: string;
    totalStableOut?: string;
    totalSwaps?: number | string;
  };
}

export interface MachinesListResponse {
  data: BackendMachine[];
  meta: ApiMeta;
}

export interface FleetMetrics {
  totalMachines: number | string;
  activeMachines: number | string;
  frozenMachines: number | string;
  bronzeCount: number | string;
  silverCount: number | string;
  goldCount: number | string;
}

export interface FleetSummary {
  operator: string;
  /** `null` when the indexer has not seen this operator yet. */
  profile: FleetProfile | null;
  fleet: FleetMetrics;
  volume: {
    totalStableOut: string;
    totalSwaps: number | string;
  };
}

export interface BurnEvent {
  id: string;
  source: string;
  amountPinely: string;
  txHash: string;
  blockTimestamp: number;
}

export interface BillingSubscription {
  operator: string;
  plan: "free" | "pro" | "enterprise";
  name: string;
  maxMachines: number;
  activeMachines: number;
  quotaStable: string;
  features: string[];
  renewsAt: string;
}

export interface BillingQuota {
  operator: string;
  monthlyCapStable: string;
  spentStable: string;
  remainingStable: string;
  resetsAt: string;
}

export interface MachineActivityItem {
  id: string;
  machineId: string;
  account: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  stableOut: string;
  protocolFee: string;
  txHash: string;
  blockNumber: number;
  blockTimestamp: number;
}

/** Public identity and reputation record built from indexer data (`GET /api/machines/:id/passport`). */
export interface MachinePassport {
  passportVersion: number;
  machineId: string;
  account: string;
  operator: string;
  signer: string;
  tierName: string;
  tier: number;
  hardwareAttestation: { hash: string | null; valid: boolean };
  status: "ACTIVE" | "FROZEN";
  registeredAt: number | string | null;
  registeredBlock: number | string | null;
  registeredTx: string | null;
  lastActiveAt: number | string | null;
  metrics: { lifetimeStableOut: string; totalSuccessfulSwaps: number };
}

/** A service payment the machine made through the Facilitator, confirmed onchain. */
export interface MachinePayment {
  id: string;
  recipient: string;
  /** Raw 6-decimal stablecoin amount. */
  amount: string;
  rail: string;
  txHash: string;
  /** Unix seconds, as a string. */
  createdAt: string;
}

/** A recorded breach of a machine's spend policy (`GET /api/fleets/:operator/violations`). */
export interface PolicyViolation {
  id: string;
  machineId: string;
  evidenceHash: string;
  reportedBy: string;
  txHash: string;
  blockTimestamp: number | string;
}

/** An operator's staking position, read from the chain. Amounts are raw 18-decimal $PINELY strings. */
export interface StakeState {
  operator: string;
  stakeContract: string;
  token: string;
  /** Active stake; it counts toward the Gold tier. */
  staked: string;
  /** Stake in the unbonding period; it does not count toward Gold. */
  unbonding: string;
  /** Unix seconds when `unbonding` can be withdrawn; "0" when nothing is unbonding. */
  unlockTime: string;
  hasMinStakeGold: boolean;
  minStakeGold: string;
  unbondingPeriodSeconds: string;
  balance: string;
  allowance: string;
}

export interface SweeperConfig {
  token: Address;
  reserveThreshold: string;
  destination: Address;
  enabled: boolean;
}

// --- Read functions ---
// Every function rejects with `ApiError` on failure. None returns a fallback value: an empty
// result is a real answer, and "indexer down" is `error.isIndexerUnavailable`.

export async function fetchEcosystemStats(): Promise<EcosystemStats> {
  const json = await apiFetch<{ data: EcosystemStats }>("/api/stats");
  return json.data;
}

export interface MachinesFilters {
  operator?: string;
  frozen?: boolean;
  /** Prefix match on machine id, account or operator address. */
  search?: string;
}

export function fetchMachinesList(
  page = 1,
  limit = 20,
  filters: MachinesFilters = {},
): Promise<MachinesListResponse> {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (filters.operator) params.set("operator", filters.operator);
  if (filters.frozen !== undefined) params.set("frozen", String(filters.frozen));
  if (filters.search?.trim()) params.set("search", filters.search.trim());
  return apiFetch<MachinesListResponse>(`/api/machines?${params.toString()}`);
}

export async function fetchMachineDetail(machineId: string): Promise<BackendMachine> {
  const json = await apiFetch<{ data: BackendMachine }>(
    `/api/machines/${encodeURIComponent(machineId)}`,
  );
  return json.data;
}

export async function fetchFleetSummary(operator: string): Promise<FleetSummary> {
  const json = await apiFetch<{ data: FleetSummary }>(
    `/api/fleets/${encodeURIComponent(operator)}/summary`,
  );
  return json.data;
}

export async function fetchBurnEvents(): Promise<{
  totalBurnedPinely: string;
  recentBurns: BurnEvent[];
}> {
  const [burns, summary] = await Promise.all([
    apiFetch<{ data: BurnEvent[] }>("/api/burns"),
    apiFetch<{ data: { totalPinelyBurned?: string } }>("/api/burns/summary"),
  ]);
  return {
    totalBurnedPinely: String(summary.data.totalPinelyBurned ?? "0"),
    recentBurns: Array.isArray(burns.data) ? burns.data : [],
  };
}

export async function fetchBurnSources(): Promise<BurnSources> {
  const json = await apiFetch<{ data: BurnSources }>("/api/burns/sources");
  return json.data;
}

export async function fetchBillingSubscription(operator: string): Promise<BillingSubscription> {
  const json = await apiFetch<{ data: BillingSubscription }>(
    `/api/billing/subscription/${encodeURIComponent(operator)}`,
  );
  return json.data;
}

export async function fetchBillingQuota(operator: string): Promise<BillingQuota> {
  const json = await apiFetch<{ data: BillingQuota }>(
    `/api/billing/quota/${encodeURIComponent(operator)}`,
  );
  return json.data;
}

export async function fetchMachinePayments(
  machineId: string,
  limit = 20,
): Promise<MachinePayment[]> {
  const json = await apiFetch<{ data: MachinePayment[] }>(
    `/api/machines/${encodeURIComponent(machineId)}/payments?limit=${limit}`,
  );
  return Array.isArray(json.data) ? json.data : [];
}

export async function fetchStakeState(operator: string): Promise<StakeState> {
  const json = await apiFetch<{ data: StakeState }>(`/api/stake/${encodeURIComponent(operator)}`);
  return json.data;
}

export async function fetchFleetViolations(operator: string): Promise<PolicyViolation[]> {
  const json = await apiFetch<{ data: PolicyViolation[] }>(
    `/api/fleets/${encodeURIComponent(operator)}/violations`,
  );
  return Array.isArray(json.data) ? json.data : [];
}

export async function fetchMachineActivity(
  machineId: string,
  limit = 6,
): Promise<MachineActivityItem[]> {
  const json = await apiFetch<{ data: MachineActivityItem[] }>(
    `/api/machines/${encodeURIComponent(machineId)}/activity?limit=${limit}`,
  );
  return Array.isArray(json.data) ? json.data : [];
}

export async function fetchMachinePassport(machineId: string): Promise<MachinePassport> {
  const json = await apiFetch<{ data: MachinePassport }>(
    `/api/machines/${encodeURIComponent(machineId)}/passport`,
  );
  return json.data;
}

export async function fetchSweeperConfig(machineId: string): Promise<SweeperConfig | null> {
  const json = await apiFetch<{ data: SweeperConfig | null }>(
    `/api/actions/sweeper/config?machineId=${encodeURIComponent(machineId)}`,
  );
  return json.data ?? null;
}

// --- Write preparation (backend builds calldata; the operator wallet signs and sends it) ---

export function prepareRegisterAction(params: {
  account: Address;
  signer: Address;
  attestationHash?: Hash;
  maxStableOutPerSwap?: string;
  dailyStableOutCap?: string;
}): Promise<PreparedAction> {
  return apiFetch<PreparedAction>("/api/actions/register/prepare", {
    method: "POST",
    body: params,
  });
}

export function preparePolicyAction(params: {
  machineId: Hash;
  maxStableOutPerSwap: string;
  dailyStableOutCap: string;
  enabled: boolean;
}): Promise<PreparedAction> {
  return apiFetch<PreparedAction>("/api/actions/policy/prepare", {
    method: "POST",
    body: params,
  });
}

export function prepareFreezeAction(params: {
  machineId?: Hash;
  freezeFleet?: boolean;
}): Promise<PreparedAction> {
  return apiFetch<PreparedAction>("/api/actions/freeze/prepare", {
    method: "POST",
    body: params,
  });
}

export function prepareUnfreezeAction(params: {
  machineId?: Hash;
  unfreezeFleet?: boolean;
}): Promise<PreparedAction> {
  return apiFetch<PreparedAction>("/api/actions/unfreeze/prepare", {
    method: "POST",
    body: params,
  });
}

/** `amount` is a raw 18-decimal $PINELY integer as a string. The wallet approves it first if needed. */
export function prepareStakeAction(params: { amount: string }): Promise<PreparedAction> {
  return apiFetch<PreparedAction>("/api/stake/stake/prepare", { method: "POST", body: params });
}

/** Starts the unbonding period for `amount`; it no longer counts toward Gold. */
export function prepareUnstakeAction(params: { amount: string }): Promise<PreparedAction> {
  return apiFetch<PreparedAction>("/api/stake/unstake/prepare", { method: "POST", body: params });
}

export function prepareCancelUnstakeAction(): Promise<PreparedAction> {
  return apiFetch<PreparedAction>("/api/stake/cancel-unstake/prepare", {
    method: "POST",
    body: {},
  });
}

export function prepareWithdrawUnstakedAction(): Promise<PreparedAction> {
  return apiFetch<PreparedAction>("/api/stake/withdraw/prepare", { method: "POST", body: {} });
}

/** Revokes the machine account's session key. The machine cannot sign until a new key is set. */
export function prepareRevokeSessionKeyAction(params: {
  machineId: Hash;
}): Promise<PreparedAction> {
  return apiFetch<PreparedAction>("/api/actions/session-key/revoke/prepare", {
    method: "POST",
    body: params,
  });
}

/** Two transactions: the account switches to `newKey` (step 1), then the registry records it (step 2). */
export function prepareRotateSessionKeyAction(params: {
  machineId: Hash;
  newKey: Address;
  validForDays?: number;
}): Promise<PreparedAction> {
  return apiFetch<PreparedAction>("/api/actions/session-key/rotate/prepare", {
    method: "POST",
    body: params,
  });
}

/** Irreversible: removes the machine from the registry. */
export function prepareDeregisterAction(params: { machineId: Hash }): Promise<PreparedAction> {
  return apiFetch<PreparedAction>("/api/actions/deregister/prepare", {
    method: "POST",
    body: params,
  });
}

/** `guardian: null` removes the guardian. */
export function prepareGuardianAction(params: {
  guardian: Address | null;
}): Promise<PreparedAction> {
  return apiFetch<PreparedAction>("/api/actions/guardian/prepare", {
    method: "POST",
    body: params,
  });
}

/** Reads the allowlist from the chain, not the indexer, so it is current as soon as a transaction is mined. */
export async function fetchAllowlistStatus(machineId: Hash, asset: Address): Promise<boolean> {
  const params = new URLSearchParams({ machineId, asset });
  const json = await apiFetch<{ data: { allowed: boolean } }>(
    `/api/actions/allowlist/status?${params.toString()}`,
  );
  return json.data.allowed;
}

export function prepareSweeperAction(params: {
  machineId?: Hash;
  fleet?: boolean;
  token?: Address;
  reserveThreshold: string;
  destination: Address;
  enabled: boolean;
}): Promise<PreparedAction> {
  return apiFetch<PreparedAction>("/api/actions/sweeper/prepare", {
    method: "POST",
    body: params,
  });
}

export function prepareAllowlistAction(params: {
  machineId: Hash;
  asset: Address;
  allowed?: boolean;
}): Promise<PreparedAction> {
  return apiFetch<PreparedAction>("/api/actions/allowlist/prepare", {
    method: "POST",
    body: params,
  });
}

// --- Pilot application ---

export function submitPilotApplication(
  application: PilotApplicationRequest,
): Promise<PilotApplicationResponse> {
  return apiFetch<PilotApplicationResponse>("/api/pilot/applications", {
    method: "POST",
    body: application,
    auth: false,
  });
}

// --- Helpers ---

/** Deterministic on-chain machine id: keccak256(abi.encode(account)). */
export function computeMachineId(account: Address): Hash {
  return keccak256(encodeAbiParameters(parseAbiParameters("address"), [account]));
}

/** Converts a raw 6-decimal stablecoin amount (string/number/bigint) to a display number. */
export function toStable(raw: unknown): number {
  const n = Number(raw ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, n / 1_000_000);
}

// --- React Query hooks ---

export function useEcosystemStats() {
  return useQuery({
    queryKey: ["ecosystemStats"],
    queryFn: fetchEcosystemStats,
    enabled: isApiReachable(),
    staleTime: 15_000,
  });
}

export function useMachinesList(page = 1, limit = 20, filters: MachinesFilters = {}) {
  return useQuery({
    queryKey: ["machinesList", page, limit, filters],
    queryFn: () => fetchMachinesList(page, limit, filters),
    enabled: isApiReachable(),
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
}

export function useMachineDetail(machineId?: string) {
  return useQuery({
    queryKey: ["machineDetail", machineId],
    queryFn: () => fetchMachineDetail(machineId!),
    enabled: isApiReachable() && Boolean(machineId),
    staleTime: 10_000,
  });
}

export function useMachineActivity(machineId?: string, limit = 6) {
  return useQuery({
    queryKey: ["machineActivity", machineId, limit],
    queryFn: () => fetchMachineActivity(machineId!, limit),
    enabled: isApiReachable() && Boolean(machineId),
    staleTime: 15_000,
  });
}

export function useMachinePassport(machineId?: string) {
  return useQuery({
    queryKey: ["machinePassport", machineId],
    queryFn: () => fetchMachinePassport(machineId!),
    enabled: isApiReachable() && Boolean(machineId),
    staleTime: 15_000,
  });
}

export function useSweeperConfig(machineId?: string) {
  return useQuery({
    queryKey: ["sweeperConfig", machineId],
    queryFn: () => fetchSweeperConfig(machineId!),
    enabled: isApiReachable() && Boolean(machineId),
    staleTime: 15_000,
  });
}

export function useFleetSummary(operator?: string) {
  return useQuery({
    queryKey: ["fleetSummary", operator],
    queryFn: () => fetchFleetSummary(operator!),
    enabled: isApiReachable() && Boolean(operator),
    staleTime: 10_000,
  });
}

export function useBurnEvents() {
  return useQuery({
    queryKey: ["burnEvents"],
    queryFn: fetchBurnEvents,
    enabled: isApiReachable(),
    staleTime: 30_000,
  });
}

export function useMachinePayments(machineId?: string, limit = 20) {
  return useQuery({
    queryKey: ["machinePayments", machineId, limit],
    queryFn: () => fetchMachinePayments(machineId!, limit),
    enabled: isApiReachable() && Boolean(machineId),
    staleTime: 15_000,
  });
}

export function useStakeState(operator?: string) {
  return useQuery({
    queryKey: ["stakeState", operator],
    queryFn: () => fetchStakeState(operator!),
    enabled: isApiReachable() && Boolean(operator),
    staleTime: 10_000,
  });
}

export function useFleetViolations(operator?: string) {
  return useQuery({
    queryKey: ["fleetViolations", operator],
    queryFn: () => fetchFleetViolations(operator!),
    enabled: isApiReachable() && Boolean(operator),
    staleTime: 15_000,
  });
}

export function useBurnSources() {
  return useQuery({
    queryKey: ["burnSources"],
    queryFn: fetchBurnSources,
    enabled: isApiReachable(),
    staleTime: 30_000,
  });
}

export function useBillingSubscription(operator?: string) {
  return useQuery({
    queryKey: ["billingSubscription", operator],
    queryFn: () => fetchBillingSubscription(operator!),
    enabled: isApiReachable() && Boolean(operator),
    staleTime: 20_000,
  });
}

export function useBillingQuota(operator?: string) {
  return useQuery({
    queryKey: ["billingQuota", operator],
    queryFn: () => fetchBillingQuota(operator!),
    enabled: isApiReachable() && Boolean(operator),
    staleTime: 20_000,
  });
}

// --- SIWE authentication ---

export async function fetchSiweNonce(): Promise<string> {
  const json = await apiFetch<{ nonce: string }>("/api/auth/nonce");
  return json.nonce;
}

export async function verifySiwe(
  message: string,
  signature: string,
): Promise<{ status: string; address: string; token?: string }> {
  const data = await apiFetch<{ status: string; address: string; token?: string }>(
    "/api/auth/verify",
    { method: "POST", body: { message, signature }, auth: false },
  );
  if (data.token) setStoredSessionToken(data.token);
  return data;
}

export async function fetchAuthMe(): Promise<{ authenticated: boolean; address?: string }> {
  try {
    return await apiFetch<{ authenticated: boolean; address?: string }>("/api/auth/me", {
      auth: true,
    });
  } catch {
    // Any failure means "not signed in" for the UI; the wallet context then asks to sign again.
    return { authenticated: false };
  }
}

export async function logoutAuth(): Promise<void> {
  try {
    await apiFetch<unknown>("/api/auth/logout", { method: "POST" });
  } catch {
    // The local session is cleared below regardless of the network result.
  } finally {
    clearStoredSessionToken();
  }
}
