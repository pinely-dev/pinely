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

/**
 * Runs a read query against the indexer schema. Any failure is logged server-side (never sent to the
 * client) and surfaced as `IndexerUnavailableError`.
 */
export async function queryIndexer<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<QueryResult<T>> {
  try {
    return await pool.query<T>(text, values);
  } catch (error) {
    console.error(
      "[PINELY Backend] Indexer query failed:",
      error instanceof Error ? error.message : error,
    );
    throw new IndexerUnavailableError();
  }
}
