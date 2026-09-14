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
fetcher (network responses are mocked in tests):

- `GET /` - requires the exact Stellar Testnet `network_passphrase` before reading transaction evidence.
- `GET /transactions/{hash}` — transaction record (matching id and hash, successful, ledger,
  created_at, fee_charged). 404 → unknown; 429 → throws (unavailable).
- `GET /transactions/{hash}/operations` — operations list used for identity.

The transaction fetch now uses the installed Jisr SDK fetchSettlement helper.
A fetch adapter composes caller cancellation with the SDK timeout and supplies
one response body to both settlement validation and sender identity checks.
API-specific id, fee-length and timestamp grammar checks remain stricter than
the SDK. Exact operation amounts use the SDK amount parser.

### Verification matrix

| Path | Proven this session? | Why |
| --- | --- | --- |
| Native XLM payment op | Only without a contract claim | `type=payment & asset_type=native`; exact sender, recipient and stroops-equivalent amount match. |
| `route_payment` (Soroban) | Partially | Invocation to the registered contract is detected, but token/sender/recipient/amount live in **Soroban events**, whose decoding needs the original contract source — pending. |

Native operations must carry the requested transaction hash and a successful operation flag. A native match cannot prove a registered contract invocation: registrations with a non-null `contractId` keep these successful payments pending with `CONTRACT_EVIDENCE_PENDING`. Register native payments with explicit `contractId: null`; matching native evidence can confirm these records. Contract event decoding remains outstanding. Explicit failed transactions do not require an operations lookup.

Reference: [Horizon payment object](https://developers.stellar.org/docs/data/apis/horizon/api-reference/resources/payments/object).

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

The adapter also returns senderVerified when the transaction source_account
matches the claimed sender. This allows a wallet to register its own failed
transaction without claiming the failed operations paid anyone. HTTPS is required
and redirects are rejected.
