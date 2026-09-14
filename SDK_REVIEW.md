# Backend SDK integration - September 14, 2026

The installed-package blocker is resolved by SDK v0.3.0. The API now consumes
compiled read-only subpaths from the pinned artifact in vendor/.

## Verified

- Source tree 59350f13ef5f6a10717a4ebb985891f5269a38ad matches standalone SDK commit
  4a21043ec238a11adbc9c99f858e438fbc4fad9e and the web workspace package used to pack it.
- npm pack ran the SDK build; runtime JavaScript and declarations are included.
- npm run check:sdk installs the API lockfile into a temporary project outside
  the workspace, without install scripts, network access, symlinks or TS loaders.
  Compiled imports, declaration files, exact amounts and injected read-only
  settlement checks pass. Run npm ci first to populate the local package cache.
- The SDK source suite passes 49 tests. The API suite passes 41 tests; syntax
  and OpenAPI JSON checks pass. Network results are mocked.

## Runtime boundary

registration and native operation comparison use parseAmountToStroops. The API
retains its stricter no-whitespace/no-leading-zero transport grammar.
fetchSettlement validates transaction status, hash, ledger, timestamp and exact
fee formatting. Its injected fetch adapter reads a single network response,
combines caller cancellation with the SDK timeout, rejects redirects and keeps
the API's stricter fee/id/date checks. Source-account ownership comes from that
same response. Operation identity and Testnet endpoint verification remain API
responsibilities; transaction success alone cannot verify a payment.

Wallet checksum/signature primitives still use Stellar SDK 16.3.0 directly.
No backend import uses Jisr payment submission, wallet signing or rebroadcasting.

## Remaining work

Contract claims remain unverified until original contract evidence can be decoded.
Frontend wallet-session integration and a real Freighter Testnet acceptance run
remain outstanding. The backend is not deployed by this integration.
