import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { pool } from "../src/db/connection";
import {
  IndexerUnavailableError,
  NOT_READY_LOG_INTERVAL_MS,
  isIndexerNotReadyError,
  queryIndexer,
  resetIndexerLogThrottle,
} from "../src/lib/indexer";
import app from "../src/app";

/**
 * While the indexer backfills, `ponder.*` views do not exist. That must answer 503 with a retry hint
 * and a quiet, throttled log line, while every other database failure stays a loud error.
 */

const missingTable = () =>
  Object.assign(new Error('relation "ponder.machines" does not exist'), { code: "42P01" });
const connectionRefused = () =>
  Object.assign(new Error("connect ECONNREFUSED 10.0.0.1:5432"), { code: "ECONNREFUSED" });

let query: ReturnType<typeof spyOn>;
let log: ReturnType<typeof spyOn>;
let error: ReturnType<typeof spyOn>;
let now: ReturnType<typeof spyOn>;
let clock = 1_000_000;

beforeEach(() => {
  resetIndexerLogThrottle();
  clock = 1_000_000;
  now = spyOn(Date, "now").mockImplementation(() => clock);
  log = spyOn(console, "log").mockImplementation(() => {});
  error = spyOn(console, "error").mockImplementation(() => {});
  query = spyOn(pool, "query");
});
afterEach(() => {
  now.mockRestore();
  log.mockRestore();
  error.mockRestore();
  query.mockRestore();
});

describe("indexer readiness", () => {
  it("recognises only missing-table and missing-schema as 'not ready'", () => {
    expect(isIndexerNotReadyError(missingTable())).toBe(true);
    expect(isIndexerNotReadyError({ code: "3F000" })).toBe(true);
    expect(isIndexerNotReadyError(connectionRefused())).toBe(false);
    expect(isIndexerNotReadyError(new Error("boom"))).toBe(false);
    expect(isIndexerNotReadyError(null)).toBe(false);
  });

  it("logs 'not ready' once per window as a plain log, not an error", async () => {
    query.mockRejectedValue(missingTable());
    for (let i = 0; i < 5; i++) {
      await expect(queryIndexer("select 1")).rejects.toBeInstanceOf(IndexerUnavailableError);
    }
    expect(error).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0]?.[0])).toContain("not ready");
    expect(String(log.mock.calls[0]?.[0])).toContain("ponder.machines");
  });

  it("logs again after the window and reports how many requests were skipped", async () => {
    query.mockRejectedValue(missingTable());
    for (let i = 0; i < 4; i++) await queryIndexer("select 1").catch(() => {});
    clock += NOT_READY_LOG_INTERVAL_MS;
    await queryIndexer("select 1").catch(() => {});
    expect(log).toHaveBeenCalledTimes(2);
    expect(String(log.mock.calls[1]?.[0])).toContain("3 similar request(s)");
  });

  it("keeps real database failures loud and unthrottled", async () => {
    query.mockRejectedValue(connectionRefused());
    for (let i = 0; i < 3; i++) await queryIndexer("select 1").catch(() => {});
    expect(error).toHaveBeenCalledTimes(3);
    expect(log).not.toHaveBeenCalled();
  });

  it("answers 503 indexer_unavailable with a Retry-After header", async () => {
    query.mockRejectedValue(missingTable());
    const res = await app.request("/api/stats");
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect((await res.json()).error).toBe("indexer_unavailable");
  });
});
