<p align="center"><img src="https://raw.githubusercontent.com/jisr-pay/.github/main/assets/icon.svg" alt="Jisr" width="72"></p>

# Jisr API

Internal Testnet transfer tracking with durable SQLite storage and read-only reconciliation orchestration. This foundation runs independently of the web workspace and uses the Stellar SDK for address checksums and wallet signature verification.

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

Service routes (`/v1/transfers*`) require `Authorization: Bearer <SERVICE_TOKEN>`. This credential grants service-wide access. It is not a wallet login and must never be shipped in browser code. Opt-in `/v1/wallet/*` routes use separate expiring key-possession sessions; see [wallet sessions](docs/OWNERSHIP.md). Use TLS when accessing the service across a network.

| Method | Route | Behavior |
| --- | --- | --- |
| GET | `/healthz` | Checks database availability; does not claim live network readiness. |
| POST | `/v1/transfers` | Registers an immutable pending transfer; 201 for new, 200 for identical retry, 409 for conflicting identity. |
| GET | `/v1/transfers/:hash` | Reads one registered transfer. |
| POST | `/v1/transfers/:hash/reconcile` | Runs the configured trusted network adapter; 503 when no adapter is configured. |

Registration requires exactly `hash`, `network`, `asset`, `sender`, `recipient`, `amount`, `contractId`, and `submittedAt`. Network must be `TESTNET`, asset `XLM`, amount a positive decimal string with at most seven fractional digits, contractId explicitly null for native payments (or a checksummed C address for a contract claim), and submittedAt a UTC timestamp like `2026-01-01T00:00:00.000Z`. Status, secrets and signed transaction payloads are rejected. Responses wrap the transfer in `{ "record": ... }`; errors use `{ "error": { "code": "...", "message": "..." } }`.

The registration amount is a positive decimal string with at most seven fractional digits and a maximum of 90,000,000,000 XLM (900,000,000,000,000,000 stroops), matching the frozen SDK `parseAmountToStroops` bound. This is a transport bound, not a claim about the deployed contract's accepted range. The transport retains its strict grammar (no whitespace or leading zeros) whereas SDK parsing trims and tolerates leading zeros; once the SDK ships compiled exports, `parseAmountToStroops` is used behind this grammar. New registration validates sender, recipient and non-null contract checksums using the Stellar SDK. All submitted payment details remain claims until checked against network evidence.

## SDK handoff

See [the backend SDK review](SDK_REVIEW.md) for the extracted interfaces, passing SDK checks, installed-package failure and remaining integration requirements. The SDK interface was frozen after extraction and is published at `jisr-pay/jisr-sdk`; its compiled/declaration exports are not yet shipped, so this API is still not a runtime consumer of it.

`createApi({ store, token, lookup })` injects a server-side lookup adapter. `lookup(record, { signal })` returns `null` for an unknown transaction, or `{ settlement, paymentVerified }`. Settlement fields match the current web `TransferSettlement` shape: `hash`, `successful`, `feeCharged`, `ledger`, `createdAt`. The live Horizon adapter, its verification matrix and outcome mapping are documented in [docs/EVIDENCE.md](docs/EVIDENCE.md); the wallet ownership verification design is in [docs/OWNERSHIP.md](docs/OWNERSHIP.md).

Only an adapter verifying the Testnet network, contract invocation, token, sender, recipient and amount against operation/event evidence may return `paymentVerified: true`. A transaction success flag alone is insufficient. Failed network transactions can be marked failed; missing results, exceptions, timeouts, invalid evidence and unverified successful payments do not change stored status. Concurrent requests share one lookup per process. Optimistic database revisions prevent delayed results from overwriting newer evidence; confirmed records cannot be downgraded.

The executable defaults to no live adapter and stays safe until `HORIZON_URL` is set (startup logs state which mode is active). Fixture adapters are used only in tests. When the Jisr SDK ships compiled exports, replace mirrored amount and transaction parsing with its read-only imports. Stellar SDK checksum and signature helpers are already used directly. No signing, rebroadcasting, background polling scheduler, fiat payout or bank provider integration is implemented.

This independent foundation uses Node HTTP and SQLite so it can run and be tested while the original Express/Postgres workspace remains under extraction. The existing API scaffold and database are not migrated or modified. Postgres migration and framework alignment should be agreed before production integration.

## Verification

```powershell
npm test
npm run build
```

Tests cover SEP-53 interoperability, wallet proof replay/expiry/revocation, origin and sender isolation, paged history, request limits, native payment confirmation, restart persistence, migration reruns, idempotency, immutable identities, untrusted fields, settlement evidence, stale writes across database connections, timeout/deduplication behavior, and real HTTP authentication/routes. Build performs syntax checks; there is no transpilation step. CI runs both on Windows and Linux. Tests use Node's in-process runner because this development sandbox restricts spawning test subprocesses.

See [OpenAPI](openapi.json) for the transport contract.

## Browser integration handoff

Set `WALLET_AUTH_ORIGIN` to the exact browser origin and proxy `/v1/wallet/*`
through that origin. Follow [the challenge/session protocol](docs/OWNERSHIP.md).
For current native XLM payments send `contractId: null`; do not forward the
legacy contract metadata from browser history as an invocation claim.
Old contract registrations are preserved and cannot be converted by retrying.
A matching native operation confirms only a native registration; contract claims
remain unverified until contract evidence decoding is implemented.

Schema migration 002 creates durable challenge/session tables and a sender
index without rewriting existing transfers. It applies in the startup transaction;
back up the SQLite database before upgrading. Older v1 binaries reject v2 databases.
Rollback requires restoring the pre-upgrade backup, not lowering user_version.

Wallet routes prove possession of the G-address key. They do not establish
multisig account authority or authorize funds. Real Freighter browser acceptance
and the frontend connection are still required.
