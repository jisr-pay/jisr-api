# Backend SDK review — September 12, 2026

Reviewed the now-committed and published `@workspace/jisr-sdk` checkout as the backend consumer. The interface was frozen after extraction (docs/API_HANDOFF.md) and is published at `jisr-pay/jisr-sdk` (main `92abec3`, history-preserving rewrite, CI green on Windows and Linux). This is a re-verification of the September 11 review against the committed state; nothing here edits the SDK or parent workspace.

## Verified on the committed SDK

- Node 24.19.0 directly imports `src/index.ts` without a browser or wallet dependency.
- The barrel exports `parseAmountToStroops`, `fetchSettlement`, `isSavedTransfer`, `applySettlement`, `TransferSettlement`, `SavedTransfer`, `TransferStatus`, `HistoryStorage`, `TransactionResult` and the frozen error/rate-limit/logger/network surfaces, matching `docs/API_HANDOFF.md`.
- `fetchSettlement(horizonUrl, hash, fetcher?)` still supports injected HTTP reads; unknown transactions return `null`; explicit failures remain distinguishable from transport errors. The consumer smoke check (`scripts/check-sdk.js`) passes this part without network calls.
- Published SDK CI runs install/test/typecheck under `node --experimental-strip-types`, so it is green without producing compiled artifacts.

## Integration blockers (unchanged unless noted)

1. **Installed Node package still fails.** Exports still point to `.ts` source, so importing from a real `node_modules/@workspace/jisr-sdk` on Node 24.19.0 fails with `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. Re-verified against the published `main`. Ship compiled JavaScript and declaration exports, then verify a packed artifact in an isolated Node consumer. Until then the API does not add the SDK as a runtime dependency.
2. **Amount bounds now aligned.** The SDK `parseAmountToStroops` caps at 900,000,000,000,000,000 stroops (90 billion XLM); the API transport previously allowed up to signed 64-bit. The API transport now enforces the same cap through its strict grammar (no whitespace, no leading zeros), with regression coverage at and above the boundary. When compiled exports ship, replace that transport count with a direct `parseAmountToStroops` call behind the grammar. Neither bound establishes deployed contract behavior.
3. **No payment identity evidence.** `fetchSettlement` provides transaction status, fee, ledger and timestamp only. It does not establish network passphrase, router invocation, token, sender, recipient or amount. Do not convert success into `paymentVerified: true`. A future evidence lookup must verify the configured network and decoded operation/event details. Original contract source is still required to establish intended fee and authorization behavior.
4. **Cancellation and address checks.** The lookup uses its own ten-second timeout and exposes no caller signal; add signal composition for API cancellation. `isSavedTransfer` validates address shape only. `resolveNetworkConfig` validates configuration addresses, but there is no exported general registration checksum validator. Keep transport registration and trusted evidence validation distinct.

Prefer read-only subpath imports for backend runtime code once compiled exports exist. Do not import payment submission or adapt browser signing into the API. No runtime SDK integration is enabled by this review.

## Plan-step-3 extraction gate — PASSED (September 12, 2026)

Consumer review of the merged SDK extraction (jisr-web PR #14 → `main` `d911c3e`) before backend consumption, per docs/COLLABORATION_PLAN.md step 3:

- **Tests:** 38 SDK + 18 web tests pass (`node --experimental-strip-types --test`), matching the PR claim.
- **Typecheck:** workspace `tsc --build` green; web `tsc -p tsconfig.json --noEmit` green.
- **Build:** Vite production build green (3209 modules, chunked, within limits). Root `pnpm run build/typecheck` still nest a bare `pnpm` locally; CI runs them correctly.
- **Browser-free core:** the pinning test scans non-test SDK files for `import.meta`, `localStorage`, `document.`, `window.` and `freighter-api`; only `.test.ts` files match. The sole `import.meta.env` touchpoints are in the app (`App.tsx` BASE_URL, `main.tsx` prod-suppression via `setLogSink`, and the `network-config.ts` shim feeding `resolveNetworkConfig`).
- **Exports:** barrel matches the `docs/API_HANDOFF.md` freeze table exactly; the `check-sdk.js` consumer smoke (exports + injected settlement) passes.
- **Web shim:** `buildAndSubmitFreighterPayment` adapts Freighter to the SDK `PaymentWallet` port preserving the old call signature; no browser import leaks into the SDK.
- **Honest gap confirmed:** no `payment.test.ts` exists; `payment.ts` orchestration is exercised only through `buildAndSubmitFreighterPayment`.

Interface freeze validated. The remaining consumer blocker is the installed-package packaging (source-only exports → `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), which lives in the standalone `jisr-sdk` publication path, not in this extraction.

## Reproduce the consumer review

From this clone, run `node scripts/check-sdk.js ../../lib/jisr-sdk`. It reads the SDK checkout, checks exports and settlement behavior with a fake fetcher, then probes the current source-only amount package layout in a temporary directory which it removes. Exit code 1 currently records the packaging blocker; this optional check is intentionally outside default CI because the SDK checkout is external and not version-pinned. Revisit the packaging probe when compiled artifacts become available.

## September 13 backend continuation

Standalone SDK HEAD e8d641f still exports TypeScript source. The checkout smoke
passes; installed Node import still fails with ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING.
Jisr runtime integration remains blocked on compiled exports. The API now uses
@stellar/stellar-sdk 16.3.0 directly for checksum and signature primitives, so
registration checksums and wallet key-possession authentication are implemented.
Amount/settlement parsing remains mirrored until Jisr packaging is ready.
