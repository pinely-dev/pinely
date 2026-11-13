# @pinely-protocol/sdk

TypeScript SDK for **PINELY**: machine onboarding, session keys, EIP-712 swap signing and HTTP 402
payments for physical machines on Robinhood Chain (testnet `46630`, mainnet `4663`).

## Install

```bash
bun add @pinely-protocol/sdk@beta
# or: npm install @pinely-protocol/sdk@beta
```

This is a beta release (`0.1.0-beta.1`); use the `@beta` tag to keep receiving pre-releases. It is an ESM-only package for
Node.js 20 or newer and ships its own TypeScript types. Run the CLI without installing:

```bash
npx @pinely-protocol/sdk@beta --help
npx @pinely-protocol/sdk@beta machine create --name charger-01 --operator 0x...
```

## Quick start

```ts
import { Pinely } from "@pinely-protocol/sdk";

const pinely = await Pinely.connect({
  chain: "robinhoodTestnet",
  registryAddress: "0x...", // MachineRegistry (see shared/contracts after `bun run sync`)
  paymasterAddress: "0x...", // PinelyPaymaster
  keyStore: { type: "tpm" }, // production: needs a hardware module (throws without one); "file-dev-only" is for development
  rpcUrl: process.env.RPC_URL_ROBINHOOD_TESTNET,
});

const machine = await pinely.machines.create({ name: "charger-01", operator: "0x..." });

// HTTP 402 payment through the Facilitator (never simulated: a facilitatorUrl is required).
// The SDK reads the 402 challenge, asks the Facilitator to prepare the sponsored UserOperation, verifies it
// itself, signs its hash with the session key and submits it. paymasterAddress is required for this.
const result = await machine.pay({
  url: "https://facilitator.example/v1/charge/dock-001",
  maxAmount: 100_000n, // 0.10 stablecoin (6 decimals)
  facilitatorUrl: "https://facilitator.example",
});
```

## Behaviour you can rely on

- **Fail-closed.** Missing addresses, an unsupported chain, an unreachable RPC or a Facilitator that does
  not confirm settlement never degrade to a "success" result. `machine.isFrozen()` throws when the
  kill-switch state cannot be read instead of returning `false`.
- **No dummy addresses.** `stablecoin` is resolved from the SSOT (`@pinely/shared`); `PinelyHook` and
  `PinelyRouter` only exist from Stage 2, so swaps throw until they are deployed.
- **Never signs blindly.** A prepared UserOperation that pays another recipient or token, a larger amount,
  uses another paymaster or EntryPoint, inflates gas, deploys code, hides a fee or charges more than
  `maxFeeBps` (default 1%) is refused before anything is signed.
- **Replay isolation.** EIP-712 domains are `PINELY` (hook) and `PINELYFacilitator`, both bound to the
  chain id. Signatures from any earlier deployment do not verify.

## Command line

```bash
pinely machine create --name "Drone-Alpha" --operator 0x...
pinely machine status --id 0x...
pinely swap --token-in 0x... --amount-in 1000000 --min-out 990000
pinely pay --url https://facilitator.example/v1/charge/dock-001 --max-amount 250000 --facilitator https://facilitator.example
pinely sweep --sweeper 0x... --id 0x...
```

`--chain` accepts `robinhoodTestnet` (default) or `robinhoodMainnet`.

## Key storage

`tpm` and `secure-element` key stores **fail closed**: without a reachable hardware device and a device-unique
salt they throw `HardwareSecurityModuleRequiredError`. A simulated enclave exists for tests only and must be
requested explicitly with `simulatedEnclave: true`; it is rejected when `NODE_ENV=production`. Without a
`deviceUniqueSalt` the simulated key is derived from a public default salt, so anyone can recompute it. Never
use a simulated key for anything of value.

See the repository's security notes before relying on the hardware path: the current implementation derives its
key from a device salt and is **not** a substitute for a sealed TPM key.

## Exit codes

The CLI exits `0` on success and `1` on any failure, including a `pay` that does not settle. Errors print one
line; set `PINELY_DEBUG=1` for the full stack trace.

## Tests

```bash
bun test --cwd sdk
```
