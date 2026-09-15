import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { openStore } from '../src/store.js';
import { createReconciler } from '../src/reconcile.js';
import { createApi } from '../src/server.js';
import { Keypair, StrKey } from '@stellar/stellar-sdk';

const sender = Keypair.random().publicKey();
const recipient = Keypair.random().publicKey();

const transfer = () => ({ hash: 'a'.repeat(64), network: 'TESTNET', asset: 'XLM',
  sender, recipient, amount: '1.0000001',
  contractId: StrKey.encodeContract(Buffer.alloc(32)), submittedAt: '2026-01-01T00:00:00.000Z' });
const evidence = (successful = true) => ({ paymentVerified: true, settlement: {
  hash: 'a'.repeat(64), successful, ledger: 10, createdAt: '2026-01-01T00:00:05Z', feeCharged: '0.0000100 XLM',
} });
function setup(t) {
  const store = openStore(':memory:'); t.after(() => store.close()); store.register(transfer()); return store;
}

test('registration persists through restart and migration reruns; duplicates are idempotent', t => {
  const dir = mkdtempSync(join(tmpdir(), 'jisr-api-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'db.sqlite');
  let store = openStore(path);
  assert.equal(store.register(transfer()).created, true);
  assert.equal(store.register(transfer()).created, false);
  assert.throws(() => store.register({ ...transfer(), amount: '2' }), { code: 'TRANSFER_CONFLICT' });
  store.close(); store = openStore(path);
  assert.equal(store.get(transfer().hash).amount, '1.0000001');
  assert.equal(store.get(transfer().hash).status, 'pending');
  store.close();
});

test('v1 migration preserves existing identity and settlement; newer schemas are rejected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jisr-migrate-'));
  const path = join(dir, 'db.sqlite');
  let raw;
  let store;
  try {
    raw = new DatabaseSync(path);
    raw.exec(readFileSync(new URL('../migrations/001_transfers.sql', import.meta.url), 'utf8'));
    raw.exec('PRAGMA user_version = 1');
    raw.prepare('INSERT INTO transfers (network, hash, identity_json, status, settlement_json, revision) VALUES (?, ?, ?, ?, ?, ?)')
      .run('TESTNET', transfer().hash, JSON.stringify(transfer()), 'confirmed', JSON.stringify(evidence().settlement), 3);
    raw.close(); raw = undefined;
    store = openStore(path);
    assert.equal(store.get(transfer().hash).revision, 3);
    assert.equal(store.register(transfer()).record.status, 'confirmed');
    assert.deepEqual(store.get(transfer().hash).settlement, evidence().settlement);
    store.close(); store = undefined;
    raw = new DatabaseSync(path);
    assert.equal(raw.prepare('PRAGMA user_version').get().user_version, 2);
    raw.exec('PRAGMA user_version = 3');
    raw.close(); raw = undefined;
    assert.throws(() => openStore(path), /newer/);
  } finally { store?.close(); raw?.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('registration rejects invalid identities, imprecise amounts and client status/secrets', t => {
  const store = setup(t);
  for (const patch of [{ amount: 1 }, { amount: '0' }, { amount: '00000000001' }, { amount: '0.00000001' }, { amount: '1e3' },
    { amount: '90000000000.1' }, { amount: '90000000001' },
    { network: 'PUBLIC' }, { asset: 'USDC' }, { status: 'confirmed' }, { signedXdr: 'secret' },
    { submittedAt: '2026-02-30T00:00:00.000Z' }, { hash: '../anything' }, { sender: 'G' },
    { sender: [transfer().sender] }, { recipient: [transfer().recipient] },
    { sender: `G${'A'.repeat(55)}` }, { contractId: undefined }]) {
    assert.throws(() => store.register({ ...transfer(), ...patch }), { code: 'INVALID_TRANSFER' });
  }
  const atCap = store.register({ ...transfer(), hash: '0'.repeat(64), amount: '90000000000' });
  assert.equal(atCap.record.amount, '90000000000');
});

test('unknown, unavailable, malformed and unverified evidence leave transfers pending', async t => {
  const store = setup(t);
  const scenarios = [
    [async () => null, 'unknown'],
    [async () => { throw new Error('network secret'); }, 'unavailable'],
    [async () => ({ ...evidence(), paymentVerified: false }), 'unverified_payment'],
    [async () => ({ settlement: { ...evidence().settlement, hash: 'b'.repeat(64) } }), 'invalid_evidence'],
    [async () => ({ settlement: { ...evidence().settlement, ledger: 0 } }), 'invalid_evidence'],
  ];
  for (const [lookup, outcome] of scenarios) {
    const result = await createReconciler(store, lookup)(transfer().hash);
    assert.equal(result.outcome, outcome); assert.equal(result.record.status, 'pending');
  }
});

test('only verified successful payments confirm; explicit failures persist and can be corrected', async t => {
  const store = setup(t);
  const hash = transfer().hash;
  assert.equal((await createReconciler(store, async () => evidence(false))(hash)).record.status, 'failed');
  assert.equal((await createReconciler(store, async () => evidence())(hash)).record.status, 'confirmed');
  assert.equal(store.register(transfer()).record.status, 'confirmed');
  assert.equal((await createReconciler(store, async () => evidence(false))(hash)).record.status, 'confirmed');
});

test('late failures cannot overwrite confirmation across reconcilers', async t => {
  const store = setup(t); let resolveLookup;
  const late = createReconciler(store, () => new Promise(resolve => { resolveLookup = resolve; }));
  const pending = late(transfer().hash);
  await Promise.resolve();
  await createReconciler(store, async () => evidence())(transfer().hash);
  resolveLookup(evidence(false));
  assert.equal((await pending).record.status, 'confirmed');
});

test('two database connections enforce duplicate identity and revision protection', t => {
  const dir = mkdtempSync(join(tmpdir(), 'jisr-concurrency-'));
  const path = join(dir, 'db.sqlite');
  const first = openStore(path); const second = openStore(path);
  t.after(() => { first.close(); second.close(); rmSync(dir, { recursive: true, force: true }); });
  first.register(transfer());
  assert.equal(second.register(transfer()).created, false);
  assert.throws(() => second.register({ ...transfer(), recipient: sender }), { code: 'TRANSFER_CONFLICT' });
  first.settle(transfer().hash, 0, evidence().settlement);
  assert.equal(second.settle(transfer().hash, 0, evidence(false).settlement).status, 'confirmed');
});

test('duplicate reconciliation requests share one lookup and timeouts stay pending', async t => {
  const store = setup(t); let calls = 0;
  const reconcile = createReconciler(store, async () => { calls++; return null; });
  await Promise.all([reconcile(transfer().hash), reconcile(transfer().hash)]);
  assert.equal(calls, 1);
  const timed = await createReconciler(store, () => new Promise(() => {}), { timeoutMs: 10 })(transfer().hash);
  assert.equal(timed.outcome, 'unavailable'); assert.equal(timed.record.status, 'pending');
});

test('HTTP auth, health, registration, errors and reconciliation contract', async t => {
  const store = openStore(':memory:'); const token = 't'.repeat(64);
  const api = createApi({ store, token });
  api.listen(0, '127.0.0.1'); await once(api, 'listening');
  t.after(async () => { api.closeAllConnections(); await new Promise(resolve => api.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${api.address().port}`;
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(`${base}/v1/transfers/${transfer().hash}`)).status, 401);
  assert.equal((await fetch(`${base}/v1/transfers`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(transfer()) })).status, 401);
  let response = await fetch(`${base}/v1/transfers`, { method: 'POST', headers, body: JSON.stringify(transfer()) });
  assert.equal(response.status, 201); assert.equal((await response.json()).record.status, 'pending');
  response = await fetch(`${base}/v1/transfers`, { method: 'POST', headers, body: JSON.stringify(transfer()) });
  assert.equal(response.status, 200);
  response = await fetch(`${base}/v1/transfers`, { method: 'POST', headers, body: JSON.stringify({ ...transfer(), amount: '2' }) });
  assert.equal(response.status, 409);
  response = await fetch(`${base}/v1/transfers`, { method: 'POST', headers, body: '{' });
  assert.equal(response.status, 400);
  response = await fetch(`${base}/v1/transfers`, { method: 'POST', headers, body: 'x'.repeat(17_000) });
  assert.equal(response.status, 413);
  response = await fetch(`${base}/v1/transfers`, { method: 'POST', headers: { authorization: headers.authorization, 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(response.status, 415);
  response = await fetch(`${base}/v1/transfers/${transfer().hash}/reconcile`, { method: 'POST', headers });
  assert.equal(response.status, 503); assert.equal((await response.json()).error.code, 'ADAPTER_UNAVAILABLE');
  response = await fetch(`${base}/v1/transfers/${transfer().hash}`, { headers });
  assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  response = await fetch(`${base}/v1/transfers/${'b'.repeat(64)}`, { headers }); assert.equal(response.status, 404);
});
