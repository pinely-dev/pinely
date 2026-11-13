# Backend: PINELY Facilitator & API

Hono + Bun + Drizzle ORM + PostgreSQL. The runtime is **Bun**, with code kept Node-compatible. Ponder runs
as a separate Node.js 22 process.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /health` | Liveness, does not touch the database |
| `GET /ready` | Readiness: database connection and schemas |
| `GET /v1/charge/:id` | x402 payment requirements (HTTP 402) |
| `POST /v1/verify`, `POST /v1/settle/prepare`, `POST /v1/settle` | Verify, prepare and settle a machine's signed payment intent |
| `GET /v1/capability` | Settlement rail (informational EIP-3009 probe) |
| `/api/*` | Auth (SIWE), machines, fleets, actions, burns, billing, pilot |

## Settlement

The only settlement rail is an ERC-4337 UserOperation sponsored by the
PinelyPaymaster. The facilitator never signs for a machine and keeps no state between the two calls:

1. `POST /v1/settle/prepare` verifies the machine (signature, registered session key, not frozen, nonce
   unused) and returns the **unsigned** UserOperation, its `userOpHash` and the fee.
2. The machine checks the operation itself (recipient, amount, token, paymaster, gas, fee cap), signs the
   hash with its session key and sends it back.
3. `POST /v1/settle` rebuilds the operation with the current EntryPoint nonce and requires it to be
   **identical** to the one the machine signed (`409 USEROP_MISMATCH` otherwise), verifies the signature
   (`403 USEROP_SIGNATURE_INVALID`), submits it and answers only after the bundler confirms execution.

The access token is issued only after on-chain confirmation. Local development can set
`FACILITATOR_SIMULATION=true`, which is ignored in production and marks every result `simulated`.

## Fail-closed behaviour

- `CHAIN_ID` must be `46630` or `4663` (mandatory in production).
- Contract addresses come only from `@pinely/shared`. A contract that is not deployed answers
  `503 CONTRACT_NOT_DEPLOYED`; there are no dummy addresses.
- `SESSION_SECRET` is mandatory unless `NODE_ENV` is `development` or `test`.
- CORS and SIWE accept only the origins and domains you configure (`FRONTEND_URL`,
  `ALLOWED_AUTH_DOMAINS`); hosting-platform wildcards are never accepted.

## Run locally

```bash
docker compose up -d postgres        # PostgreSQL 16 on host port 5433
cp backend/.env.example backend/.env
bun run dev:backend
curl http://localhost:3000/health
```

## Database

| Schema | Owner | Backend access |
|---|---|---|
| `app` | Backend (Drizzle) | Read/write |
| `ponder` | Ponder | Read-only |

```bash
bun run --cwd backend db:generate
bun run --cwd backend db:migrate
bun run --cwd backend db:seed        # sample data; refuses to run in production
```

## Queue

`pg-boss` runs PostgreSQL-backed jobs without Redis. The surplus sweep is scheduled on a wall-clock cron
(every 15 minutes), never per block.

The backend does **not** hold machine or operator private keys and does not custody user funds.
