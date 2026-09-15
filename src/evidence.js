/**
 * Live Horizon evidence adapter with an injectable fetcher.
 *
 * lookup(record, { signal }) has the same trusted-server contract as reconcile.js:
 *   null                                     -> transaction unknown on Horizon
 *   { settlement, paymentVerified, reason }  -> discoverable evidence
 *
 * paymentVerified is true only when a native XLM payment operation proves the
 * transaction's sender, recipient and amount exactly, with no contract claim.
 * The endpoint must identify itself as Testnet. Payments routed through
 * the route_payment contract are detected but their token/sender/recipient/
 * amount identities cannot yet be proven without the contract source and
 * Soroban event decoding; those default to unverified rather than guessed.
 *
 * The SDK validates transaction settlement; this adapter additionally verifies
 * endpoint and payment identity, bounds evidence, and composes cancellation.
 */

import { parseAmountToStroops } from '@workspace/jisr-sdk/amount';
import { fetchSettlement } from '@workspace/jisr-sdk/settlement';
const TESTNET_PASSPHRASE = 'Test SDF Network ; September 2015';

function toStroops(amount) {
  if (typeof amount !== 'string' || !/^(0|[1-9]\d{0,11})(\.\d{1,7})?$/.test(amount)) {
    throw new Error('Malformed XLM amount in Horizon evidence.');
  }
  return parseAmountToStroops(amount);
}

async function fetchJson(url, fetcher, signal) {
  const response = await fetcher(url, { headers: { accept: 'application/json' }, signal, redirect: 'error' });
  if (response.status === 404) return { status: 404, body: null };
  if (response.status === 429) {
    const error = new Error('Horizon rate limit reached.');
    error.code = 'RATE_LIMITED';
    throw error;
  }
  if (!response.ok) throw new Error(`Horizon HTTP ${response.status}.`);
  let body;
  try { body = await response.json(); } catch { throw new Error('Horizon returned non-JSON body.'); }
  return { status: response.status, body };
}

export function createHorizonLookup({ horizonUrl, fetcher = fetch, now = Date.now } = {}) {
  let endpoint;
  try { endpoint = new URL(horizonUrl); } catch { throw new TypeError('Invalid horizonUrl.'); }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new TypeError('Horizon must use HTTPS without credentials, query or fragment.');
  }
  if (typeof fetcher !== 'function') throw new TypeError('Invalid fetcher.');
  const base = horizonUrl.replace(/\/+$/, '');

  async function fetchTransaction(hash, signal) {
    let body;
    const settlement = await fetchSettlement(base, hash, async (url, options) => {
      const combined = AbortSignal.any([signal, options?.signal].filter(Boolean));
      const response = await fetcher(url, { ...options, signal: combined,
        headers: { accept: 'application/json' }, redirect: 'error' });
      // One network request and one JSON read. SDK validation consumes the same
      // body whose source_account supplies registration ownership evidence.
      return { status: response.status, ok: response.ok, json: async () => {
        body = await response.json();
        if (!body || Array.isArray(body) || body.id !== hash ||
            typeof body.fee_charged !== 'string' || !/^\d{1,18}$/.test(body.fee_charged) ||
            typeof body.created_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T[\d:.Z-]+$/.test(body.created_at) ||
            Date.parse(body.created_at) > now() + 300_000) {
          throw new Error('Invalid supplemental transaction evidence.');
        }
        return body;
      } };
    });
    return settlement ? { sourceAccount: body.source_account, settlement } : { notFound: true };
  }

  async function fetchOperations(hash, signal) {
    const { status, body } = await fetchJson(`${base}/transactions/${hash}/operations?limit=200&order=desc`,
      fetcher, signal);
    if (status === 404) return [];
    if (!body?._embedded || !Array.isArray(body._embedded.records)) {
      throw new Error('Invalid Horizon operations payload.');
    }
    return body._embedded.records;
  }

  function classify(record, ops) {
    for (const op of ops) {
      if (!op || op.transaction_hash !== record.hash || op.transaction_successful !== true ||
          op.type !== 'payment' || op.asset_type !== 'native') continue;
      try {
        if (op.from === record.sender && op.to === record.recipient &&
            toStroops(op.amount) === toStroops(record.amount)) {
          // A native payment cannot establish a claimed contract invocation.
          return record.contractId
            ? { paymentVerified: false, reason: 'CONTRACT_EVIDENCE_PENDING' }
            : { paymentVerified: true, reason: 'NATIVE_PAYMENT_MATCH' };
        }
      } catch { continue; }
    }
    const invoked = ops.some(op => op && op.type === 'invoke_host_function' &&
      (record.contractId ? op.contract_id === record.contractId : typeof op.contract_id === 'string'));
    if (invoked) return { paymentVerified: false, reason: 'CONTRACT_EVIDENCE_PENDING' };
    return { paymentVerified: false, reason: 'NO_MATCHING_EVIDENCE' };
  }

  return function lookup(record, { signal } = {}) {
    const verify = async () => {
      if (record.network !== 'TESTNET' || record.asset !== 'XLM') {
        throw new Error('Unsupported network or asset; this adapter only accepts Testnet XLM.');
      }
      const root = await fetchJson(base, fetcher, signal);
      if (root.body?.network_passphrase !== TESTNET_PASSPHRASE) {
        throw new Error('Horizon endpoint did not establish Stellar Testnet identity.');
      }
      const transaction = await fetchTransaction(record.hash, signal);
      if (transaction.notFound) return null;
      // Explicit failure does not depend on operation availability.
      const ops = transaction.settlement.successful
        ? await fetchOperations(record.hash, signal) : [];
      const verdict = transaction.settlement.successful
        ? classify(record, ops)
        : { paymentVerified: false, reason: 'UNSUCCESSFUL_TRANSACTION' };
      return { settlement: transaction.settlement, senderVerified: transaction.sourceAccount === record.sender, ...verdict };
    };
    return verify();
  };
}
