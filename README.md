# Jisr API

Internal Testnet transfer tracking with durable SQLite storage and read-only reconciliation orchestration. This foundation runs independently of the web workspace and has no npm runtime dependencies.

## Run

Use Node 24.15 or newer within Node 24. Node's built-in SQLite API is release-candidate stability in this version range. This is a single-service development foundation, not a horizontally scaled production database architecture.

```powershell
npm ci
Copy-Item .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
# Put the generated value into SERVICE_TOKEN in .env. Keep it server-side.
npm start
```

The server defaults to `127.0.0.1:3001`. SQLite migrations apply transactionally on startup; data persists in `data/transfers.sqlite`. Configure `DATABASE_PATH` to change that location. Opening a newer schema with an older application fails rather than downgrading it. Preserve the database and its WAL consistently when backing up; use SQLite-aware backup tooling or stop the service first.

## API

All routes except health require `Authorization: Bearer <SERVICE_TOKEN>`. This credential grants service-wide access. It is not a wallet login and must never be shipped in browser code. There are no public wallet history routes or ownership claims. A wallet-authenticated gateway must be implemented before browser integration; use TLS if accessing this service across a network.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/healthz` | Checks database availability; does not claim live network readiness. |
| POST | `/v1/transfers` | Registers an immutable pending transfer; 201 for new, 200 for identical retry, 409 for conflicting identity. |
| GET | `/v1/transfers/:hash` | Reads one registered transfer. |
| POST | `/v1/transfers/:hash/reconcile` | Runs the configured trusted network adapter; 503 until that adapter exists. |

Registration requires exactly `hash`, `network`, `asset`, `sender`, `recipient`, `amount`, `contractId`, and `submittedAt`. Network must be `TESTNET`, asset `XLM`, amount a positive decimal string with at most seven fractional digits, and submittedAt a UTC timestamp like `2026-01-01T00:00:00.000Z`. Status, secrets and signed transaction payloads are rejected. Responses wrap the transfer in `{ "record": ... }`; errors use `{ "error": { "code": "...", "message": "..." } }`.

The registration amount limit is a transport bound, not a claim about the deployed contract's accepted range. Address validation currently checks shape only; SDK checksum validation is pending. All submitted payment details remain claims until checked against network evidence.

## SDK handoff

See [the backend SDK review](SDK_REVIEW.md) for the extracted interfaces, passing SDK checks, installed-package failure and remaining integration requirements. The SDK is not yet a runtime dependency.

`createApi({ store, token, lookup })` injects a server-side lookup adapter. `lookup(record, { signal })` returns `null` for an unknown transaction, or `{ settlement, paymentVerified }`. Settlement fields match the current web `TransferSettlement` shape: `hash`, `successful`, `feeCharged`, `ledger`, `createdAt`.

Only an adapter verifying the Testnet network, contract invocation, token, sender, recipient and amount against operation/event evidence may return `paymentVerified: true`. A transaction success flag alone is insufficient. Failed network transactions can be marked failed; missing results, exceptions, timeouts, invalid evidence and unverified successful payments do not change stored status. Concurrent requests share one lookup per process. Optimistic database revisions prevent delayed results from overwriting newer evidence; confirmed records cannot be downgraded.

The default executable intentionally has no live adapter. Fixture adapters are used only in tests. After EthTobi's SDK extraction, replace the boundary with SDK imports and runtime validation, then implement the live adapter and wallet ownership verification. No signing, rebroadcasting, background polling scheduler, fiat payout or bank provider integration is implemented.

This independent foundation uses Node HTTP and SQLite so it can run and be tested while the original Express/Postgres workspace remains under extraction. The existing API scaffold and database are not migrated or modified. Postgres migration and framework alignment should be agreed before production integration.

## Verification

```powershell
npm test
npm run build
```

Tests cover restart persistence, migration reruns, idempotency, immutable identities, untrusted fields, settlement evidence, stale writes across database connections, timeout/deduplication behavior, and real HTTP authentication/routes. Build performs syntax checks; there is no transpilation step. CI runs both on Windows and Linux. Tests use Node's in-process runner because this development sandbox restricts spawning test subprocesses.

See [OpenAPI](openapi.json) for the transport contract.
