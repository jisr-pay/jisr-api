# Frontend integration handoff

Backend milestone: native XLM tracking and wallet-key sessions implemented.
The API is not deployed and the web app has not been wired to these routes.

## EthTobi priorities

1. SDK v0.3.0 packaging and backend integration are verified. Keep the read-only
   exports compatible when publishing later versions; report the package version
   and artifact/source commit.
2. Add payment-flow component coverage before splitting `AgentPipeline.tsx`:
   signature rejection, duplicate clicks, saved hash before broadcast, timeout,
   reload recovery, failed settlement, and receipt retry. Keep EN/AR parity.
3. Integrate wallet sessions and remote recovery behind configuration, using
   [OpenAPI](../openapi.json) and [the login protocol](OWNERSHIP.md).

## Native registration mapping

Send only hash, network (`TESTNET`), asset (`XLM`), sender, recipient, amount
(decimal string), contractId (`null`), and submittedAt (canonical UTC with
milliseconds). Keep submittedAt and all other identity fields identical when
retrying. A conflict is not permission to overwrite another registration.
Do not copy legacy contract metadata into native registrations.

Connect the wallet on Testnet before requesting a login challenge. Sign the
returned message exactly, check the returned signer matches the requested
address, and exchange its base64 signature for a session. Keep the token in
memory. On wallet switch, disconnect or expiry, clear it and authenticate again.
Use wallet routes exclusively; never put SERVICE_TOKEN in frontend configuration.

Configure a same-origin proxy for `/v1/wallet/*` and set WALLET_AUTH_ORIGIN on
the backend to that browser origin. HORIZON_URL enables read-only Testnet
reconciliation. Neither setting requires publishing a service credential.

Persist the signed hash locally before broadcasting as today. Backend downtime
must not erase local history or trigger a second signature/broadcast. Retry
remote registration using the same immutable payload. Distinguish unavailable,
unknown and unverified_payment from actual failure. List history with nextCursor
pagination; hash order is not chronological order.

## Acceptance still requiring a browser

Complete real Freighter login on Testnet, reject and retry login, switch wallets,
expire/revoke a session, reload pending history, and reconcile a known transaction
without signing again. The automated backend suite uses signed test keys and
mocked network responses; it cannot establish real wallet UX or deployment.

The current authentication scope proves G-address key possession, not multisig
account authority. No signing, broadcast, fiat payout or contract event decoding
is implemented by the backend.

New wallet registrations require trusted network evidence first, preventing a
caller from reserving another payment's hash. A successful native payment must
match the claimed identity; a failed transaction must prove its source address.
Unknown/malformed/unavailable evidence returns 503; keep local history and retry.
Unverified identity returns 422. Identical existing retries work while offline
from Horizon. Service-only registration retains its trusted pending-first model.
