# Wallet ownership verification

Design for the acceptance criterion: *"Define and implement wallet ownership
verification before exposing private account history or accepting owner-scoped
mutations. A supplied public address is not authentication."*

## Problem

A Stellar `G...` sender address is public. Anyone can claim another address and
look up or mutate that account's state. The existing registration validates
address **shape** only, and explicitly states checksum validation is pending
(on the SDK). Neither proves the registrant holds the private key.

## Design (proposal — not yet implemented)

Registration associates a transfer with a sender address. Ownership adds a
one-time possession proof bound to that registration:

1. **Challenge.** The service issues a fresh, single-use challenge:
   `nonce = base64(32 random bytes)`, with an expiry (5 minutes). The client
   never pre-signs; each challenge is issued per registration attempt.
2. **Signing.** The wallet signs a deterministic message over the canonical
   fields with its Stellar key:
   `"jisr-pay/v1\n<network>\n<contractId>\n<sender>\n<nonce>"` using
   Ed25519 (as Stellar produces from the keypair).
3. **Verification.** The service recomputes the message, verifies the signature
   against `sender` and checks the nonce has not been used and has not
   expired. Any failure rejects the registration.
4. **Binding.** A verified session binds subsequent owner-scoped reads and
   mutations to that ownership proof until it expires; re-authentication is
   required on expiry.

### Threat model

- **Replay** — single-use nonce + expiry defeat replayed signatures.
- **Cross-network replay** — the network string is inside the signed message.
- **Confused-deputy** — the message domain (`jisr-pay/v1`) prevents the
  signature being reused as a Stellar transaction.
- **Stale claims** — no check on "who owns the address today"; ownership is a
  live possession proof at registration time, which is the specified scope.

### Acceptance criteria met by this design

- Defined before any private-history route or owner-scoped mutation exists
  (none do today — recording this now keeps the gate closed).
- Testable: duplicate nonce, expired nonce, wrong network, wrong domain,
  signature from a different key, malformed base64, and cross-key transfer
  must all fail; the happy path must pass.
- Signed payloads are verified **server-side**; the signed message is not a
  private key and nothing secret is stored.

## Status

Not implemented. Reason: the SDK (checksum validators + Ed25519 sign/verify
helpers) does not yet ship compiled exports, and the ownership gate is defined
before owner-scoped routes. When the SDK lands, implement behind the frozen
SDK helpers and wire into registration + owner-scoped reads.