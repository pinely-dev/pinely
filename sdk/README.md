# @pinely/sdk

TypeScript SDK for **PINELY**: machine onboarding, session keys, EIP-712 swap signing and HTTP 402
payments for physical machines on Robinhood Chain (testnet `46630`, mainnet `4663`).

## Install

```bash
bun add @pinely/sdk
```

## Quick start

```ts
import { Pinely } from "@pinely/sdk";

const pinely = await Pinely.connect({
  chain: "robinhoodTestnet",
  registryAddress: "0x...", // MachineRegistry (see shared/contracts after `bun run sync`)
  paymasterAddress: "0x...", // PinelyPaymaster
  keyStore: { type: "tpm" }, // production: hardware module; "file-dev-only" is for development
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

`tpm` and `secure-element` key stores require a hardware module in production. See the repository's
security notes before relying on them: the current implementation derives its key from a device salt and
is **not** a substitute for a sealed TPM key.

## Tests

```bash
bun test --cwd sdk
```
