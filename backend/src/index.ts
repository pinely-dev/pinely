import { serve } from "@hono/node-server";
import "dotenv/config";
import app from "./app";
import { closeDatabase, ensureSchemas } from "./db/connection";
import { startQueueWorker, stopQueueWorker } from "./jobs/worker";
import { loadSettledPaymentNoncesFromDb } from "./services/payment-rails";

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "0.0.0.0";
const shutdownTimeoutMs = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? 10_000);

const server = serve({ fetch: app.fetch, port, hostname }, (info) => {
  console.log(`Server listening on http://${hostname}:${info.port}`);
});

if (!process.env.DATABASE_URL) {
  console.log("DATABASE_URL is not set. /ready will fail until database is configured.");
} else {
  ensureSchemas()
    .then(async () => {
      console.log("Database schema ready.");
      await loadSettledPaymentNoncesFromDb();
      await startQueueWorker();
    })
    .catch((error) => {
      console.error(
        "Failed to initialize database & worker:",
        error instanceof Error ? error.message : error,
      );
    });
}

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}, closing server...`);

  const forceExit = setTimeout(() => {
    console.error("Shutdown timed out; force exiting.");
    process.exit(1);
  }, shutdownTimeoutMs);
  forceExit.unref();

  try {
    await stopQueueWorker();
  } catch (workerError) {
    console.error("Failed to stop queue worker:", workerError);
  }

  server.close(async (error) => {
    try {
      await closeDatabase();
    } catch (closeError) {
      console.error("Failed to close database pool:", closeError);
    }

    clearTimeout(forceExit);

    if (error) {
      console.error("Failed to close server:", error);
      process.exit(1);
    }

    console.log("Shutdown complete.");
    process.exit(0);
  });
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
