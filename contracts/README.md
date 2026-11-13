# Contracts (Foundry)

The contracts are written in `src/`, tested with `forge test` and deployed with `forge script`. Foundry is
the only toolchain.

## Layout

```text
contracts/
├── src/        # Solidity sources
├── test/       # unit, fuzz and invariant tests (*.t.sol)
├── script/     # deployment scripts (DeployBase + Stage 1 / Stage 2 / Testnet / PoolManager)
├── lib/        # Foundry dependencies (git submodules)
├── foundry.toml
└── out/        # build artifacts; ABI source for the sync (not committed)
```

## Stages

- **Stage 1** (testnet and mainnet): `MachineRegistry`, `PinelyAccountFactory` / `PinelyAccount`,
  `PinelyPaymaster`, `SurplusSweeper`.
- **Stage 2** (testnet rehearsal until the token launches): `PinelyHook`, `PinelyRouter`, `BurnVault`,
  `PinelyStake`, `FleetSubscription`, `CreatorFeeSplitter`, `PoolSeeder`.

Time-based logic (daily caps, cooldowns, deadlines) always uses `block.timestamp`, never `block.number`:
Robinhood Chain produces blocks about every 100 ms, and consecutive blocks can share one timestamp second.

## Dependencies

Installed as submodules in `lib/`:

| Package | Source | Note |
|---|---|---|
| `forge-std` | `foundry-rs/forge-std` | Tests and scripts |
| `v4-core` | `Uniswap/v4-core` | Pinned to commit `bea7f6d1`, not tag `v4.0.0` |
| `v4-periphery` | `Uniswap/v4-periphery` | `ImmutableState`, routers |
| `v4-hooks-public` | `Uniswap/v4-hooks-public` | Source of `BaseHook` and `HookMiner` |

```bash
git submodule update --init --recursive
```

## Commands

From `contracts/`:

```bash
forge build
forge test
forge fmt --check
```

From the repository root: `bun run contracts:build`, `contracts:test`, `contracts:fmt:check`.

## Deployment

All deploy scripts share the guards in `script/DeployBase.s.sol`. They refuse any chain other than
`46630` / `4663`, the default Foundry and Anvil deployers, and (on mainnet) mock tokens, a non-canonical
EntryPoint and any treasury that is not a Safe with threshold 2 and exactly 3 owners. Stage 1 also requires
`NATIVE_PRICE_MIN` and `NATIVE_PRICE_MAX` (see `.env.example`) and sets them on the Paymaster before ownership moves.

| Script | Purpose |
|---|---|
| `DeployPoolManager` | Self-deploy the Uniswap v4 PoolManager (only if no canonical one is published) |
| `DeployTestnet` | 11-contract rehearsal (Stage 1 + Stage 2) on testnet |
| `DeployStage1` | Stage 1 on testnet or mainnet; hands Registry and Paymaster to the Safe |
| `DeployStage2` | Stage 2; mainnet additionally needs `ALLOW_STAGE2_MAINNET=true` |

Private keys never go into files, shell history or chat. Use a keystore:

```bash
cast wallet import deployer-robinhood-testnet --interactive
bun run contracts:deploy:testnet
```

The Paymaster has no default native-token rate: after deployment the owner must call `setNativePrice`,
fund the EntryPoint deposit and `addStake` before any UserOperation is sponsored.

After a deployment Foundry writes `broadcast/<Script>.s.sol/<chainId>/run-latest.json`. It must be
committed: `scripts/sync-contracts.mjs` reads it to copy addresses to `shared/`.

```bash
bun run sync
```

The sync only records chains `46630` and `4663`.
