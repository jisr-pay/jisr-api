import test from 'node:test';
import assert from 'node:assert/strict';
import { createHorizonLookup } from '../src/evidence.js';
import { openStore } from '../src/store.js';
import { createReconciler } from '../src/reconcile.js';
import { Keypair, StrKey } from '@stellar/stellar-sdk';

const HASH = 'a'.repeat(64);
const CONTRACT = StrKey.encodeContract(Buffer.alloc(32));
const TX = {
  id: HASH, hash: HASH, successful: true, ledger: 104, created_at: '2026-01-01T00:00:00Z',
  fee_charged: '12345000',
};
const record = {
  hash: HASH, network: 'TESTNET', asset: 'XLM', sender: Keypair.random().publicKey(),
  recipient: Keypair.random().publicKey(), amount: '12.3456700', contractId: CONTRACT,
  submittedAt: '2026-01-01T00:00:00.000Z',
};
const nativeOp = (overrides = {}) => ({ transaction_hash: HASH, transaction_successful: true, type: 'payment', asset_type: 'native', asset_code: null,
  asset_issuer: null, from: record.sender, to: record.recipient, amount: '12.3456700', ...overrides });

function routes(ops = [], { assetOvers = {}, tx = TX } = {}) {
  return {
    [`/transactions/${HASH}`]: { status: 200, body: { ...tx } },
    [`/transactions/${HASH}/operations`]: { status: 200,
      body: { _embedded: { records: Array.isArray(ops) ? ops.map(o => ({ ...o, ...(assetOvers[o.type] ?? {}) })) : ops } } },
  };
}
function fetcher(routes) {
  return async (url, { signal } = {}) => {
    const path = url.replace('https://horizon.testnet', '').split('?')[0];
    const hit = routes[path] ?? (path === '' ? { status: 200, body: { network_passphrase: 'Test SDF Network ; September 2015' } } : undefined);
    if (signal?.aborted) throw new Error('aborted');
    if (!hit) return new Response('{}', { status: 404 });
    if (hit.throw) throw hit.throw;
    return new Response(JSON.stringify(hit.body), { status: hit.status });
  };
}
function lookup() {
  return createHorizonLookup({ horizonUrl: 'https://horizon.testnet', fetcher: fetcher(routes([nativeOp()])) });
}

test('SDK integration reads one transaction response and preserves request policy', async () => {
  const calls = [];
  const fake = fetcher(routes([nativeOp()], { tx: { ...TX, source_account: record.sender } }));
  const adapter = createHorizonLookup({ horizonUrl: 'https://horizon.testnet', fetcher: async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.accept, 'application/json');
    return fake(url, options);
  } });
  const evidence = await adapter({ ...record, contractId: null });
  assert.equal(evidence.paymentVerified, true);
  assert.equal(evidence.senderVerified, true);
  assert.equal(calls.filter(url => url.endsWith(`/transactions/${HASH}`)).length, 1);
  assert.equal(calls.length, 3);
});

test('reconciliation timeout aborts the SDK transaction request and stays pending', async t => {
  const store = openStore(':memory:'); t.after(() => store.close());
  store.register({ ...record, contractId: null });
  let requestSignal;
  const adapter = createHorizonLookup({ horizonUrl: 'https://horizon.testnet', fetcher: async (url, options) => {
    if (url === 'https://horizon.testnet') return new Response(JSON.stringify({ network_passphrase: 'Test SDF Network ; September 2015' }));
    requestSignal = options.signal;
    return new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
    });
  } });
  const result = await createReconciler(store, adapter, { timeoutMs: 30 })(HASH);
  assert.equal(result.outcome, 'unavailable');
  assert.equal(result.record.status, 'pending');
  assert.equal(requestSignal.aborted, true);
});

test('SDK integration preserves stricter API fee and timestamp evidence bounds', async () => {
  for (const patch of [{ fee_charged: '1'.repeat(19) }, { created_at: 'January 1, 2026' }, { id: 'b'.repeat(64) }]) {
    const adapter = createHorizonLookup({ horizonUrl: 'https://horizon.testnet', fetcher: fetcher(routes([], { tx: { ...TX, ...patch } })) });
    await assert.rejects(() => adapter(record), { code: 'NETWORK' });
  }
});

test('wrong or missing endpoint network identity rejects evidence', async () => {
  for (const body of [{ network_passphrase: 'Public Global Stellar Network ; September 2015' }, {}]) {
    const adapter = createHorizonLookup({ horizonUrl: 'https://horizon.testnet',
      fetcher: fetcher({ ...routes([nativeOp()]), '': { status: 200, body } }) });
    await assert.rejects(() => adapter(record), /Testnet identity/);
  }
});

test('transaction hash must match even when id matches', async () => {
  const adapter = createHorizonLookup({ horizonUrl: 'https://horizon.testnet',
    fetcher: fetcher(routes([nativeOp()], { tx: { ...TX, hash: 'b'.repeat(64) } })) });
  await assert.rejects(() => adapter(record), { code: 'NETWORK' });
});

test('unrelated or unsuccessful operations cannot prove payment', async () => {
  for (const override of [{ transaction_hash: 'b'.repeat(64) }, { transaction_successful: false }]) {
    const adapter = createHorizonLookup({ horizonUrl: 'https://horizon.testnet',
      fetcher: fetcher(routes([nativeOp(override)])) });
    assert.equal((await adapter({ ...record, contractId: null })).paymentVerified, false);
  }
});

test('explicit failure survives an unavailable operations endpoint', async () => {
  const adapter = createHorizonLookup({ horizonUrl: 'https://horizon.testnet', fetcher: fetcher({
    ...routes([], { tx: { ...TX, successful: false } }),
    [`/transactions/${HASH}/operations`]: { status: 503 },
  }) });
  assert.equal((await adapter(record)).settlement.successful, false);
});

test('transaction source establishes sender identity independently of failed operations', async () => {
  for (const source of [record.sender, record.recipient, undefined]) {
    const adapter = createHorizonLookup({ horizonUrl: 'https://horizon.testnet',
      fetcher: fetcher(routes([], { tx: { ...TX, successful: false, source_account: source } })) });
    assert.equal((await adapter(record)).senderVerified, source === record.sender);
  }
});

test('native XLM payment matches sender, recipient and amount exactly', async () => {
  const result = await lookup()({ ...record, contractId: null }, {});
  assert.equal(result.paymentVerified, true);
  assert.equal(result.reason, 'NATIVE_PAYMENT_MATCH');
  assert.deepEqual(result.settlement, { hash: HASH, successful: true, ledger: 104,
    createdAt: '2026-01-01T00:00:00Z', feeCharged: '1.2345000 XLM' });
});

test('sender mismatch cannot verify payment identity', async () => {
  const adapter = createHorizonLookup({ horizonUrl: 'https://horizon.testnet', fetcher: fetcher(routes([
    nativeOp({ from: 'G' + 'C'.padEnd(55, 'C').slice(0, 56) })])) });
  const result = await adapter(record, {});
  assert.equal(result.paymentVerified, false);
  assert.equal(result.reason, 'NO_MATCHING_EVIDENCE');
});

test('recipient mismatch cannot verify payment identity', async () => {
  const result = await createHorizonLookup({ horizonUrl: 'https://horizon.testnet', fetcher: fetcher(routes([
    nativeOp({ to: 'G' + 'C'.padEnd(55, 'C').slice(0, 56) })])) })(record, {});
  assert.equal(result.paymentVerified, false);
});

test('amount mismatch cannot verify payment identity', async () => {
  const result = await createHorizonLookup({ horizonUrl: 'https://horizon.testnet', fetcher: fetcher(routes([
    nativeOp({ amount: '12.3456701' })])) })(record, {});
  assert.equal(result.paymentVerified, false);
  assert.equal(result.reason, 'NO_MATCHING_EVIDENCE');
});

test('amount equality is compared in stroops regardless of trailing precision', async () => {
  const result = await createHorizonLookup({ horizonUrl: 'https://horizon.testnet', fetcher: fetcher(routes([
    nativeOp({ amount: '12.34567' })])) })({ ...record, contractId: null }, {});
  assert.equal(result.paymentVerified, true);
});

test('contract invocation is detected but stays unverified pending event decoding', async () => {
  const result = await createHorizonLookup({ horizonUrl: 'https://horizon.testnet', fetcher: fetcher(routes([
    { type: 'invoke_host_function', contract_id: CONTRACT }])) })(record, {});
  assert.equal(result.paymentVerified, false);
  assert.equal(result.reason, 'CONTRACT_EVIDENCE_PENDING');
});

test('unknown transaction returns null', async () => {
  const result = await createHorizonLookup({ horizonUrl: 'https://horizon.testnet', fetcher: fetcher({}) })(record, {});
  assert.equal(result, null);
});

test('failed transaction settles as unsuccessful without identity checks', async () => {
  const result = await createHorizonLookup({ horizonUrl: 'https://horizon.testnet', fetcher: fetcher(routes([], {
    tx: { ...TX, successful: false } })) })(record, {});
  assert.equal(result.settlement.successful, false);
  assert.equal(result.paymentVerified, false);
  assert.equal(result.reason, 'UNSUCCESSFUL_TRANSACTION');
});

test('rate-limited Horizon causes an unavailable outcome, never false verification', async () => {
  const adapter = createHorizonLookup({ horizonUrl: 'https://horizon.testnet', fetcher: fetcher({
    [`/transactions/${HASH}`]: { status: 429 } }) });
  await assert.rejects(() => adapter(record, {}), error => error.code === 'RATE_LIMITED');
});

test('malformed Horizon payloads throw instead of inventing evidence', async () => {
  const badOps = createHorizonLookup({ horizonUrl: 'https://horizon.testnet', fetcher: fetcher({
    [`/transactions/${HASH}`]: { status: 200, body: TX },
    [`/transactions/${HASH}/operations`]: { status: 200, body: { _embedded: { records: 'nope' } } },
  }) });
  await assert.rejects(() => badOps(record, {}));
  const badTx = createHorizonLookup({ horizonUrl: 'https://horizon.testnet', fetcher: fetcher({
    [`/transactions/${HASH}`]: { status: 200, body: { ...TX, fee_charged: '1.5' } } }) });
  await assert.rejects(() => badTx(record, {}));
});

test('far-future created_at is rejected as invalid evidence', async () => {
  const now = () => Date.UTC(2026, 0, 2);
  const adapter = createHorizonLookup({ horizonUrl: 'https://horizon.testnet', now,
    fetcher: fetcher(routes([], { tx: { ...TX, created_at: '2027-01-01T00:00:00Z' } })) });
  await assert.rejects(() => adapter(record, {}));
});

test('constructor validates horizonUrl and fetcher', () => {
  assert.throws(() => createHorizonLookup({ horizonUrl: 'nonsense' }), TypeError);
  assert.throws(() => createHorizonLookup({ horizonUrl: 'https://horizon.testnet', fetcher: 5 }), TypeError);
});

test('reconciler keeps native evidence pending when registration claims a contract', async () => {
  const store = openStore(':memory:');
  store.register(record);
  const reconcile = createReconciler(store, lookup(), { timeoutMs: 5000 });
  const { record: updated, outcome } = await reconcile(HASH);
  assert.equal(outcome, 'unverified_payment');
  assert.equal(updated.status, 'pending');
  store.close();
});

test('native registration confirms from matching evidence and survives idempotent retry', async t => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const native = { ...record, contractId: null };
  store.register(native);
  const result = await createReconciler(store, lookup())(HASH);
  assert.equal(result.outcome, 'confirmed');
  assert.equal(store.register(native).record.status, 'confirmed');
  assert.throws(() => store.register(record), { code: 'TRANSFER_CONFLICT' });
});

test('reconciler leaves unverified successful payments pending', async () => {
  const store = openStore(':memory:');
  store.register(record);
  const reconcile = createReconciler(store, createHorizonLookup({ horizonUrl: 'https://horizon.testnet', fetcher: fetcher(routes([
    nativeOp({ from: 'G' + 'C'.padEnd(55, 'C').slice(0, 56) })])) }), { timeoutMs: 5000 });
  const { outcome } = await reconcile(HASH);
  assert.equal(outcome, 'unverified_payment');
  assert.equal(store.get(HASH).status, 'pending');
  store.close();
});

test('reconciler maps unknown and unavailable outcomes without state change', async () => {
  const unknown = openStore(':memory:');
  unknown.register(record);
  const never = createReconciler(unknown, createHorizonLookup({ horizonUrl: 'https://horizon.testnet', fetcher: fetcher({}) }), { timeoutMs: 5000 });
  assert.equal((await never(HASH)).outcome, 'unknown');
  unknown.close();
  const throttled = openStore(':memory:');
  throttled.register(record);
  const busy = createReconciler(throttled, createHorizonLookup({ horizonUrl: 'https://horizon.testnet', fetcher: fetcher({
    [`/transactions/${HASH}`]: { status: 429 } }) }), { timeoutMs: 5000 });
  assert.equal((await busy(HASH)).outcome, 'unavailable');
  throttled.close();
});

test('reconciler settles genuine failures as failed', async () => {
  const store = openStore(':memory:');
  store.register(record);
  const reconcile = createReconciler(store, createHorizonLookup({ horizonUrl: 'https://horizon.testnet', fetcher: fetcher(routes([], {
    tx: { ...TX, successful: false } })) }), { timeoutMs: 5000 });
  const { record: updated, outcome } = await reconcile(HASH);
  assert.equal(outcome, 'failed');
  assert.equal(updated.status, 'failed');
  store.close();
});
