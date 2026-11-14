"use client";

import { useState } from "react";
import { robinhoodMainnet, robinhoodTestnet } from "@pinely/shared/chains";
import { findContractAddress, findDeployTx } from "@pinely/shared/contracts";
import { MAINNET_CONTRACT_OWNERS, PROTOCOL_SAFE, STATUS_AS_OF } from "@pinely/shared/status";
import { Navbar } from "@/components/pinely/Navbar";
import { PageBackground } from "@/components/pinely/PageBackground";
import { Footer } from "@/components/pinely/Footer";
import { StageBadge } from "@/components/pinely/StageBadge";

type Network = "mainnet" | "testnet";

interface Entry {
  name: string;
  /** Key in the address book (`shared/contracts`). */
  key: string;
  note: string;
}

const STAGE_1: Entry[] = [
  {
    name: "MachineRegistry",
    key: "MachineRegistry",
    note: "Machine identity, spend policies, freeze and kill switch",
  },
  {
    name: "PinelyAccountFactory",
    key: "PinelyAccountFactory",
    note: "Deploys the smart account of each machine",
  },
  {
    name: "PinelyPaymaster",
    key: "PinelyPaymaster",
    note: "Pays gas in ETH and bills the account in USDG",
  },
  {
    name: "SurplusSweeper",
    key: "SurplusSweeper",
    note: "Moves surplus balance above a reserve to a destination",
  },
];

const EXTERNAL: Entry[] = [
  {
    name: "Protocol Safe",
    key: "ProtocolSafe",
    note: "The multisig that owns MachineRegistry and PinelyPaymaster",
  },
  { name: "$PINELY token", key: "PINELY", note: "The token contract. Exists on mainnet only" },
  {
    name: "USDG",
    key: "STABLECOIN",
    note: "Settlement stablecoin, 6 decimals. On testnet this is a mock token",
  },
  { name: "EntryPoint v0.7", key: "EntryPoint", note: "The ERC-4337 EntryPoint" },
];

const STAGE_2: Entry[] = [
  { name: "PinelyHook", key: "PinelyHook", note: "Uniswap v4 hook with the four guards" },
  { name: "PinelyRouter", key: "PinelyRouter", note: "Routes machine swaps into the private pool" },
  { name: "BurnVault", key: "BurnVault", note: "Receives protocol fees and burns $PINELY" },
  {
    name: "PinelyStake",
    key: "PinelyStake",
    note: "Reputation staking with a 7-day unbonding period",
  },
];

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

export default function ContractsPage() {
  // Mainnet is what readers came to check, whatever network this build targets.
  const [network, setNetwork] = useState<Network>("mainnet");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const chain = network === "mainnet" ? robinhoodMainnet : robinhoodTestnet;
  const explorer = chain.blockExplorers.default.url;
  const address = (key: string) => findContractAddress(chain.id, key);

  const copy = async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
    } catch {
      // Clipboard access denied: the address is on screen and behind the explorer link.
      setCopiedKey(null);
      return;
    }
    setTimeout(() => setCopiedKey((current) => (current === key ? null : current)), 2000);
  };

  const registry = address("MachineRegistry");
  const paymaster = address("PinelyPaymaster");
  const safe = address("ProtocolSafe");

  const verifyLines = [
    "# Use any RPC endpoint for the selected network.",
    "export RPC_URL=<your Robinhood Chain RPC endpoint>",
    ...(registry
      ? [
          "",
          "# Who owns the registry?",
          `cast call ${registry} "owner()(address)" --rpc-url $RPC_URL`,
        ]
      : []),
    ...(paymaster
      ? [
          "",
          "# Who owns the paymaster?",
          `cast call ${paymaster} "owner()(address)" --rpc-url $RPC_URL`,
        ]
      : []),
    ...(safe
      ? [
          "",
          "# Is that owner a multisig, and how many signatures does it need?",
          `cast call ${safe} "getThreshold()(uint256)" --rpc-url $RPC_URL`,
          `cast call ${safe} "getOwners()(address[])" --rpc-url $RPC_URL`,
        ]
      : []),
    ...(registry
      ? [
          "",
          "# The registration fee, in USDG with 6 decimals (2000000 means 2 USDG)",
          `cast call ${registry} "registrationFee()(uint256)" --rpc-url $RPC_URL`,
        ]
      : []),
  ];

  const renderAddress = (entry: Entry, value: string) => (
    <div style={{ display: "grid", gap: "6px", justifyItems: "start" }}>
      <StageBadge variant={network === "mainnet" ? "live" : "testnet"} />
      <code style={{ fontSize: "12px", color: "#ffffff", overflowWrap: "anywhere" }}>{value}</code>
      <div style={{ display: "inline-flex", gap: "6px", flexWrap: "wrap" }}>
        <button
          type="button"
          className="copy-hash-btn"
          onClick={() => copy(value, `${network}-${entry.key}`)}
          aria-label={`Copy the ${entry.name} address`}
        >
          {copiedKey === `${network}-${entry.key}` ? "✓ Copied" : "Copy"}
        </button>
        <a
          href={`${explorer}/address/${value}`}
          target="_blank"
          rel="noopener noreferrer"
          className="copy-hash-btn"
          style={{ textDecoration: "none", display: "inline-flex", alignItems: "center" }}
        >
          Explorer ↗
        </a>
      </div>
    </div>
  );

  const ownerCell = (key: string) => {
    const owner = network === "mainnet" ? MAINNET_CONTRACT_OWNERS[key] : undefined;
    if (owner === "none") return "No owner";
    if (owner === "safe") {
      return (
        <span>
          Safe {PROTOCOL_SAFE.threshold}-of-{PROTOCOL_SAFE.owners}
          {safe ? (
            <>
              {" "}
              <a
                href={`${explorer}/address/${safe}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: "underline" }}
              >
                {shortHash(safe)}
              </a>
            </>
          ) : null}
        </span>
      );
    }
    return "Not checked";
  };

  return (
    <div className="frame">
      <PageBackground word="CONTRACTS" variant="reading" />
      <Navbar />
      <main id="main-content">
        <section className="ph ph-haze ph-haze-docs page-reveal-hero">
          <span className="tag">
            <b className="dot" aria-hidden="true" /> Contracts
          </span>
          <h1>Contract addresses you can check yourself.</h1>
          <p>
            Every address below comes from the same address book as the docs, and links to the block
            explorer. The commands at the bottom let you verify the owner and the Safe threshold
            without trusting this page.
          </p>
        </section>

        <section className="sec" style={{ paddingTop: "24px" }}>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "20px" }}>
            <button
              type="button"
              onClick={() => setNetwork("mainnet")}
              className={`filter-btn ${network === "mainnet" ? "active" : ""}`}
            >
              {robinhoodMainnet.name} (Chain ID: {robinhoodMainnet.id})
            </button>
            <button
              type="button"
              onClick={() => setNetwork("testnet")}
              className={`filter-btn ${network === "testnet" ? "active" : ""}`}
            >
              {robinhoodTestnet.name} (Chain ID: {robinhoodTestnet.id})
            </button>
          </div>

          <h2 style={{ fontSize: "20px", margin: "0 0 12px" }}>PINELY contracts (Stage 1)</h2>
          <div className="tw" role="region" aria-label="Stage 1 contracts" tabIndex={0}>
            <table className="tbl font-mono">
              <thead>
                <tr>
                  <th scope="col">Contract</th>
                  <th scope="col">Address</th>
                  <th scope="col">Deploy transaction</th>
                  <th scope="col">Owner</th>
                </tr>
              </thead>
              <tbody>
                {STAGE_1.map((entry) => {
                  const value = address(entry.key);
                  const tx = findDeployTx(chain.id, entry.key);
                  return (
                    <tr key={entry.key}>
                      <td>
                        <strong style={{ color: "#ffffff" }}>{entry.name}</strong>
                        <div
                          style={{ color: "var(--mut-light)", fontSize: "12px", marginTop: "4px" }}
                        >
                          {entry.note}
                        </div>
                      </td>
                      <td>
                        {value ? renderAddress(entry, value) : "Not deployed on this network"}
                      </td>
                      <td>
                        {tx ? (
                          <a
                            href={`${explorer}/tx/${tx}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={tx}
                            style={{ textDecoration: "underline" }}
                          >
                            {shortHash(tx)}
                          </a>
                        ) : (
                          "Not available"
                        )}
                      </td>
                      <td>{ownerCell(entry.key)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="note" style={{ margin: "10px 0 0", maxWidth: "78ch" }}>
            Owners and the Safe threshold were read from the chain on {STATUS_AS_OF}. The contracts
            are unaudited.
          </p>

          <h2 style={{ fontSize: "20px", margin: "36px 0 12px" }}>
            Safe, token and infrastructure
          </h2>
          <div
            className="tw"
            role="region"
            aria-label="Safe, token and infrastructure"
            tabIndex={0}
          >
            <table className="tbl font-mono">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Address</th>
                  <th scope="col">What it is</th>
                </tr>
              </thead>
              <tbody>
                {EXTERNAL.map((entry) => {
                  const value = address(entry.key);
                  return (
                    <tr key={entry.key}>
                      <td>
                        <strong style={{ color: "#ffffff" }}>{entry.name}</strong>
                      </td>
                      <td>
                        {value
                          ? renderAddress(entry, value)
                          : entry.key === "PINELY"
                            ? "Mainnet only"
                            : "Not on this network"}
                      </td>
                      <td style={{ color: "var(--mut-light)", fontSize: "12px" }}>{entry.note}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h2 style={{ fontSize: "20px", margin: "36px 0 12px" }}>Stage 2 contracts</h2>
          <div className="tw" role="region" aria-label="Stage 2 contracts" tabIndex={0}>
            <table className="tbl font-mono">
              <thead>
                <tr>
                  <th scope="col">Contract</th>
                  <th scope="col">Status</th>
                  <th scope="col">Address</th>
                </tr>
              </thead>
              <tbody>
                {STAGE_2.map((entry) => {
                  const value = address(entry.key);
                  return (
                    <tr key={entry.key}>
                      <td>
                        <strong style={{ color: "#ffffff" }}>{entry.name}</strong>
                        <div
                          style={{ color: "var(--mut-light)", fontSize: "12px", marginTop: "4px" }}
                        >
                          {entry.note}
                        </div>
                      </td>
                      <td>
                        {value ? (
                          <StageBadge variant={network === "mainnet" ? "live" : "testnet"} />
                        ) : (
                          <StageBadge variant="stage2" />
                        )}
                      </td>
                      <td>{value ? renderAddress(entry, value) : "Not deployed"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <h2 style={{ fontSize: "20px", margin: "36px 0 12px" }}>Verify it yourself</h2>
          <p className="note" style={{ margin: "0 0 12px", maxWidth: "78ch" }}>
            These commands use Foundry&apos;s <code className="font-mono">cast</code>. They read the
            chain directly, so the answer does not depend on this website.
          </p>
          <pre className="verify-block font-mono" tabIndex={0}>
            {verifyLines.join("\n")}
          </pre>
        </section>
      </main>
      <Footer />
    </div>
  );
}
