# Backend SDK review — September 11, 2026

Reviewed EthTobi's in-progress `lib/jisr-sdk` checkout without editing it or the parent workspace. This is an observation of uncommitted work, not an agreed interface freeze.

## Verified

- Node 24.19.0 directly imports `src/index.ts` without a browser or wallet dependency.
- All 35 extracted regression tests pass with `node --test --test-isolation=none`; TypeScript checking passes using the workspace TypeScript executable.
- `TransferSettlement`, `SavedTransfer`, `TransferStatus`, `HistoryStorage` and `TransactionResult` are exported types. The settlement shape matches the API boundary. The SDK journal is synchronous and is not a replacement for transactional API storage.
- `fetchSettlement(horizonUrl, hash, fetcher?)` supports injected HTTP reads. Unknown transactions return null; explicit failures remain distinguishable from transport errors. The consumer smoke check exercises this without network calls.

## Integration blockers and requested interface changes

1. **Installed Node package fails.** Exports point to `.ts` source. Copying the dependency-free amount entrypoint into a real `node_modules/@workspace/jisr-sdk` directory and importing it on Node 24.19.0 fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. Workspace/source imports pass because they resolve outside that directory. Ship compiled JavaScript and declaration exports, then verify a packed artifact in an isolated Node consumer. Do not add a production dependency on the mutable parent checkout.
2. **Amount bounds differ.** SDK `parseAmountToStroops` caps values at 900,000,000,000,000,000 stroops (90 billion XLM); the API transport currently allows up to signed 64-bit stroops. SDK parsing also trims whitespace and accepts leading zeroes while API transport rejects them. After packaging and interface freeze, reuse SDK parsing behind the strict transport grammar and document/test the agreed cap. Neither bound establishes deployed contract behavior.
3. **No payment identity evidence.** `fetchSettlement` provides transaction status, fee, ledger and timestamp only. It does not establish network passphrase, router invocation, token, sender, recipient or amount. Do not convert success into `paymentVerified: true`. A future evidence lookup must verify the configured network and decoded operation/event details. Original contract source is still required to establish intended fee and authorization behavior.
4. **Cancellation and address checks.** The lookup uses its own ten-second timeout and exposes no caller signal; add signal composition for API cancellation. `isSavedTransfer` validates address shape only. `resolveNetworkConfig` validates configuration addresses, but there is no exported general registration checksum validator. Keep transport registration and trusted evidence validation distinct.

Prefer read-only subpath imports for backend runtime code once compiled exports exist. Do not import payment submission or adapt browser signing into the API. No runtime SDK integration is enabled by this review.

## Reproduce the consumer review

From this clone, run `node scripts/check-sdk.js ../../lib/jisr-sdk`. It reads the SDK checkout, checks exports and settlement behavior with a fake fetcher, then probes the current source-only amount package layout in a temporary directory which it removes. Exit code 1 currently records the packaging blocker; this optional check is intentionally outside default CI because the SDK checkout is external and not version-pinned. Revisit the packaging probe when compiled artifacts become available.
