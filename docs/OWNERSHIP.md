# Wallet sessions

Implemented behind `WALLET_AUTH_ORIGIN`, an explicit HTTPS origin such as
`https://pay.example`. HTTP localhost/127.0.0.1 are allowed for development.
Routes remain disabled when the setting is absent. Serve frontend and API
through the same origin; cross-origin browser requests are not enabled.

## Protocol

1. POST `/v1/wallet/challenges` with `{ "address": "G..." }`. The server checks
   the address checksum and returns id, address, message and expiresAt (epoch ms).
2. Ask the wallet to sign the exact UTF-8 message using SEP-53. Do not prepend
   the Stellar prefix yourself: the wallet handles prefixing and hashing.
3. POST `/v1/wallet/sessions` with `{ "id": "...", "signature": "..." }`.
   The signature is canonical base64 encoding of 64 Ed25519 signature bytes.
4. Use the token as `Authorization: Bearer <token>` on wallet routes. It expires
   after 15 minutes. Keep tokens in memory, never in URLs or logs.
5. DELETE `/v1/wallet/session` revokes that token. Disconnecting the browser
   wallet should clear the local token and call this route.

Challenges include the configured origin, Testnet, address, random 256-bit
nonce, issue time, five-minute expiry and login purpose. SQLite consumes the
challenge and creates its session atomically. Replays fail across processes
and restarts. Only origin-bound token hashes are stored. Signatures and private
keys are not persisted. Expired rows are pruned on authentication writes.

Each socket peer is limited to 120 wallet requests per minute; forwarded IP
headers are ignored. The limiter holds at most 10,000 peers. Outstanding
challenges are capped at five per address and 10,000 globally. These are local
service controls; a public reverse proxy should also enforce request limits.

## Authorization

- `/v1/wallet/transfers`: POST requires sender equal to the session address;
  GET lists only that sender, 50 per page, ordered by hash. Pass nextCursor as after.
- `/v1/wallet/transfers/{hash}` and its `/reconcile` route return 404 for another
  sender, including when the caller knows the hash.
- Service credentials and wallet sessions cannot access each other's routes.
- Registration remains an unverified claim. A signature authenticates the
  API caller; only network evidence can confirm a payment.

## Scope and evidence

This is key-possession authentication, not SEP-10 account authentication. It
does not evaluate account signer weights, disabled master keys, multisig or
muxed accounts. Access is defined by possession of the G-address key, not
current on-chain transaction authority. It does not authorize funds.
An account-authority product requires SEP-10 and a separately reviewed policy.

The implementation uses Stellar SDK checksum/Ed25519 primitives and the
[SEP-53 specification](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0053.md).
Tests include the published vector, domain/network/nonce tampering, wrong-key
proofs, expiry, replay, restart persistence, revocation, HTTP origin checks,
sender isolation and pagination. Real Freighter acceptance remains a frontend
handoff task.

New wallet registrations require trusted network evidence first, preventing a
caller from reserving another payment's hash. A successful native payment must
match the claimed identity; a failed transaction must prove its source address.
Unknown/malformed/unavailable evidence returns 503; keep local history and retry.
Unverified identity returns 422. Identical existing retries work while offline
from Horizon. Service-only registration retains its trusted pending-first model.
