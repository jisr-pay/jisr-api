# Live payment evidence

Native payments use Horizon operation identity. Custom router payments additionally require explicit server-side policy and SDK 0.4.0 verification of the transaction envelope and successful contract/token events. See [router integration](ROUTER_INTEGRATION.md).

Configure HORIZON_URL, SOROBAN_RPC_URL, ROUTER_CONTRACT_ID, ROUTER_TOKEN_ADDRESS, ROUTER_TREASURY_ADDRESS and ROUTER_FEE_BPS together. The API accepts Testnet XLM only. Policy is administrator-controlled, never client-supplied.

Confirmation requires exact sender, recipient, total debit, router, token, treasury, basis-point fee, net recipient transfer and fee transfer. Horizon and RPC must agree on ledger. The native path cannot establish a contract claim. Without router configuration, contract claims stay pending. RPC NOT_FOUND, missing or contradictory events, malformed XDR and duplicate transfers never confirm a payment. Network timeouts preserve pending state; an explicit failed Horizon transaction can mark a transfer failed independently of contract evidence.

The verifier supports one route_payment invocation operation from the sender account; fee-bump and multi-operation envelopes are outside current scope. Rpc getTransaction history is bounded, so a missing old transaction is unknown rather than failed. SDK lookup uses a ten-second deadline; the caller may set a total reconciliation timeout (the live check used 30 seconds). RPC errors and wrong network identity return unavailable through the reconciler.

Reproduce with npm test, npm run check:sdk and npm run build on Node 24.15–24.x. Test fixtures contain unsigned envelopes and public successful contract events, never signing keys or signed payloads.

The trusted adapter returns settlement and paymentVerified; confirmed requires paymentVerified=true. Explicit failure does not require successful payment events. See router-live-verification-2026-10-08.json for the exact live observation; no browser signing or production deployment is implied.
