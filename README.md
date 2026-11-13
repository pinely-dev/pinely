<div align="center">
  <img src="frontend/public/icons/icon-512.png" alt="PINELY Logo" width="120" />
  <h1>PINELY ($PINELY)</h1>
  <p><strong>DePIN Infrastructure for Physical AI on Robinhood Chain</strong></p>
  <p>Autonomous machine identity, capped ERC-4337 session keys, and sponsored gas execution for robots, drones, and smart hardware.</p>

  <p>
    <a href="#8-automated-verification--testing"><img src="https://img.shields.io/badge/Typecheck-Passing-22c55e.svg?style=flat-square" alt="Typecheck"></a>
    <a href="#8-automated-verification--testing"><img src="https://img.shields.io/badge/Foundry-223%20Passed-blue.svg?style=flat-square" alt="Foundry"></a>
    <a href="#8-automated-verification--testing"><img src="https://img.shields.io/badge/Backend%20Tests-154%20Passed-purple.svg?style=flat-square" alt="Backend Tests"></a>
    <a href="#8-automated-verification--testing"><img src="https://img.shields.io/badge/Client%20SDKs-90%20Passed-06b6d4.svg?style=flat-square" alt="Client SDKs"></a>
    <a href="https://explorer.testnet.chain.robinhood.com"><img src="https://img.shields.io/badge/Robinhood%20Chain-Testnet%2046630-FF5A1F.svg?style=flat-square" alt="Robinhood Chain Testnet"></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" alt="License"></a>
  </p>

  <p>
    <a href="https://www.pinelyprotocol.tech"><strong>Web Application</strong></a> •
    <a href="https://x.com/pinely_protocol"><strong>Official X (@pinely_protocol)</strong></a> •
    <a href="https://explorer.testnet.chain.robinhood.com"><strong>Block Explorer</strong></a> •
    <a href="#4-live-contract-registry"><strong>Contract Registry</strong></a>
  </p>
</div>

---

> [!IMPORTANT]
> **Current Onchain Status (Stage 1 Deployed on Testnet):**  
> Core identity, account abstraction, paymaster gas sponsorship, and surplus sweeper contracts are deployed and verified live on **Robinhood Chain Testnet (Chain ID `46630`, blocks `152785748` – `152785843`)**: `MachineRegistry`, `PinelyAccountFactory`, `PinelyPaymaster`, `SurplusSweeper`, and `MockUSDG`.  
> Stage 2 contracts (the private Uniswap v4 pool, `PinelyHook`, `PinelyRouter`, `BurnVault`, `PinelyStake`, and `FleetSubscription`) are fully implemented and verified across 223 automated Foundry tests (including Robinhood live RPC fork tests), scheduled for mainnet deployment upon official token launch.  
> The Next.js 15 App Router web application is live at `https://www.pinelyprotocol.tech`, with full TypeScript, Python, and ROS2 client SDKs active in the monorepo.

---

## Table of Contents

- [1. Overview & Core Concept](#1-overview--core-concept)
- [2. System Architecture & Data Flow](#2-system-architecture--data-flow)
- [3. Feature Matrix & Production Status](#3-feature-matrix--production-status)
- [4. Live Contract Registry](#4-live-contract-registry)
  - [Robinhood Chain Testnet — Chain ID 46630 (Live)](#robinhood-chain-testnet--chain-id-46630-live)
  - [Robinhood Chain Mainnet — Chain ID 4663 (Roadmap)](#robinhood-chain-mainnet--chain-id-4663-roadmap)
- [5. Hardware Integration & Client SDKs](#5-hardware-integration--client-sdks)
  - [TypeScript / CLI (@pinely/sdk)](#typescript--cli-pinelysdk)
  - [Python SDK (pinely_sdk)](#python-sdk-pinely_sdk)
  - [ROS2 Robotics Node (pinely_ros2)](#ros2-robotics-node-pinely_ros2)
- [6. Monorepo Structure](#6-monorepo-structure)
- [7. Local Development & Setup](#7-local-development--setup)
- [8. Automated Verification & Testing](#8-automated-verification--testing)
- [9. Security Model & Risk Controls](#9-security-model--risk-controls)
- [10. Official Links & License](#10-official-links--license)

---

## 1. Overview & Core Concept

**PINELY** provides the foundational machine-to-machine financial infrastructure for physical autonomous hardware (delivery robots, autonomous drone fleets, smart EV charging docks, and IoT edge devices) operating on **Robinhood Chain**.

### The Problem

- **Exposed Root Private Keys:** Autonomous machines deployed in public environments cannot hold root operator private keys. Physical memory dumps or firmware extractions must never compromise treasury capital.
- **Uncapped Wallet Drain:** Standard Web3 wallets grant unbounded approval once signed. A rogue firmware loop or sensor malfunction can drain all assets in a single transaction.
- **Gas Token Volatility & Friction:** Micro-controllers and robot control systems should not manage volatile ETH gas balances, base fee surges, or native gas replenishment. Running out of gas freezes physical hardware in the field.
- **Public DEX MEV & Frontrunning:** Public AMM pools expose automated machine payments to predatory frontrunning, sandwich attacks, and third-party liquidity draining.

### The PINELY Solution

1. **Hardware Root of Trust (TPM 2.0 / Secure Element):** The physical device generates a non-exportable session key inside hardware. The private key never leaves the chip and is bound to manufacturer hardware attestation hashes in `MachineRegistry` (ERC-8004 and peaq DID compatible).
2. **Account Abstraction & Capped Session Keys (ERC-4337):** Every device receives an ERC-4337 counterfactual Machine Account owned by the fleet operator. The hardware key acts strictly as a scoped session key with strict validity windows and execution boundaries.
3. **Spend Policy & 1-Tx Emergency Kill Switch:** Onchain limits (`maxStableOutPerSwap` and `dailyStableOutCap`) enforce maximum spending in USDG (6 decimals). Fleet operators or designated guardians can freeze an individual unit or an entire fleet in one atomic onchain transaction.
4. **Sponsored Gas via PinelyPaymaster:** The paymaster fronts native ETH gas on Robinhood Chain, settling charges against prepaid USDG quota. Price circuit breakers and oracle staleness checks ensure bounded conversion rates. Devices never need to hold ETH.
5. **Private Uniswap v4 Machine Pool (Stage 2):** Hardware swaps route strictly through `PinelyRouter` into a private Uniswap v4 pool guarded by `PinelyHook`. The hook verifies EIP-712 cryptographic signatures, nonce anti-replay, Spend Policy limits, and dynamic fee tiers before allowing any swap.
6. **Autonomous Machine Payments over HTTP 402:** A charging dock, compute API, or sensory provider returns an HTTP 402 challenge. The machine signs an EIP-712 payment intent, the Facilitator prepares a gas-sponsored UserOperation, and access unlocks immediately upon onchain confirmation.

---

## 2. System Architecture & Data Flow

```text
[ Physical Robot / Drone / EV Dock ]
  │
  ├─ 1. Hardware Secure Element signs EIP-712 intent (Payment402Intent / SwapIntent)
  │
  ▼
[ PINELY Client SDK (@pinely/sdk / Python / ROS2) ]
  │
  ├─ 2. Constructs unsigned ERC-4337 UserOperation or encodes hookData
  │
  ▼
[ HTTP 402 Facilitator (Backend API Gateway) ]
  │
  ├─ 3. Verifies device signature against MachineRegistry session key
  ├─ 4. Submits UserOperation to EntryPoint v0.7
  │
  ▼
[ PinelyPaymaster ]
  │
  ├─ 5. Validates paymasterAndData, bounds gas price, checks staleness
  ├─ 6. Fronts native ETH gas to EntryPoint; debits machine's USDG quota
  │
  ▼
[ PinelyAccount (ERC-4337 Smart Account) ]
  │
  ├─ 7. Executes payment to merchant dock (USDG settlement)
  │
  ▼
[ SurplusSweeper ]
  │
  ├─ 8. Sweeps operational revenues above reserve threshold to operator cold vault
  │
  ▼
[ PinelyHook (Uniswap v4 BaseHook — Stage 2) ]
  ├─ Gate 1: Machine Gate (Verifies EIP-712 digest under domain 'PINELY')
  ├─ Gate 2: Spend Policy (Enforces dailyStableOutCap & maxStableOutPerSwap)
  ├─ Gate 3: Kill Switch (Checks machine and fleet freeze flags)
  └─ Gate 4: Dynamic Tier (Bronze 0.30%, Silver 0.15%, Gold 0.05% + Protocol 0.05%)
```

---

## 3. Feature Matrix & Production Status

| Feature | Scope & Mechanism | Environment | Status |
| :--- | :--- | :--- | :---: |
| **Machine Identity** | Hardware attestation, peaq DID, session key registry | Testnet (46630) | ✅ **Live Onchain** |
| **Machine Account** | Deterministic ERC-4337 factory (`PINELY_ACCOUNT_V1` salt) | Testnet (46630) | ✅ **Live Onchain** |
| **Gasless Paymaster** | Native ETH gas sponsored, billed in USDG quota | Testnet (46630) | ✅ **Live Onchain** |
| **Surplus Sweeper** | Permissionless sweep of machine revenue above reserve | Testnet (46630) | ✅ **Live Onchain** |
| **Testnet Settlement** | MockUSDG (6 decimals, `mUSDG`) faucet & settlement | Testnet (46630) | ✅ **Live Onchain** |
| **1-Tx Kill Switch** | Emergency freeze for single device or fleet-wide | Testnet (46630) | ✅ **Live Onchain** |
| **Realtime Indexer** | Ponder event streaming from block `152785748` | Testnet (46630) | ✅ **Configured** |
| **Fleet Pro Cockpit** | Operator SIWE authentication, policy controls, telemetry | Web Portal | ✅ **Active** |
| **Machine Passport** | Public verifiable machine identity and transaction history | Web Portal | ✅ **Active** |
| **Client SDKs** | TypeScript (@pinely/sdk), Python (pinely_sdk), ROS2 node | Monorepo | ✅ **Active** |
| **Private v4 Hook** | Machine Gate, Spend Policy, kill switch, dynamic fees | Stage 2 | 🧪 **Foundry Tested** |
| **PinelyRouter** | Stateless caller verification and hookData forwarder | Stage 2 | 🧪 **Foundry Tested** |
| **BurnVault** | Protocol fee buyback and burn emitting `Burned(uint256)` | Stage 2 | 🧪 **Foundry Tested** |
| **PinelyStake** | Reputational staking vault for Gold Tier with 7-day cooldown | Stage 2 | 🧪 **Foundry Tested** |
| **Safe Multisig** | 2-of-3 threshold multisig governance for Mainnet | Mainnet (4663) | 🛑 **Mainnet Gate** |

---

## 4. Live Contract Registry

Contract configurations and ABIs are synchronized automatically from Foundry broadcast artifacts into `@pinely/shared`.

### Robinhood Chain Testnet — Chain ID 46630 (Live)

- **Network:** Robinhood Chain Testnet (Arbitrum Orbit L2/L3)
- **Chain ID:** `46630`
- **Native Gas Token:** ETH (18 decimals)
- **Settlement Token:** MockUSDG (6 decimals)
- **Deployment Block Range:** `152785748` – `152785843`
- **Block Explorer:** [https://explorer.testnet.chain.robinhood.com](https://explorer.testnet.chain.robinhood.com)

| Contract | Address | Transaction Hash | Block | Explorer Link |
| :--- | :--- | :--- | :---: | :--- |
| **MockUSDG** | `0x7DdBb739c5C81ceE5872571579225764d925025b` | `0x3e06e5b4fa429a1afebf89c045ee4fb6bd6589723c63771a3d8ec0aa6e36eed3` | 152785748 | [View on Explorer](https://explorer.testnet.chain.robinhood.com/address/0x7DdBb739c5C81ceE5872571579225764d925025b) |
| **MachineRegistry** | `0x68bD4d429E2A91B72b14c0476a413Bf4ACed05ef` | `0xe6029f67f5a000f001f2b8e3242ffa7927dc73bd8762e8d7ec37d5749d7948f4` | 152785765 | [View on Explorer](https://explorer.testnet.chain.robinhood.com/address/0x68bD4d429E2A91B72b14c0476a413Bf4ACed05ef) |
| **PinelyAccountFactory** | `0x24De98E8357C0bCB53a6c6A2C821eCc59927adBa` | `0x99997118a088c78e234c3c372f996c9c9f1a2d600c4897df3a99b7719664ecdf` | 152785781 | [View on Explorer](https://explorer.testnet.chain.robinhood.com/address/0x24De98E8357C0bCB53a6c6A2C821eCc59927adBa) |
| **PinelyPaymaster** | `0x25c1aD7B7F5749d2b517445608b4146F4fa953A5` | `0x9791cc7adc19c53a89e06a482071e99862ddfe513a87db346a0160eb230dfadc` | 152785795 | [View on Explorer](https://explorer.testnet.chain.robinhood.com/address/0x25c1aD7B7F5749d2b517445608b4146F4fa953A5) |
| **SurplusSweeper** | `0x8F74e783CEa6748A23523D7bcB0fE2A946Fe6B3c` | `0x9de0cff535546dd230284b6721965bc1af16f97a136d0d3fd643fd0dc5e11235` | 152785809 | [View on Explorer](https://explorer.testnet.chain.robinhood.com/address/0x8F74e783CEa6748A23523D7bcB0fE2A946Fe6B3c) |
| **ERC-4337 EntryPoint v0.7** | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | Canonical singleton | Canonical | [View on Explorer](https://explorer.testnet.chain.robinhood.com/address/0x0000000071727De22E5E9d8BAf0edAc6f37da032) |
| **Multicall3** | `0xcA11bde05977b3631167028862bE2a173976CA11` | Canonical deployment | Canonical | [View on Explorer](https://explorer.testnet.chain.robinhood.com/address/0xcA11bde05977b3631167028862bE2a173976CA11) |

---

### Robinhood Chain Mainnet — Chain ID 4663 (Roadmap)

- **Network:** Robinhood Chain Mainnet
- **Chain ID:** `4663`
- **Gas Token:** ETH (18 decimals)
- **Settlement Token:** Paxos USDG (`0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`)
- **Block Explorer:** [https://robinhoodchain.blockscout.com](https://robinhoodchain.blockscout.com)
- **Governance Requirement:** Safe Multisig 2-of-3 (`TREASURY_ADDRESS`). The deployer EOA is strictly rejected from retaining ownership on mainnet.

---

## 5. Hardware Integration & Client SDKs

PINELY offers first-class client libraries for embedded Linux, Python robotics runtimes, and ROS2:

### TypeScript / CLI (@pinely/sdk)

```bash
bun add @pinely/sdk
```

```typescript
import { Pinely } from "@pinely/sdk";

// 1. Connect to Robinhood Chain
const pinely = await Pinely.connect({
  chain: "robinhoodTestnet", // Chain ID 46630
  registryAddress: "0x68bD4d429E2A91B72b14c0476a413Bf4ACed05ef",
  paymasterAddress: "0x25c1aD7B7F5749d2b517445608b4146F4fa953A5",
  keyStore: { type: "file-dev-only", privateKey: "0x..." },
});

// 2. Provision physical device
const machine = await pinely.machines.create({
  name: "delivery-rover-01",
  operator: "0xYourOperatorAddress",
});

// 3. Autonomous settlement over HTTP 402
const result = await machine.pay({
  url: "https://facilitator.pinelyprotocol.tech/v1/charge/dock-042",
  maxAmount: 100_000n, // 0.10 USDG (6 decimals)
  facilitatorUrl: "https://facilitator.pinelyprotocol.tech",
});
console.log("Settlement status:", result.status, "TxHash:", result.txHash);
```

### Python SDK (pinely_sdk)

```bash
pip install -e sdk-python
```

```python
from pinely_sdk import Pinely

pinely = Pinely.connect(
    private_key="0x...",
    chain_id=46630,
    registry_address="0x68bD4d429E2A91B72b14c0476a413Bf4ACed05ef",
    stablecoin_address="0x7DdBb739c5C81ceE5872571579225764d925025b",
    paymaster_address="0x25c1aD7B7F5749d2b517445608b4146F4fa953A5",
)

machine = pinely.machines.create(name="drone-scout-09", operator="0x...")
result = machine.pay(
    "https://facilitator.pinelyprotocol.tech/v1/charge/pad-007",
    max_amount=250_000, # 0.25 USDG
    facilitator_url="https://facilitator.pinelyprotocol.tech"
)
print("Confirmed onchain:", result["status"], result.get("txHash"))
```

### ROS2 Robotics Node (pinely_ros2)

```bash
ros2 run pinely_ros2 pinely_node --ros-args \
  -p operator:="0xYourOperatorAddress" \
  -p registry_address:="0x68bD4d429E2A91B72b14c0476a413Bf4ACed05ef" \
  -p stablecoin_address:="0x7DdBb739c5C81ceE5872571579225764d925025b" \
  -p paymaster_address:="0x25c1aD7B7F5749d2b517445608b4146F4fa953A5" \
  -p key_file_path:="/etc/pinely/session.key"
```

---

## 6. Monorepo Structure

```text
.
├── contracts/          # Pure Foundry toolchain (Solidity 0.8.34, v4-core, BaseHook)
│   ├── src/            # MachineRegistry, PinelyPaymaster, PinelyAccountFactory, SurplusSweeper
│   │   ├── mocks/      # MockUSDG (testnet settlement stablecoin)
│   │   └── interfaces/ # ERC-4337 v0.7, Uniswap v4, Registry, and Sweeper interfaces
│   ├── test/           # 223 unit, fuzz, invariant, and Robinhood RPC fork tests
│   └── script/         # Testnet & mainnet deployment runbooks (DeployStage1.s.sol)
├── frontend/           # Next.js 15 App Router (React 19, TypeScript, Tailwind CSS v4)
│   └── src/
│       ├── app/        # Pages: /, /fleet, /passport, /machines, /map, /stake, /burn, /pilot, /docs
│       ├── components/ # Dark Brutalist components, TacticalCommandCockpit, NodeSimulator
│       ├── providers/  # WalletContext, Web3Provider (Wagmi + RainbowKit), ThemeContext
│       └── lib/        # API clients, custom wallets, viem clients, wallet error decoders
├── backend/            # Hono REST API on Bun, EIP-4361 SIWE authentication
│   ├── src/routes/     # /api/machines, /api/fleets, /api/actions, /v1/charge, /v1/settle
│   ├── src/services/   # HTTP 402 Facilitator, Keeper surplus monitor, ERC-4337 settlement rail
│   └── src/db/         # PostgreSQL schema (app & ponder namespaces)
├── indexer/            # Ponder real-time event indexing for Robinhood Chain
├── sdk/                # @pinely/sdk TypeScript hardware client library & CLI
├── sdk-python/         # pinely_sdk Python client library
├── ros2/               # pinely_ros2 ROS2 robotics package
├── shared/             # Single Source of Truth (SSOT) chains, contract addresses, and ABIs
└── scripts/            # sync-contracts.mjs, deploy-preflight.mjs, check-no-legacy-chain.mjs
```

---

## 7. Local Development & Setup

### Prerequisites

- [Bun](https://bun.sh/) (version 1.3.14 or higher)
- [Node.js](https://nodejs.org/) (version 22.x)
- [Foundry](https://book.getfoundry.sh/) (`forge`, `cast`)
- [Docker](https://www.docker.com/) (for PostgreSQL database)
- [Python 3](https://www.python.org/) (for Python SDK & ROS2 tests)

### 1. Installation

```bash
git clone https://github.com/pinely-protocol/pinely.git
cd pinely
bun install
```

### 2. Environment Configuration

```bash
cp frontend/.env.example frontend/.env.local
cp backend/.env.example backend/.env
cp indexer/.env.example indexer/.env
cp contracts/.env.example contracts/.env
```

Key environment configurations:
- `NEXT_PUBLIC_CHAIN_ID=46630`: Target Robinhood Chain Testnet.
- `DATABASE_URL`: PostgreSQL connection string (defaults to `postgres://pinely:pinely_local_dev@localhost:5433/pinely`).
- `START_BLOCK=152785748`: Deployment start block on Robinhood Testnet.

### 3. Running Services

```bash
# 1. Start local PostgreSQL container
bun run db:up

# 2. Seed development database
bun run db:seed

# 3. Run frontend web application (http://localhost:3000)
bun run dev:frontend

# 4. Run backend REST API gateway (http://localhost:3001)
bun run dev:backend

# 5. Run Ponder real-time event indexer (http://localhost:42069)
bun run dev:indexer
```

---

## 8. Automated Verification & Testing

Every commit and pull request must strictly pass all quality gates:

### Smart Contract Test Suite (Foundry)

```bash
# Run all 223 unit, fuzz, invariant, and live RPC fork tests
bun run contracts:test

# Verify Solidity formatting
bun run contracts:fmt:check

# Compile contracts
bun run contracts:build
```

### Backend Integration Tests

```bash
# Run 154 API, SIWE authentication, and HTTP 402 Facilitator integration tests
bun run test:backend
```

### Client SDK Test Suites

```bash
# Run 54 TypeScript SDK unit & cryptographic verification tests
bun run test:sdk

# Run 36 Python SDK and ROS2 node integration tests
bun run test:python
```

### Monorepo Quality Gates

```bash
# 1. Strict TypeScript check across all packages (frontend, backend, indexer, sdk)
bun run typecheck

# 2. ESLint check (zero errors, zero warnings)
bun run lint

# 3. Prettier style verification
bun run format:check

# 4. Next.js 15 production build verification (21 static & dynamic routes)
bun run build

# 5. Verify no legacy chain labels or addresses remain
bun run check:legacy
```

---

## 9. Security Model & Risk Controls

1. **Non-Exportable Hardware Keys:** Physical device keys are sealed inside hardware TPM / Secure Element chips. The private key cannot be extracted via physical memory inspection or disk imaging.
2. **Session Key Isolation:** Hardware keys act strictly as ephemeral session keys. They hold zero asset custody and cannot alter contract ownership, Spend Policies, or treasury destinations.
3. **Spend Policy Circuit Breakers:** Strict onchain daily caps (`dailyStableOutCap`) and per-transaction caps (`maxStableOutPerSwap`) bound monetary loss even if firmware is hijacked.
4. **Instant Emergency Kill Switch:** Operators or appointed guardian accounts can execute `freezeMachine` or `freezeFleet` in a single transaction, immediately halting all payment and swap activity.
5. **Bounded Paymaster Rates & Staleness Guards:** `PinelyPaymaster` enforces minimum and maximum price bounds ($1,500 – $6,000 USD/ETH) and staleness timeouts to prevent frontrunning or arbitrage on volatile gas spikes.
6. **Safe Multisig 2-of-3 Governance (Mainnet):** Production deployments strictly require protocol and treasury ownership to reside in a Gnosis Safe 2-of-3 multisig. The deployer EOA is barred by contract guards from retaining ownership.

---

## 10. Official Links & License

- **Web Application:** [https://www.pinelyprotocol.tech](https://www.pinelyprotocol.tech)
- **Official X / Twitter:** [@pinely_protocol](https://x.com/pinely_protocol)
- **Block Explorer:** [Robinhood Chain Testnet Explorer](https://explorer.testnet.chain.robinhood.com)
- **License:** Distributed under the [MIT License](LICENSE).
