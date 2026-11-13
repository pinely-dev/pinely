// Read-only preflight for a Robinhood Chain deployment. It sends no transaction and never reads a private key.
//
//   bun run deploy:preflight testnet
//   bun run deploy:preflight mainnet
//
// It reads contracts/.env (the same file `forge script` uses), then checks the RPC, the chain id, the EntryPoint,
// the stablecoin and the deployer balance, and prints PASS, WARN or FAIL per check. Exit code 1 on any FAIL.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  formatEther,
  getAddress,
  http,
  isAddress,
  parseAbi,
  zeroAddress,
} from "viem";
import { getChainProfile, robinhoodMainnet, robinhoodTestnet } from "../shared/chains/index.ts";
import { externalAddresses } from "../shared/contracts/external.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = process.argv[2];
if (target !== "testnet" && target !== "mainnet") {
  console.error("Usage: bun run deploy:preflight <testnet|mainnet>");
  process.exit(2);
}
const chain = target === "mainnet" ? robinhoodMainnet : robinhoodTestnet;
const profile = getChainProfile(chain.id);

// Minimal .env parser (KEY=VALUE, # comments). Values already in the process environment win.
const envPath = join(root, "contracts", ".env");
const env = { ...process.env };
if (existsSync(envPath)) {
  for (const raw of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const key = line.slice(0, i).trim();
    const value = line
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, "");
    if (!(key in env) || env[key] === "") env[key] = value;
  }
}

let failed = false;
const report = (level, name, detail) => {
  if (level === "FAIL") failed = true;
  console.log(`${level.padEnd(4)}  ${name}${detail ? `: ${detail}` : ""}`);
};
const addressVar = (key, { required }) => {
  const v = env[key];
  if (!v) return report(required ? "FAIL" : "WARN", key, "not set");
  if (!isAddress(v)) return report("FAIL", key, "not a valid address");
  if (getAddress(v) === zeroAddress) return report("FAIL", key, "is the zero address");
  report("PASS", key, getAddress(v));
  return getAddress(v);
};

console.log(`Preflight for ${chain.name} (chain ${chain.id}). Read-only.\n`);

const rpcKey = target === "mainnet" ? "RPC_URL_ROBINHOOD_MAINNET" : "RPC_URL_ROBINHOOD_TESTNET";
const rpcUrl = env[rpcKey];
if (!rpcUrl) {
  report("FAIL", rpcKey, "not set in contracts/.env");
  process.exit(1);
}

const deployer = addressVar("DEPLOYER_ADDRESS", { required: true });
const entryPoint = addressVar("ENTRY_POINT", { required: true });
const stablecoin = addressVar("STABLECOIN_ADDRESS", { required: target === "mainnet" });
const treasury = addressVar("TREASURY_ADDRESS", { required: target === "mainnet" });
if (target === "testnet" && !stablecoin) {
  const mock = env.ALLOW_MOCK_STABLECOIN === "true";
  report(
    mock ? "WARN" : "FAIL",
    "stablecoin",
    mock
      ? "ALLOW_MOCK_STABLECOIN=true: a mock will be deployed"
      : "no STABLECOIN_ADDRESS and mocks are not allowed",
  );
}
if (target === "mainnet" && env.ALLOW_MOCK_STABLECOIN === "true")
  report("FAIL", "ALLOW_MOCK_STABLECOIN", "must not be true on mainnet");

const min = env.NATIVE_PRICE_MIN;
const max = env.NATIVE_PRICE_MAX;
if (!/^\d+$/.test(min ?? "") || !/^\d+$/.test(max ?? "")) {
  report("FAIL", "NATIVE_PRICE_MIN / NATIVE_PRICE_MAX", "both are required (integers, 8 decimals)");
} else if (BigInt(min) === 0n || BigInt(max) < BigInt(min) || BigInt(max) > 10n * BigInt(min)) {
  report("FAIL", "NATIVE_PRICE_MIN / NATIVE_PRICE_MAX", "need 0 < min <= max <= 10 x min");
} else {
  report(
    "PASS",
    "NATIVE_PRICE_MIN / NATIVE_PRICE_MAX",
    `${Number(min) / 1e8} to ${Number(max) / 1e8} USD`,
  );
}

const client = createPublicClient({ chain, transport: http(rpcUrl) });
try {
  const id = await client.getChainId();
  report(id === chain.id ? "PASS" : "FAIL", "RPC chain id", `${id} (expected ${chain.id})`);
  if (id !== chain.id) process.exit(1);
} catch (error) {
  report(
    "FAIL",
    "RPC",
    `unreachable (${error instanceof Error ? error.message.split("\n")[0] : "error"})`,
  );
  process.exit(1);
}

if (entryPoint) {
  const code = await client.getCode({ address: entryPoint });
  report(
    code && code !== "0x" ? "PASS" : "FAIL",
    "EntryPoint bytecode",
    code && code !== "0x" ? `${(code.length - 2) / 2} bytes` : "no code at address",
  );
}

if (stablecoin) {
  const code = await client.getCode({ address: stablecoin });
  if (!code || code === "0x") {
    report("FAIL", "Stablecoin bytecode", "no code at address");
  } else {
    const erc20 = parseAbi([
      "function decimals() view returns (uint8)",
      "function symbol() view returns (string)",
    ]);
    try {
      const [decimals, symbol] = await Promise.all([
        client.readContract({ address: stablecoin, abi: erc20, functionName: "decimals" }),
        client.readContract({ address: stablecoin, abi: erc20, functionName: "symbol" }),
      ]);
      report(
        decimals === 6 ? "PASS" : "FAIL",
        "Stablecoin decimals",
        `${symbol}, ${decimals} (expected 6)`,
      );
      if (symbol !== profile.stablecoinSymbol)
        report(
          "WARN",
          "Stablecoin symbol",
          `${symbol}, the profile expects ${profile.stablecoinSymbol}. Confirm the address in the official documentation.`,
        );
    } catch {
      report("FAIL", "Stablecoin", "decimals() or symbol() reverted: not an ERC-20");
    }
  }
}

if (deployer) {
  const balance = await client.getBalance({ address: deployer });
  report(
    balance > 0n ? "PASS" : "FAIL",
    `Deployer ${profile.nativeSymbol} balance`,
    `${formatEther(balance)} ${profile.nativeSymbol} (Stage 1 needs about 0.0003 ${profile.nativeSymbol} at a 0.02 gwei base fee, plus the Paymaster deposit and stake)`,
  );
  const code = await client.getCode({ address: deployer });
  if (code && code !== "0x")
    report(
      "WARN",
      "Deployer",
      "has contract code (a Safe?). The deployer should be a plain keystore account.",
    );
}
if (treasury && deployer && treasury === deployer) {
  if (target === "mainnet")
    report("FAIL", "TREASURY_ADDRESS", "equals the deployer (mainnet requires a Safe)");
  else
    report(
      "PASS",
      "Ownership",
      "treasury equals the deployer: the deployer stays owner and configures the Paymaster itself",
    );
} else if (treasury && deployer) {
  report(
    "WARN",
    "Ownership",
    `the script hands Registry and Paymaster ownership to ${treasury}; the Paymaster setup (setNativePrice, deposit, stake) must then be sent from that account`,
  );
}
if (target === "mainnet") {
  // The public RPC is rate limited and, per the Robinhood Chain documentation, not meant for production.
  if (new URL(rpcUrl).host === "rpc.mainnet.chain.robinhood.com")
    report(
      "WARN",
      rpcKey,
      "public RPC: use a provider endpoint for deployment and for the indexer backfill",
    );

  // The stablecoin must be exactly the address pinned in the SSOT (which matches the Paxos documentation).
  const pinned = externalAddresses[String(chain.id)]?.STABLECOIN;
  if (stablecoin && pinned && getAddress(pinned) !== stablecoin)
    report(
      "FAIL",
      "STABLECOIN_ADDRESS",
      `differs from the address pinned in shared/contracts/external.ts (${getAddress(pinned)})`,
    );
  else if (stablecoin && pinned) report("PASS", "STABLECOIN_ADDRESS matches the SSOT", "");

  // USDG is an upgradeable, issuer-controlled token: print who controls it so the owner sees the trust assumption.
  if (stablecoin) {
    const control = parseAbi([
      "function owner() view returns (address)",
      "function paused() view returns (bool)",
    ]);
    const [owner, paused] = await Promise.all([
      client
        .readContract({ address: stablecoin, abi: control, functionName: "owner" })
        .catch(() => null),
      client
        .readContract({ address: stablecoin, abi: control, functionName: "paused" })
        .catch(() => null),
    ]);
    report(
      paused === true ? "FAIL" : "PASS",
      "Stablecoin paused",
      paused === null ? "not readable" : String(paused),
    );
    report(
      "WARN",
      "Stablecoin controller",
      `owner ${owner ?? "not readable"}: the issuer can upgrade, pause or freeze`,
    );
  }

  if (entryPoint && entryPoint !== "0x0000000071727De22E5E9d8BAf0edAc6f37da032")
    report("FAIL", "ENTRY_POINT", "mainnet must use the canonical EntryPoint v0.7");

  // Treasury must be a Safe with threshold 2 and exactly 3 owners, none of them the deployer (the deploy script
  // enforces the same rules; failing here is cheaper than failing during the broadcast).
  if (treasury) {
    const code = await client.getCode({ address: treasury });
    if (!code || code === "0x") {
      report(
        "FAIL",
        "Treasury is a contract",
        "no code at TREASURY_ADDRESS: mainnet requires a Safe 2-of-3",
      );
    } else {
      const safe = parseAbi([
        "function getThreshold() view returns (uint256)",
        "function getOwners() view returns (address[])",
      ]);
      try {
        const [threshold, owners] = await Promise.all([
          client.readContract({ address: treasury, abi: safe, functionName: "getThreshold" }),
          client.readContract({ address: treasury, abi: safe, functionName: "getOwners" }),
        ]);
        report(threshold === 2n ? "PASS" : "FAIL", "Safe threshold", `${threshold} (expected 2)`);
        report(
          owners.length === 3 ? "PASS" : "FAIL",
          "Safe owners",
          `${owners.length} (expected 3)`,
        );
        report(
          new Set(owners.map((o) => o.toLowerCase())).size === owners.length ? "PASS" : "FAIL",
          "Safe owners are distinct",
          "",
        );
        if (deployer && owners.some((o) => o.toLowerCase() === deployer.toLowerCase()))
          report("FAIL", "Safe owners", "the deployer is a Safe owner");
      } catch {
        report("FAIL", "Treasury is a Safe", "getThreshold() or getOwners() reverted");
      }
    }
  }

  // The bundler is optional for the contract deployment but required before the services can sponsor anything.
  const bundlerUrl = env.BUNDLER_RPC_URL_MAINNET || env.BUNDLER_RPC_URL;
  if (!bundlerUrl) {
    report(
      "WARN",
      "BUNDLER_RPC_URL",
      "not set: sponsored UserOperations will not work until a bundler is configured",
    );
  } else {
    try {
      const res = await fetch(bundlerUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_supportedEntryPoints",
          params: [],
        }),
      });
      const body = await res.json();
      const supported = Array.isArray(body.result)
        ? body.result.map((a) => String(a).toLowerCase())
        : [];
      report(
        supported.includes("0x0000000071727de22e5e9d8baf0edac6f37da032") ? "PASS" : "FAIL",
        "Bundler supports EntryPoint v0.7",
        supported.length ? supported.join(", ") : JSON.stringify(body.error ?? "no result"),
      );
    } catch (error) {
      report(
        "FAIL",
        "Bundler",
        `unreachable (${error instanceof Error ? error.message.split("\n")[0] : "error"})`,
      );
    }
  }
}

console.log(
  failed
    ? "\nPreflight FAILED. Do not deploy."
    : "\nPreflight passed. This is not a substitute for the dry run.",
);
process.exit(failed ? 1 : 0);
