# @pinely/indexer

On-chain event indexer for PINELY, built on **Ponder**. It indexes the Robinhood Chain network selected by
`CHAIN_ID` (`46630` testnet, `4663` mainnet).

## Characteristics

- **Runtime:** Node.js 22 LTS
- **Database:** PostgreSQL, schema `ponder` (separate from the backend's `app` schema). Never reuse a
  database from another deployment.
- **Schema ownership:** the schema name is set in `ponder.schema.ts` with `onchainSchema` (default
  `ponder`, or `PONDER_SCHEMA`). Ponder 0.7 ignores the connection string's `search_path`, so tables
  declared with `onchainTable` would silently land in `public`. Ponder creates the tables itself; the
  backend never creates a table in this schema.
- **Framework:** Ponder `^0.7.17`
- **Time-based polling:** blocks arrive about every 100 ms, so the indexer polls on a fixed interval
  (`POLLING_INTERVAL_MS`, default 2000 ms) with a request cap (`MAX_REQUESTS_PER_SECOND`, default 25)
  instead of reacting to every block.

## Configuration

Everything comes from the environment (see `.env.example`). There are no defaults for the network, the
RPC endpoint, the database or the start block: a missing value stops the indexer at boot.

- `CHAIN_ID`: `46630` or `4663` only.
- `RPC_URL`: a provider endpoint. The public Robinhood Chain RPC is shared by all users; backfills need an
  archive endpoint.
- `START_BLOCK`: the block of the Stage 1 deployment. Zero is rejected.
- Contract addresses are never set here: they come from `@pinely/shared` (`bun run sync`).
  `MachineRegistry`, `PinelyPaymaster` and `SurplusSweeper` (Stage 1) must be deployed. Stage 2
  contracts that are not deployed yet (router, hook, stake, burn vault, subscriptions) are skipped.

## Commands

```bash
bun run dev        # development server
bun run codegen    # regenerate Ponder types (needs a deployed Stage 1 and the environment above)
bun run start      # production
bun run typecheck  # tsc --noEmit
```
