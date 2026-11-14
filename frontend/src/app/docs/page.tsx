"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Navbar } from "@/components/pinely/Navbar";
import { PageBackground } from "@/components/pinely/PageBackground";
import { Footer } from "@/components/pinely/Footer";
import { TextScramble } from "@/components/pinely/TextScramble";
import { StageBadge, Stage2ContractBadge } from "@/components/pinely/StageBadge";
import { isPublicChainId, robinhoodTestnet, robinhoodMainnet } from "@pinely/shared/chains";
import { activeChain as buildChain, nativeSymbol, stablecoinSymbol } from "@/lib/chain";
import { findContractAddress } from "@pinely/shared/contracts";

interface ProtocolContractEntry {
  name: string;
  lookupKey: string;
  desc: string;
  stage: "Stage 1" | "Stage 2" | "Official" | "Governance";
}

const PROTOCOL_CONTRACTS: ProtocolContractEntry[] = [
  // Stage 1: Account Abstraction & Core DePIN Infrastructure
  {
    name: "MachineRegistry",
    lookupKey: "MachineRegistry",
    desc: "Hardware chip registry & onchain status tracker",
    stage: "Stage 1",
  },
  {
    name: "PinelyAccountFactory",
    lookupKey: "PinelyAccountFactory",
    desc: "ERC-4337 factory with CREATE2 deterministic salt (PINELY_ACCOUNT_V1)",
    stage: "Stage 1",
  },
  {
    name: "PinelyPaymaster",
    lookupKey: "PinelyPaymaster",
    desc: "Native-token gas sponsor & stablecoin settlement with bounded rates",
    stage: "Stage 1",
  },
  {
    name: "SurplusSweeper",
    lookupKey: "SurplusSweeper",
    desc: "Automated machine surplus keeper & Safe treasury sweeper",
    stage: "Stage 1",
  },
  // Official Network Tokens & Standard Infrastructure
  {
    name: `${stablecoinSymbol} stablecoin`,
    lookupKey: "STABLECOIN",
    desc: "6-decimal settlement stablecoin",
    stage: "Official",
  },
  {
    name: "$PINELY token",
    lookupKey: "PINELY",
    desc: "Official PINELY ERC-20 on Robinhood Chain mainnet (18 decimals). Not used by the protocol contracts yet",
    stage: "Official",
  },
  {
    name: "ERC-4337 EntryPoint v0.7",
    lookupKey: "EntryPoint",
    desc: "Canonical ERC-4337 v0.7 EntryPoint singleton",
    stage: "Official",
  },
  {
    name: "Multicall3",
    lookupKey: "Multicall3",
    desc: "Canonical batch and read aggregator",
    stage: "Official",
  },
  // Governance
  {
    name: "Safe Multisig Factory",
    lookupKey: "SafeProxyFactory",
    desc: "Safe 1.3.0 proxy factory for 2-of-3 multisig governance & treasury",
    stage: "Governance",
  },
  // Stage 2: Liquidity, Dynamic Routing & Staking
  {
    name: "Uniswap v4 PoolManager",
    lookupKey: "PoolManager",
    desc: "Singleton liquidity manager for Robinhood Chain private pools",
    stage: "Stage 2",
  },
  {
    name: "PinelyHook",
    lookupKey: "PinelyHook",
    desc: "Uniswap v4 BaseHook: Machine, Policy, Freeze & Tier guards",
    stage: "Stage 2",
  },
  {
    name: "PinelyRouter",
    lookupKey: "PinelyRouter",
    desc: "Stateless swap router binding machine session key to pool via hookData",
    stage: "Stage 2",
  },
  {
    name: "BurnVault",
    lookupKey: "BurnVault",
    desc: "Protocol fee recipient & permissionless $PINELY burner",
    stage: "Stage 2",
  },
  {
    name: "PinelyStake",
    lookupKey: "PinelyStake",
    desc: "Reputational staking vault with 7-day timelock cooldown",
    stage: "Stage 2",
  },
];

export default function DocsPage() {
  const [activeTab, setActiveTab] = useState<"ts" | "py" | "ros2">("ts");
  const [activeNetwork, setActiveNetwork] = useState<"testnet" | "mainnet">(
    isPublicChainId(buildChain.id) ? "mainnet" : "testnet",
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const activeChain = activeNetwork === "testnet" ? robinhoodTestnet : robinhoodMainnet;
  const explorerUrl = activeChain.blockExplorers.default.url;

  const codeSnippets = {
    ts: `// 1. Install the SDK (beta, not externally audited)
bun add @pinely-protocol/sdk@beta   // or: npm install @pinely-protocol/sdk@beta

// 2. Connect. The development key store is for testing only: never use it in production.
//    Key stores of type "tpm" fail closed: they throw when no hardware module is present.
import { Pinely } from "@pinely-protocol/sdk";

const pinely = await Pinely.connect({
  chain: "robinhoodTestnet", // chain 46630
  registryAddress: "0x...", // MachineRegistry, from the address book
  paymasterAddress: "0x...", // PinelyPaymaster
  keyStore: { type: "file-dev-only", privateKey: process.env.MACHINE_PRIVATE_KEY as \`0x\${string}\` }, // never commit a key
  rpcUrl: process.env.RPC_URL_ROBINHOOD_TESTNET,
});
const machine = await pinely.machines.create({ name: "charger-01", operator: "0x..." });

// 3. Pay a charging dock over HTTP 402. The SDK reads the dock's 402 challenge, has the
//    Facilitator prepare a gas-sponsored UserOperation, checks it, signs it and submits it.
const result = await machine.pay({
  url: "https://facilitator.example/v1/charge/dock-001",
  maxAmount: 100_000n, // 0.10 ${stablecoinSymbol} (6 decimals): the most this machine will pay
  facilitatorUrl: "https://facilitator.example",
});

// "settled" only after the Facilitator confirms the payment onchain.
console.log(result.status, result.txHash);

// Command line equivalent:
// pinely pay --url https://facilitator.example/v1/charge/dock-001 \\
//   --max-amount 100000 --facilitator https://facilitator.example`,

    py: `# 1. Install from PyPI (beta, not externally audited)
pip install pinely-sdk

# 2. Connect. The Python SDK keeps the key in memory: for development only.
#    It covers signing and HTTP 402 payments; it has no onchain reads or hardware key store yet.
import os
from pinely_sdk import Pinely

pinely = Pinely.connect(
    private_key=os.environ["MACHINE_PRIVATE_KEY"],  # development key only: never commit it
    chain_id=${robinhoodTestnet.id},  # ${robinhoodTestnet.name}
    registry_address="0x...",  # MachineRegistry, from the address book
    stablecoin_address="0x...",  # ${stablecoinSymbol}, from the official network documentation
    paymaster_address="0x...",  # PinelyPaymaster, required for payments
)
machine = pinely.machines.create(name="autonomous-delivery-01", operator="0x...")

# 3. Pay over HTTP 402 through the Facilitator
result = machine.pay(
    "https://facilitator.example/v1/charge/dock-001",
    max_amount=250_000,  # 0.25 ${stablecoinSymbol} (6 decimals): the most this machine will pay
    facilitator_url="https://facilitator.example",
)

# "settled" only after the Facilitator confirms the payment onchain.
print(result["status"], result.get("txHash"))`,

    ros2: `# 1. Launch the PINELY ROS2 node
#    Coming soon as a package. For now, build it from the ros2/ folder of the repository.
ros2 run pinely_ros2 pinely_node --ros-args \\
  -p operator:="0x..." \\
  -p registry_address:="0x..." \\
  -p stablecoin_address:="0x..." \\
  -p paymaster_address:="0x..." \\
  -p facilitator_url:="https://facilitator.example" \\
  -p daily_cap_stable:=5.0 \\
  -p key_file_path:="/etc/pinely/machine.key"

# 2. Telemetry topics
# /pinely/status   -> machine status (tier stays "unknown" until read from the chain)
# /pinely/balance  -> ${stablecoinSymbol} balance (NaN until read from the chain)

# 3. Pay for a service over HTTP 402
ros2 service call /pinely/pay_service pinely_ros2/srv/PayService \\
  "{url: 'https://facilitator.example/v1/charge/dock-001', max_amount: 250000, resource_id: 'dock-001'}"

# The call succeeds only when the Facilitator confirms the payment and returns a transaction hash.`,
  };

  return (
    <div className="frame">
      <PageBackground word="DOCS" variant="reading" />
      <Navbar />
      <main id="main-content">

      {/* Header */}
      <section className="ph ph-haze ph-haze-docs page-reveal-hero">
        <span className="tag">
          <b className="dot" aria-hidden="true" />
          <TextScramble text="DEVELOPER REFERENCE · PROTOCOL SPEC" scrambleSpeed={22} revealSpeed={32} />
        </span>
        <h1>From device to onchain wallet.</h1>
        <p>
          Comprehensive developer guides for hardware roboticists, smart contract engineers, and
          fleet operators. SDKs for TypeScript and Python are published in beta; the ROS2 node is
          available from the repository.
        </p>
      </section>

      {/* Multi-Language SDK Quickstart Section */}
      <section className="sec page-reveal-1" id="start" style={{ paddingTop: "24px" }}>
        <div className="sh">
          <span className="tag">
            <b className="dot" aria-hidden="true" /> Client SDKs
          </span>
          <h2>Install an SDK and connect a machine.</h2>
          <p>
            The target design signs inside a hardware secure element so keys never leave the device.
            That support is planned: the SDK key stores are software today. Both published SDKs are
            beta releases and have not been externally audited. Gas is sponsored by the PINELY
            Paymaster.
          </p>
        </div>

        {/* Code Container with Tabs */}
        <div className="docs-code-container">
          <div className="docs-code-header">
            <div className="docs-tab-bar" style={{ position: "relative" }}>
              {[
                { id: "ts", label: "TypeScript / CLI (@pinely-protocol/sdk)" },
                { id: "py", label: "Python (pinely-sdk)" },
                { id: "ros2", label: "ROS2 Node (pinely_ros2)" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id as "ts" | "py" | "ros2")}
                  className={`docs-tab-btn ${activeTab === tab.id ? "active" : ""}`}
                  style={{ position: "relative" }}
                >
                  {activeTab === tab.id && (
                    <motion.span
                      layoutId="docs-active-tab"
                      className="docs-active-tab-bg"
                      transition={{ type: "spring", stiffness: 400, damping: 30 }}
                      style={{
                        position: "absolute",
                        inset: 0,
                        background: "rgba(224, 72, 107, 0.16)",
                        borderBottom: "2px solid var(--bl)",
                        zIndex: 0,
                        pointerEvents: "none",
                      }}
                    />
                  )}
                  <span style={{ position: "relative", zIndex: 1 }}>{tab.label}</span>
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => copyToClipboard(codeSnippets[activeTab], "snippet")}
              className="copy-hash-btn"
            >
              {copiedKey === "snippet" ? "✓ Copied!" : "Copy Code"}
            </button>
          </div>

          <pre
            tabIndex={0}
            aria-label="Code sample"
            className="font-mono text-xs"
            style={{
              padding: "20px 24px",
              color: "#ffffff",
              lineHeight: 1.6,
              overflowX: "auto",
              margin: 0,
            }}
          >
            {codeSnippets[activeTab]}
          </pre>
        </div>
      </section>

      {/* Architecture & Logic Flow */}
      <section className="sec" style={{ paddingTop: "48px" }}>
        <div className="sh">
          <span className="tag">
            <b className="dot" aria-hidden="true" /> Protocol Architecture
          </span>
          <h2>The Four-Stage Execution Pipeline</h2>
          <p>
            How an autonomous physical device triggers a transaction on a public street and settles
            on Robinhood Chain without custody risk.
          </p>
        </div>

        <div className="grid">
          <div className="card">
            <span className="text-xs text-crimson-400">Step 1</span>
            <h3 style={{ marginTop: "6px" }}>Device signing</h3>
            <p className="note" style={{ lineHeight: 1.5 }}>
              The device builds an EIP-712 spend intent and signs it with its session key. The goal
              is to hold that key in a secure element such as the NXP SE050 or a TPM 2.0 so it
              cannot be exported; today the SDK signs with a software key store.
            </p>
          </div>

          <div className="card">
            <span className="text-xs text-crimson-400">Step 2</span>
            <h3 style={{ marginTop: "6px" }}>UserOp Dispatch</h3>
            <p className="note" style={{ lineHeight: 1.5 }}>
              The intent becomes an ERC-4337 UserOperation. The machine signs its hash with its
              session key and submits it to a bundler.
            </p>
          </div>

          <div className="card">
            <span className="text-xs text-crimson-400">Step 3</span>
            <h3 style={{ marginTop: "6px" }}>PinelyPaymaster</h3>
            <p className="note" style={{ lineHeight: 1.5 }}>
              Paymaster checks the account&apos;s prepaid {stablecoinSymbol} credit, advances native{" "}
              {nativeSymbol} gas for EVM execution, and bills it in {stablecoinSymbol}.
            </p>
          </div>

          <div className="card hl">
            <span className="text-xs text-crimson-400">Step 4</span>
            <h3 style={{ marginTop: "6px" }}>PinelyHook (Uniswap v4, Stage 2: deployed, not in use yet)</h3>
            <p style={{ fontSize: "14px", lineHeight: 1.5, color: "#f0dde2" }}>
              Planned: the hook will evaluate 4 immutable guards (Machine Gate, Spend Policy, Kill Switch, and Tier Fee Cooling), and any violation will revert onchain, fail-closed. It is not deployed, so Stage 1 has no onchain spend cap.
            </p>
          </div>
        </div>
      </section>

      {/* Facilitator: HTTP 402 machine payments */}
      <section className="sec" id="facilitator" style={{ paddingTop: "48px" }}>
        <div className="sh">
          <span className="tag">
            <b className="dot" aria-hidden="true" /> PINELY Facilitator
          </span>
          <h2>How a machine pays over HTTP 402.</h2>
          <p>
            The Facilitator lets a charging dock, an API or a data provider get paid in {stablecoinSymbol} by a
            machine, using the x402 pattern. It prepares and confirms the payment; it never holds
            the machine&apos;s key.
          </p>
        </div>

        <div className="grid">
          <div className="card">
            <span className="text-xs text-crimson-400">Step 1</span>
            <h3 style={{ marginTop: "6px" }}>The service answers HTTP 402</h3>
            <p className="note" style={{ lineHeight: 1.5 }}>
              The machine asks a charging dock, API or data provider for a resource. The provider
              answers HTTP 402 with the payment requirements: the amount, {stablecoinSymbol}, the address to pay
              and the network.
            </p>
          </div>

          <div className="card">
            <span className="text-xs text-crimson-400">Step 2</span>
            <h3 style={{ marginTop: "6px" }}>The machine signs what it will pay</h3>
            <p className="note" style={{ lineHeight: 1.5 }}>
              The machine signs an EIP-712 Payment402Intent: machine ID, resource, amount, a
              one-time nonce and a deadline. The signing domain is PINELYFacilitator, bound to the
              chain ID.
            </p>
          </div>

          <div className="card">
            <span className="text-xs text-crimson-400">Step 3</span>
            <h3 style={{ marginTop: "6px" }}>The Facilitator checks and prepares</h3>
            <p className="note" style={{ lineHeight: 1.5 }}>
              It checks the signature against the session key registered in MachineRegistry, rejects
              an expired or reused intent and a frozen machine or fleet, then returns an unsigned,
              gas-sponsored UserOperation.
            </p>
          </div>

          <div className="card">
            <span className="text-xs text-crimson-400">Step 4</span>
            <h3 style={{ marginTop: "6px" }}>The machine verifies before it signs</h3>
            <p className="note" style={{ lineHeight: 1.5 }}>
              The SDK checks the UserOperation field by field and refuses one that pays another
              recipient or token, a larger amount, another Paymaster or inflated gas. Only then does
              it sign and submit.
            </p>
          </div>

          <div className="card hl">
            <span className="text-xs text-crimson-400">Step 5</span>
            <h3 style={{ marginTop: "6px" }}>Confirmation unlocks access</h3>
            <p style={{ fontSize: "14px", lineHeight: 1.5, color: "#f0dde2" }}>
              The Facilitator returns an access token only after the payment is confirmed onchain.
              The provider receives the amount minus the Facilitator fee.
            </p>
          </div>
        </div>

        <div className="card" style={{ padding: "20px 22px", marginTop: "20px" }}>
          <h3>What you can rely on</h3>
          <ul className="note" style={{ lineHeight: 1.7, paddingLeft: "18px", margin: "8px 0 0" }}>
            <li>
              <b>Rail:</b> ERC-4337 with the PINELY Paymaster. The machine needs no {nativeSymbol} for gas.
            </li>
            <li>
              <b>Fee:</b> 0.1% of each payment (10 basis points by default), taken only when a fee
              recipient is configured. The SDK refuses a fee above its limit, 1% by default.
            </li>
            <li>
              <b>Never simulated:</b> without a Facilitator URL the SDK returns a failed result,
              never a made-up success.
            </li>
            <li>
              <b>Replay protection:</b> every intent carries a one-time nonce and a deadline; a
              reused nonce is rejected.
            </li>
            <li>
              <b>Spend limits:</b> Stage 2, deployed but not in use yet. The PinelyHook Spend Policy is meant to enforce the daily limit onchain, not the Facilitator. Stage 1 has no onchain spend cap today.
            </li>
          </ul>
        </div>

        <h3 style={{ margin: "28px 0 12px" }}>Facilitator endpoints</h3>
        <div className="tw" role="region" aria-label="Facilitator endpoints table" tabIndex={0}>
          <table className="tbl font-mono">
            <thead>
              <tr>
                <th scope="col">Endpoint</th>
                <th scope="col">Purpose</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>GET /v1/charge/:id</td>
                <td>Reference HTTP 402 challenge for a charging request</td>
              </tr>
              <tr>
                <td>GET /v1/capability</td>
                <td>Reports the settlement rail</td>
              </tr>
              <tr>
                <td>POST /v1/verify</td>
                <td>Verifies a signed payment intent before payment</td>
              </tr>
              <tr>
                <td>POST /v1/settle/prepare</td>
                <td>Returns the unsigned, gas-sponsored UserOperation</td>
              </tr>
              <tr>
                <td>POST /v1/settle</td>
                <td>
                  Submits the signed UserOperation and returns the access token after confirmation
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* SSOT Contract Book & Network Switcher */}
      <section className="sec" id="chain" style={{ paddingTop: "48px" }}>
        <div className="sh">
          <span className="tag">
            <b className="dot" aria-hidden="true" /> Contract Address Book
          </span>
          <h2>Official SSOT Contract Registry</h2>
          <p>
            Official deployment addresses synchronized from Foundry compilation artifacts across{" "}
            {robinhoodTestnet.name} ({robinhoodTestnet.id}) and {robinhoodMainnet.name} (
            {robinhoodMainnet.id}).
          </p>
        </div>

        {/* Network Switcher Tabs */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
          <button
            type="button"
            onClick={() => setActiveNetwork("testnet")}
            className={`filter-btn ${activeNetwork === "testnet" ? "active" : ""}`}
          >
            {robinhoodTestnet.name} (Chain ID: {robinhoodTestnet.id})
          </button>
          <button
            type="button"
            onClick={() => setActiveNetwork("mainnet")}
            className={`filter-btn ${activeNetwork === "mainnet" ? "active" : ""}`}
          >
            {robinhoodMainnet.name} (Chain ID: {robinhoodMainnet.id})
          </button>
        </div>

        {/* Contract Address Table */}
        <div className="tw" role="region" aria-label="Contract address book table" tabIndex={0}>
          <table className="tbl font-mono">
            <thead>
              <tr>
                <th scope="col">Contract Name</th>
                <th scope="col">Functional Scope</th>
                <th scope="col">Rollout Stage</th>
                <th scope="col">Onchain Address (SSOT)</th>
                <th scope="col">Action</th>
              </tr>
            </thead>
            <tbody>
              {PROTOCOL_CONTRACTS.map((c) => {
                const address = findContractAddress(activeChain.id, c.lookupKey);
                const isDeployed = Boolean(address);
                return (
                  <tr key={c.lookupKey}>
                    <td>
                      <strong style={{ color: "#ffffff" }}>{c.name}</strong>
                    </td>
                    <td style={{ color: "var(--mut-light)", fontSize: "12px" }}>{c.desc}</td>
                    <td>
                      <span
                        className={`tier-pill ${
                          c.stage === "Stage 1"
                            ? "gold"
                            : c.stage === "Official" || c.stage === "Governance"
                              ? "silver"
                              : "bronze"
                        }`}
                      >
                        {c.stage}
                      </span>
                    </td>
                    <td>
                      {isDeployed && address ? (
                        <div style={{ display: "grid", gap: "6px", justifyItems: "start" }}>
                          c.stage === "Stage 2" && activeNetwork === "mainnet" ? (
                            <Stage2ContractBadge />
                          ) : (
                            <StageBadge variant={activeNetwork === "mainnet" ? "live" : "testnet"} />
                          )
                          <code style={{ fontSize: "12px", color: "#ffffff" }} title={address}>
                            {`${address.substring(0, 10)}...${address.substring(address.length - 8)}`}
                          </code>
                        </div>
                      ) : (
                        <span
                          style={{
                            color: "var(--mut-light, #9a8a90)",
                            fontStyle: "italic",
                            fontSize: "12px",
                          }}
                        >
                          {c.stage === "Stage 2" ? <StageBadge variant="stage2" /> : "Pending deployment"}
                        </span>
                      )}
                    </td>
                    <td>
                      {isDeployed && address ? (
                        <div style={{ display: "inline-flex", gap: "6px", alignItems: "center" }}>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(address, c.lookupKey)}
                            className="copy-hash-btn"
                          >
                            {copiedKey === c.lookupKey ? "✓ Copied" : "Copy"}
                          </button>
                          <a
                            href={`${explorerUrl}/address/${address}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="copy-hash-btn"
                            style={{
                              textDecoration: "none",
                              display: "inline-flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                            title={`View on ${activeChain.name} Explorer`}
                          >
                            Explorer ↗
                          </a>
                        </div>
                      ) : (
                        <span style={{ color: "var(--mut-light, #6d6368)", fontSize: "12px" }}>
                          —
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Critical Developer Warnings Banner */}
        <div
          style={{
            marginTop: "24px",
            padding: "20px 24px",
            borderRadius: "12px",
            background: "rgba(38, 10, 20, 0.7)",
            border: "1px solid rgba(224, 72, 107, 0.35)",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span className="pulse-beacon red" />
            <strong className="text-sm" style={{ color: "#ffffff" }}>
              Critical Block Time Guidelines
            </strong>
          </div>
          <p className="note" style={{ color: "#ecd8de", lineHeight: 1.5, margin: 0 }}>
            Consecutive blocks can share one <code className="font-mono text-zinc-100">block.timestamp</code>. On this chain,{" "}
            <code className="font-mono text-zinc-100">block.number</code> in Solidity is the parent
            chain&apos;s block number, not this chain&apos;s: <strong>never</strong> use it as a
            unit of time or as an indexer start block. Evaluate daily limits, cooldowns, and
            authorization deadlines strictly with{" "}
            <code className="font-mono text-zinc-100">block.timestamp</code>, and take the indexer
            start block from the deployment transaction receipt. Import the canonical chain
            configuration from <code className="font-mono text-zinc-100">@pinely/shared/chains</code>
            .
          </p>
        </div>
      </section>

      </main>
      <Footer />
    </div>
  );
}
