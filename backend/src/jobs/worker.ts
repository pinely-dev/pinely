import { PgBoss, type Job } from "pg-boss";
import { APP_SCHEMA } from "../db/connection";
import { runBillingQuotaResetCycle, runSurplusSweepCycle } from "../services/keeper";

export const QUEUE_SURPLUS_SWEEP = "pinely_surplus_sweep";
export const QUEUE_BILLING_RESET = "pinely_billing_reset";

let bossInstance: PgBoss | null = null;

export interface SurplusSweepJobPayload {
  machineId?: string;
  triggeredBy?: string;
}

export interface BillingResetJobPayload {
  month?: string;
}

/**
 * Starts the pg-boss background worker if DATABASE_URL is available.
 */
export async function startQueueWorker(): Promise<PgBoss | null> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.log("[Worker] DATABASE_URL is not set; skipping queue worker.");
    return null;
  }

  try {
    const boss = new PgBoss({
      connectionString,
      schema: APP_SCHEMA,
      application_name: "pinely-queue-worker",
    });

    await boss.start();
    console.log("[Worker] pg-boss connected and ready to process queue.");

    // Create the queue if it does not exist
    await boss.createQueue(QUEUE_SURPLUS_SWEEP);
    await boss.createQueue(QUEUE_BILLING_RESET);

    // Daftarkan handler pemrosesan queue surplus sweep
    await boss.work<SurplusSweepJobPayload>(
      QUEUE_SURPLUS_SWEEP,
      { batchSize: 5 },
      async (jobs: Job<SurplusSweepJobPayload>[]) => {
        for (const job of jobs) {
          const { machineId, triggeredBy } = job.data;
          console.log(
            `[Worker] Processing auto-sweep job for machine: ${machineId ?? "ALL"}, trigger: ${triggeredBy ?? "cron"}`,
          );
          try {
            const outcome = await runSurplusSweepCycle(machineId);
            console.log(
              `[Worker] Auto-sweep finished: swept=${outcome.sweptCount} failed=${outcome.failedCount} ` +
                `skipped=${outcome.skippedCount} dryRun=${outcome.dryRun} ` +
                `indexerUnavailable=${outcome.indexerUnavailable} truncated=${outcome.truncated}`,
            );
          } catch (err) {
            console.error("[Worker] Error during auto-sweep cycle:", err);
          }
        }
        return "ok";
      },
    );

    // Daftarkan handler pemrosesan queue billing quota reset
    await boss.work<BillingResetJobPayload>(
      QUEUE_BILLING_RESET,
      { batchSize: 1 },
      async (jobs: Job<BillingResetJobPayload>[]) => {
        for (const job of jobs) {
          console.log(
            `[Worker] Resetting operator monthly transaction quota for period: ${job.data.month ?? new Date().toISOString()}`,
          );
          try {
            await runBillingQuotaResetCycle();
          } catch (err) {
            console.error("[Worker] Error during quota reset cycle:", err);
          }
        }
        return "ok";
      },
    );

    // Register the periodic cron schedule in production/staging daemon mode
    try {
      await boss.schedule(QUEUE_SURPLUS_SWEEP, "*/15 * * * *", { triggeredBy: "cron_schedule" });
      await boss.schedule(QUEUE_BILLING_RESET, "0 0 1 * *", { month: new Date().toISOString() });
    } catch {
      // The schedule is already registered, or skip it in dev environments
    }

    bossInstance = boss;
    return boss;
  } catch (error) {
    console.error(
      "[Worker] Failed to initialize pg-boss worker:",
      error instanceof Error ? error.message : error,
    );
    return null;
  }
}

/**
 * Manually sends an auto-sweep job to the queue.
 */
export async function triggerSurplusSweepJob(
  payload: SurplusSweepJobPayload = {},
): Promise<string | null> {
  if (!bossInstance) return null;
  try {
    return await bossInstance.send(QUEUE_SURPLUS_SWEEP, payload);
  } catch {
    return null;
  }
}

/**
 * Stops the pg-boss background worker gracefully on shutdown.
 */
export async function stopQueueWorker(): Promise<void> {
  if (bossInstance) {
    console.log("[Worker] Stopping pg-boss queue worker...");
    await bossInstance.stop({ timeout: 5000 });
    bossInstance = null;
  }
}
