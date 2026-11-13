#!/usr/bin/env node
import { type Address, type Hash, type Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
import { Pinely } from "../src/index.js";
import { robinhoodMainnet, robinhoodTestnet } from "@pinely/shared/chains";
import { findContractAddress } from "@pinely/shared/contracts";

// Injected at build time by tsup (see tsup.config.ts); falls back to "dev" when run from source.
declare const __SDK_VERSION__: string | undefined;
const SDK_VERSION = typeof __SDK_VERSION__ === "string" ? __SDK_VERSION__ : "dev";

const USAGE = `
PINELY CLI: hardware and autonomous machine financial operations on Robinhood Chain

Usage:
  pinely <command> [options]

Commands:
  machine create    Initialize new machine identity & generate registration calldata
  machine status    Inspect on-chain machine status (tier, kill switch, spend policy)
  swap              Compute quote & sign hookData SwapIntent (EIP-712)
  pay               Execute payment via Facilitator HTTP 402 protocol
  sweep             Build SurplusSweeper calldata (configuration or sweep execution)

Options:
  -h, --help        Show this help guide
  -v, --version     Show @pinely-protocol/sdk version

Examples:
  pinely machine create --name "Drone-Alpha" --operator 0x1234...
  pinely swap --amount-in 1000000 --min-out 990000 --token-in 0xToken...
  pinely pay --url http://localhost:3001/v1/charge/dock-001 --max-amount 250000
`;

function parseArgs(args: string[]): {
  command: string;
  subCommand?: string;
  flags: Record<string, string | boolean>;
} {
  let command = "";
  let subCommand: string | undefined;
  const flags: Record<string, string | boolean> = {};

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg.startsWith("--") || arg.startsWith("-")) {
      const key = arg.replace(/^-+/, "");
      const nextArg = args[i + 1];
      if (nextArg && !nextArg.startsWith("-")) {
        flags[key] = nextArg;
        i += 2;
      } else {
        flags[key] = true;
        i += 1;
      }
    } else {
      if (!command) {
        command = arg;
      } else if (!subCommand) {
        subCommand = arg;
      }
      i++;
    }
  }

  return { command, subCommand, flags };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes("-v") || argv.includes("--version")) {
    console.log(SDK_VERSION);
    process.exit(0);
  }
  if (argv.length === 0 || argv.includes("-h") || argv.includes("--help")) {
    console.log(USAGE);
    process.exit(0);
  }

  const { command, subCommand, flags } = parseArgs(argv);

  const chain = (flags.chain as string) || "robinhoodTestnet";
  if (chain !== "robinhoodTestnet" && chain !== "robinhoodMainnet") {
    console.error(`Error: --chain must be robinhoodTestnet or robinhoodMainnet (got "${chain}").`);
    process.exit(1);
  }
  const chainId = chain === "robinhoodMainnet" ? robinhoodMainnet.id : robinhoodTestnet.id;

  // Fail closed: no dummy addresses. Registry is mandatory; Router and Hook exist only from Stage 2.
  const registryAddress =
    (flags.registry as Address | undefined) || findContractAddress(chainId, "MachineRegistry");
  if (!registryAddress) {
    console.error(
      `Error: MachineRegistry is not deployed on chain ${chainId}. Pass --registry <address> or run the deployment and sync first.`,
    );
    process.exit(1);
  }
  const routerAddress =
    (flags.router as Address | undefined) || findContractAddress(chainId, "PinelyRouter");
  const hookAddress =
    (flags.hook as Address | undefined) || findContractAddress(chainId, "PinelyHook");
  const stablecoinAddress =
    (flags.stablecoin as Address | undefined) || findContractAddress(chainId, "STABLECOIN");
  if (!stablecoinAddress) {
    console.error(
      `Error: stablecoin is not configured for chain ${chainId}. Pass --stablecoin <address>.`,
    );
    process.exit(1);
  }

  let privateKey = flags.key as Hex | undefined;
  if (!privateKey) {
    privateKey = generatePrivateKey();
    console.warn(
      "[SECURITY NOTICE] Flag --key was not provided. A fresh ephemeral key has been generated for this CLI session.",
    );
  }

  const pinely = await Pinely.connect({
    chain,
    registryAddress,
    routerAddress,
    hookAddress,
    stablecoinAddress,
    keyStore: { type: "file-dev-only", privateKey },
    rpcUrl: flags.rpc ? String(flags.rpc) : undefined,
  });

  const signerAddress = await pinely.keyStore.getAddress();

  // --- Sub-command routing ---

  if (command === "machine") {
    if (subCommand === "create") {
      const name = String(flags.name || "Pinely-Hardware-Node");
      const operator = (flags.operator as Address) || signerAddress;
      const account = flags.account as Address | undefined;
      const maxSpend = flags["max-spend"] ? BigInt(flags["max-spend"] as string) : 10_000_000n;
      const dailyCap = flags["daily-cap"] ? BigInt(flags["daily-cap"] as string) : 50_000_000n;

      const client = await pinely.machines.create({
        name,
        operator,
        account,
        policy: {
          maxStableOutPerSwap: maxSpend,
          dailyStableOutCap: dailyCap,
          enabled: true,
        },
      });

      const regTx = pinely.machines.buildRegistrationTx({
        account: client.account,
        signer: signerAddress,
        policy: {
          maxStableOutPerSwap: maxSpend,
          dailyStableOutCap: dailyCap,
          enabled: true,
        },
      });

      console.log(
        JSON.stringify(
          {
            status: "ready_to_register",
            machineId: client.machineId,
            name: client.name,
            operator: client.operator,
            account: client.account,
            signer: signerAddress,
            registrationTx: {
              to: regTx.to,
              data: regTx.data,
              value: "0",
            },
          },
          null,
          2,
        ),
      );
      process.exit(0);
    }

    if (subCommand === "status") {
      const machineId = flags.id as Hash | undefined;
      if (!machineId) {
        console.error("Error: --id <bytes32> is required for machine status.");
        process.exit(1);
      }

      const operator = (flags.operator as Address) || signerAddress;
      const account = (flags.account as Address) || signerAddress;
      const client = await pinely.machines.get(machineId, { operator, account });

      const info = await client.getInfo();
      let frozen: boolean | "unknown";
      try {
        frozen = await client.isFrozen();
      } catch {
        // Never report "not frozen" when the state could not be read.
        frozen = "unknown";
      }

      console.log(
        JSON.stringify(
          {
            machineId,
            frozen,
            info: info ?? "Unavailable (offline or unregistered on-chain)",
          },
          null,
          2,
        ),
      );
      process.exit(0);
    }

    console.error(`Unknown machine subcommand: ${subCommand}`);
    process.exit(1);
  }

  if (command === "swap") {
    const amountIn = flags["amount-in"] ? BigInt(flags["amount-in"] as string) : 0n;
    const minOut = flags["min-out"] ? BigInt(flags["min-out"] as string) : 0n;
    const tokenIn = flags["token-in"] as Address | undefined;
    const tokenOut = (flags["token-out"] as Address | undefined) ?? stablecoinAddress;

    if (!tokenIn || amountIn <= 0n || minOut <= 0n) {
      console.error(
        "Error: --token-in <address>, --amount-in <uint256>, and --min-out <uint256> are required for swap.",
      );
      process.exit(1);
    }

    const operator = (flags.operator as Address) || signerAddress;
    const account = (flags.account as Address) || signerAddress;
    const client = await pinely.machines.create({
      name: "Ephemeral-Swap-Client",
      operator,
      account,
    });

    const prepared = await client.prepareSwap({
      tokenIn,
      tokenOut,
      amountIn,
      minAmountOut: minOut,
    });

    console.log(
      JSON.stringify(
        {
          machineId: client.machineId,
          intent: {
            ...prepared.intent,
            amountIn: prepared.intent.amountIn.toString(),
            minAmountOut: prepared.intent.minAmountOut.toString(),
            nonce: prepared.intent.nonce.toString(),
            deadline: prepared.intent.deadline.toString(),
            chainId: prepared.intent.chainId.toString(),
          },
          signature: prepared.signature,
          hookData: prepared.hookData,
          swapRequest: {
            ...prepared.swapRequest,
            amountIn: prepared.swapRequest.amountIn.toString(),
            minAmountOut: prepared.swapRequest.minAmountOut.toString(),
          },
        },
        null,
        2,
      ),
    );
    process.exit(0);
  }

  if (command === "pay") {
    const url = flags.url as string | undefined;
    const maxAmount = flags["max-amount"] ? BigInt(flags["max-amount"] as string) : 0n;
    const facilitatorUrl = flags.facilitator as string | undefined;

    if (!url || maxAmount <= 0n) {
      console.error("Error: --url <string> and --max-amount <uint256> are required for pay.");
      process.exit(1);
    }

    const operator = (flags.operator as Address) || signerAddress;
    const account = (flags.account as Address) || signerAddress;
    const client = await pinely.machines.create({
      name: "Ephemeral-Pay-Client",
      operator,
      account,
    });

    const result = await client.pay({
      url,
      maxAmount,
      facilitatorUrl,
    });

    console.log(
      JSON.stringify(
        {
          status: result.status,
          resource: result.resource,
          amountStable: result.amountStable?.toString() ?? maxAmount.toString(),
          txHash: result.txHash,
          accessToken: result.accessToken,
          error: result.error,
        },
        null,
        2,
      ),
    );
    // A failed payment must be visible to scripts: exit non-zero unless the Facilitator confirmed settlement.
    process.exit(result.status === "settled" ? 0 : 1);
  }

  if (command === "sweep") {
    const sweeperAddress = flags.sweeper as Address | undefined;
    const machineId = flags.id as Hash | undefined;
    const operator = (flags.operator as Address) || signerAddress;
    const account = (flags.account as Address) || signerAddress;

    if (!sweeperAddress || !machineId) {
      console.error("Error: --sweeper <address> and --id <bytes32> are required for sweep.");
      process.exit(1);
    }

    const client = await pinely.machines.get(machineId, { operator, account });

    if (flags.config) {
      const destination = flags.destination as Address | undefined;
      const reserve = flags.reserve ? BigInt(flags.reserve as string) : 0n;
      if (!destination) {
        console.error("Error: --destination <address> is required to build sweep configuration.");
        process.exit(1);
      }

      const tx = client.buildSetSweepConfigTx(sweeperAddress, {
        destination,
        reserveThreshold: reserve,
        token: (flags.token as Address) || undefined,
        enabled: flags.disabled ? false : true,
      });

      console.log(JSON.stringify({ configTx: tx }, null, 2));
      process.exit(0);
    }

    const sweepTx = client.buildSweepTx(sweeperAddress);
    console.log(JSON.stringify({ sweepTx }, null, 2));
    process.exit(0);
  }

  console.error(`Unknown command: ${command}. Run "pinely --help" for usage.`);
  process.exit(1);
}

main().catch((err: unknown) => {
  // Concise by default; set PINELY_DEBUG=1 for the full stack trace.
  if (process.env.PINELY_DEBUG) {
    console.error("[PINELY] Fatal error:", err);
  } else {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    console.error("Set PINELY_DEBUG=1 for a stack trace.");
  }
  process.exit(1);
});
