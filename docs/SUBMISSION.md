# Durable Stellar transfer tracking and evidence-based reconciliation

Prepared for the October 9, 2026 Stellar Wave submission.

## Purpose and implemented utility

The standalone Node HTTP/SQLite service tracks immutable Testnet transfers, verifies native XLM payment evidence through Horizon, and exposes sender-scoped wallet sessions with challenge replay/expiry controls. It consumes a pinned compiled Jisr SDK artifact.

## Reproduce the implementation

Node 24.15+ within Node 24; `npm ci`, `npm run check:sdk`, `npm test`, `npm run build`. Copy .env.example into local configuration, keep SERVICE_TOKEN server-side, and use `npm start`. Follow docs/OWNERSHIP.md for wallet sessions.

## Evidence and supported scope

Native confirmation matches exact amount, sender, recipient, network and asset. Supported router claims are verified against exact invocation, routed and token-transfer events under explicit server policy; timeouts/missing results stay pending. Signing/rebroadcasting are outside the API. API functionality can be evaluated independently of the current web contract flow. Live deployed wallet acceptance remains a separate check.

Evidence reference: [native-payment evidence contract](EVIDENCE.md).
Baseline source revision: `43592e5d0a519c4fdc3b7cb1d354c5d8b251c7ba`. Final reviewed preparation revision and CI
results belong in [VERIFICATION_OCT09.md](VERIFICATION_OCT09.md).

## Maintainers and contributor work

Maintainers: xteesamz and EthTobi; contact via GitHub, available anytime.
See [MAINTAINERS.md](../MAINTAINERS.md), [CONTRIBUTING.md](../CONTRIBUTING.md),
[SECURITY.md](../SECURITY.md), and [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).
The [focused engineering backlog](WAVE_BACKLOG.md) describes real work, relevant
files, tests, and acceptance criteria. Draft complexity values require maintainer
review and app enrollment; they do not establish approval or earned points.

## Before applying

- Confirm the Drips Wave App covers this repository and check application slots.
- Publish the reviewed backlog issues and preserve links to their acceptance checks.
- Publish these preparation changes through a reviewed PR with passing CI.
- Apply under the implemented scope above; no production/adoption claims are implied.
