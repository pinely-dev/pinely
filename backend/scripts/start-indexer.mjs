import { spawn } from "node:child_process";
import { defaultChain } from "@pinely/shared/chains";
import { findContractAddress } from "@pinely/shared/contracts";

// In production CHAIN_ID is mandatory: a missing variable must never silently select testnet.
// Outside production the local development default chain (shared/chains) is used.
const chainId = Number(
  process.env.CHAIN_ID || (process.env.NODE_ENV === "production" ? 0 : defaultChain.id),
);
const registryAddress = chainId ? findContractAddress(chainId, "MachineRegistry") : undefined;

const hasRequiredEnv = Boolean(
  chainId &&
  process.env.RPC_URL &&
  process.env.DATABASE_URL &&
  process.env.START_BLOCK &&
  registryAddress,
);

const runIndexer =
  process.env.RUN_INDEXER === "true" || (process.env.RUN_INDEXER !== "false" && hasRequiredEnv);

if (!runIndexer || !hasRequiredEnv) {
  const reason = !chainId
    ? "CHAIN_ID is not set (it is mandatory in production)"
    : !registryAddress
      ? `MachineRegistry is not deployed on chain ${chainId} yet`
      : `Missing required env vars (RPC_URL, DATABASE_URL, or START_BLOCK)`;

  console.log(
    `[PINELY Indexer Guard] Indexer is in standby mode: ${reason}. ` +
      `API will serve honest "indexer_unavailable" states without spamming RPC/logs.`,
  );

  // Keep process alive so supervisord does not trigger restart loop
  setInterval(() => {}, 60000);
} else {
  console.log(
    `[PINELY Indexer Guard] Starting Ponder indexer on chain ${chainId} (Registry: ${registryAddress})...`,
  );
  const child = spawn(
    "node",
    ["/app/node_modules/@ponder/core/dist/bin/ponder.js", "start", "-p", "42069"],
    {
      cwd: "/app/indexer",
      stdio: "inherit",
      env: { ...process.env, PORT: "42069" },
    },
  );

  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}
