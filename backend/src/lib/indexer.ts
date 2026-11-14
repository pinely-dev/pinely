import type { QueryResult, QueryResultRow } from "pg";
import { pool } from "../db/connection";

/**
 * Thrown when a read from the indexer schema (`ponder.*`) cannot be served: the schema or a table is
 * missing, or the database is unreachable. It is mapped to HTTP 503 so a client can tell
 * "the indexer is down" apart from "there is no data yet" (an empty result with HTTP 200).
 */
export class IndexerUnavailableError extends Error {
  constructor() {
    super("indexer_unavailable");
    this.name = "IndexerUnavailableError";
  }
}

export function indexerUnavailableBody() {
  return {
    error: "indexer_unavailable",
    message: "The indexer is not available. Try again shortly.",
  } as const;
}

/** Seconds a client should wait before retrying while the indexer is not ready (`Retry-After`). */
export const INDEXER_RETRY_AFTER_SECONDS = 60;

/** Postgres error codes that mean "the indexer's tables are not there (yet)", not "something broke". */
const NOT_READY_CODES = new Set([
  "42P01", // undefined_table: the view appears only after the first historical sync finishes
  "3F000", // invalid_schema_name: the indexer has not created its schema yet
]);

/** An expected, repeating condition is logged at most once per window instead of once per request. */
export const NOT_READY_LOG_INTERVAL_MS = 5 * 60_000;
let lastNotReadyLogAt = 0;
let suppressedSinceLastLog = 0;

/** Test hook: forget the throttle state. */
export function resetIndexerLogThrottle(): void {
  lastNotReadyLogAt = 0;
  suppressedSinceLastLog = 0;
}

export function isIndexerNotReadyError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && NOT_READY_CODES.has(code);
}

function logNotReady(error: unknown): void {
  const now = Date.now();
  if (lastNotReadyLogAt !== 0 && now - lastNotReadyLogAt < NOT_READY_LOG_INTERVAL_MS) {
    suppressedSinceLastLog++;
    return;
  }
  const suppressed = suppressedSinceLastLog;
  lastNotReadyLogAt = now;
  suppressedSinceLastLog = 0;
  // Plain log, not an error: this is the honest state while the indexer backfills (or is not deployed).
  console.log(
    `[PINELY Backend] Indexer is not ready (${error instanceof Error ? error.message : String(error)}). ` +
      `Requests get 503 until its first sync finishes. ` +
      `${suppressed} similar request(s) were not logged in the last ${Math.round(NOT_READY_LOG_INTERVAL_MS / 60_000)} minutes.`,
  );
}

/**
 * Runs a read query against the indexer schema. Any failure is logged server-side (never sent to the
 * client) and surfaced as `IndexerUnavailableError`. A missing table or schema is the expected state
 * while the indexer backfills, so it is logged once per window; anything else is a real error and is
 * logged every time.
 */
export async function queryIndexer<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  try {
    return await pool.query<T>(text, values);
  } catch (error) {
    if (isIndexerNotReadyError(error)) {
      logNotReady(error);
    } else {
      console.error(
        "[PINELY Backend] Indexer query failed:",
        error instanceof Error ? error.message : error,
      );
    }
    throw new IndexerUnavailableError();
  }
}
