/**
 * Spike kompatibilitas pg-boss di Bun.
 *
 * Run after the local PostgreSQL is up:
 *   bun run --cwd backend queue:spike
 *
 * This script creates a queue, sends one job, processes it, then stops.
 * If it passes, the queue worker can stay inside the Bun backend process.
 */
import "dotenv/config";
import { PgBoss, type Job } from "pg-boss";

const queue = "pinely_spike";
const timeoutMs = 15_000;

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const boss = new PgBoss({
  connectionString: process.env.DATABASE_URL,
  schema: "app",
  application_name: "pinely-pg-boss-spike",
});

let received: { hello?: string } | null = null;
let settle: (() => void) | null = null;
const processed = new Promise<void>((resolve) => {
  settle = resolve;
});

async function main(): Promise<void> {
  await boss.start();
  await boss.createQueue(queue);

  await boss.work<{ hello?: string }>(
    queue,
    { batchSize: 1 },
    async (jobs: Job<{ hello?: string }>[]) => {
      received = jobs[0]?.data ?? null;
      settle?.();
      return "ok";
    },
  );

  const jobId = await boss.send(queue, { hello: "bun" });
  if (!jobId) {
    throw new Error("pg-boss returned an empty job id.");
  }

  const timer = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error(`Job was not processed within ${timeoutMs} ms.`)), timeoutMs);
  });

  await Promise.race([processed, timer]);

  if (received?.hello !== "bun") {
    throw new Error(`Unexpected payload: ${JSON.stringify(received)}`);
  }

  console.log(`OK: pg-boss ${queue} diproses di Bun.`);
}

main()
  .catch((error) => {
    console.error("FAILED:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await boss.stop({ graceful: true }).catch(() => undefined);
  });
