# Live evidence lookup

How the trusted server adapter proves that a transaction really paid the claimed
recipient, and what remains blocked.

## Boundary

`lookup(record, { signal })` is a server-side adapter, never client input. It
returns:

- `null` — transaction unknown on the network;
- `{ settlement, paymentVerified, reason }` — discoverable evidence.

`settlement` uses the frozen SDK `TransferSettlement` shape: `hash`,
`successful`, `feeCharged`, `ledger`, `createdAt`. `reconcile.js` trusts a
successful transaction **only** when `paymentVerified === true`; anything else
keeps the transfer pending or marks a genuine network failure as failed.

## Implementation: `createHorizonLookup`

`src/evidence.js` implements the boundary against Horizon with an injectable
fetcher (no network and no npm dependencies in tests):

- `GET /transactions/{hash}` — transaction record (id, successful, ledger,
  created_at, fee_charged). 404 → unknown; 429 → throws (unavailable).
- `GET /transactions/{hash}/operations` — operations list used for identity.

The transaction fetch mirrors the frozen SDK `fetchSettlement` grammar
(strict transport checks, same bounds, far-future rejection). Once the SDK
ships compiled exports, this portion swaps to the SDK parser and the rest of
the contract stays identical.

### Verification matrix

| Path | Proven this session? | Why |
| --- | --- | --- |
| Native XLM payment op | Yes | `type=payment & asset_type=native`; exact sender, recipient and stroops-equivalent amount match. |
| `route_payment` (Soroban) | Partially | Invocation to the registered contract is detected, but token/sender/recipient/amount live in **Soroban events**, whose decoding needs the original contract source — pending. |

Native-path victories satisfy network, token, sender, recipient and amount.
Contract-routed transfers are returned as `CONTRACT_EVIDENCE_PENDING` (never
guessed) until event decoding lands.

### Outcomes

| Adapter result | Reconciliation outcome |
| --- | --- |
| successful + `paymentVerified: true` | `confirmed` |
| successful + unverified | `unverified_payment` (stays pending) |
| explicit failure (`successful: false`) | `failed` |
| transaction 404 | `unknown` |
| throw (429, network, timeout, malformed evidence) | `unavailable` |

## Wiring

The executable keeps the no-adapter default. Set `HORIZON_URL` (e.g.
`https://horizon-testnet.stellar.org`) to enable the live adapter; the startup
log states which mode is active. This preserves the safety property that an
unconfigured service cannot report false settlement evidence.

## Outstanding blockers

- **Contract source** for `route_payment` event decoding (original source +
  deployment provenance from the source holder).
- **SDK compiled exports** so `parseAmountToStroops` / `fetchSettlement` are
  consumed behind this transport grammar instead of mirrored.