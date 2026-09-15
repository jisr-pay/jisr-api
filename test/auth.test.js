import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Keypair } from '@stellar/stellar-sdk';
import { createWalletAuth, verifyMessage } from '../src/auth.js';
import { openStore } from '../src/store.js';
import { createApi } from '../src/server.js';
import { createRequestLimit } from '../src/request-limit.js';

const audience = 'https://pay.example';
const alice = Keypair.random();
const bob = Keypair.random();
const sign = (key, message) => key.sign(createHash('sha256').update('Stellar Signed Message:\n').update(message).digest()).toString('base64');
const proof = (challenge, key = alice) => ({ id: challenge.id, signature: sign(key, challenge.message) });
const transfer = (key = alice, hash = 'a'.repeat(64)) => ({ hash, network: 'TESTNET', asset: 'XLM',
  sender: key.publicKey(), recipient: bob.publicKey(), amount: '0.0000001', contractId: null,
  submittedAt: '2026-01-01T00:00:00.000Z' });

test('SEP-53 published interoperability vector verifies; raw or changed messages do not', () => {
  // Public test vector from stellar-protocol/ecosystem/sep-0053.md.
  const address = 'GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L';
  const signature = 'fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==';
  assert.equal(verifyMessage(address, 'Hello, World!', signature), true);
  assert.equal(verifyMessage(address, 'Hello, World?', signature), false);
  assert.equal(verifyMessage(address, 'Hello, World!', signature + '\n'), false);
  assert.equal(verifyMessage(alice.publicKey(), 'test', alice.sign(Buffer.from('test')).toString('base64')), false);
});

test('proof is bound to address, origin, network and nonce; replay fails', t => {
  const store = openStore(':memory:'); t.after(() => store.close());
  const auth = createWalletAuth({ store, audience });
  const challenge = auth.challenge({ address: alice.publicKey() });
  assert.throws(() => auth.verify(proof(challenge, bob)), { code: 'INVALID_PROOF' });
  for (const message of [challenge.message.replace('TESTNET', 'PUBLIC'), challenge.message.replace(audience, 'https://evil.example'),
    challenge.message.replace(challenge.id, 'b'.repeat(64))]) {
    assert.throws(() => auth.verify({ id: challenge.id, signature: sign(alice, message) }), { code: 'INVALID_PROOF' });
  }
  const other = createWalletAuth({ store, audience: 'https://other.example' });
  assert.throws(() => other.verify(proof(challenge)), { code: 'INVALID_PROOF' });
  const session = auth.verify(proof(challenge));
  assert.equal(auth.authenticate(`Bearer ${session.token}`), alice.publicKey());
  assert.throws(() => other.authenticate(`Bearer ${session.token}`), { code: 'UNAUTHORIZED' });
  assert.throws(() => auth.verify(proof(challenge)), { code: 'INVALID_PROOF' });
  auth.logout(`Bearer ${session.token}`);
  assert.throws(() => auth.authenticate(`Bearer ${session.token}`), { code: 'UNAUTHORIZED' });
});

test('challenge/session expiry, input validation and challenge limits', t => {
  const store = openStore(':memory:'); t.after(() => store.close());
  let time = Date.now();
  const auth = createWalletAuth({ store, audience, now: () => time });
  assert.throws(() => auth.challenge({ address: `G${'A'.repeat(55)}` }), { code: 'INVALID_ADDRESS' });
  assert.throws(() => auth.challenge({ address: alice.publicKey(), network: 'PUBLIC' }), { code: 'INVALID_ADDRESS' });
  const expired = auth.challenge({ address: alice.publicKey() });
  time += 300_000;
  assert.throws(() => auth.verify(proof(expired)), { code: 'INVALID_PROOF' });
  const session = auth.verify(proof(auth.challenge({ address: alice.publicKey() })));
  time += 900_000;
  assert.throws(() => auth.authenticate(`Bearer ${session.token}`), { code: 'UNAUTHORIZED' });
  for (let i = 0; i < 5; i++) auth.challenge({ address: alice.publicKey() });
  assert.throws(() => auth.challenge({ address: alice.publicKey() }), { code: 'RATE_LIMITED' });
  time += 300_000;
  assert.ok(auth.challenge({ address: alice.publicKey() }).id);
});

test('consumed challenge cannot replay across database connections or restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jisr-auth-'));
  const path = join(dir, 'db.sqlite');
  let first = openStore(path); let second = openStore(path);
  try {
    let auth = createWalletAuth({ store: first, audience });
    const challenge = auth.challenge({ address: alice.publicKey() });
    const session = auth.verify(proof(challenge));
    assert.throws(() => createWalletAuth({ store: second, audience }).verify(proof(challenge)), { code: 'INVALID_PROOF' });
    first.close(); first = openStore(path);
    auth = createWalletAuth({ store: first, audience });
    assert.equal(auth.authenticate(`Bearer ${session.token}`), alice.publicKey());
    assert.throws(() => auth.verify(proof(challenge)), { code: 'INVALID_PROOF' });
  } finally { first.close(); second.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('wallet HTTP login, sender isolation, pagination, reconciliation and logout', async t => {
  const store = openStore(':memory:');
  const token = 't'.repeat(64);
  let evidence = null;
  const server = createApi({ store, token, walletOrigin: audience, lookup: async () => evidence });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, method = 'GET', body, bearer, origin = audience) => fetch(base + path, {
    method, headers: { 'content-type': 'application/json', origin, ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.equal((await request('/v1/wallet/challenges', 'POST', { address: alice.publicKey() }, null, 'https://evil.example')).status, 403);
  const challenge = await (await request('/v1/wallet/challenges', 'POST', { address: alice.publicKey() })).json();
  const response = await request('/v1/wallet/sessions', 'POST', proof(challenge));
  assert.equal(response.status, 201);
  const session = await response.json();
  assert.equal((await request('/v1/wallet/transfers')).status, 401);
  assert.equal((await request('/v1/transfers', 'POST', transfer(), session.token)).status, 401);
  assert.equal((await request('/v1/wallet/transfers', 'POST', transfer(), token)).status, 401);
  assert.equal((await request('/v1/wallet/transfers', 'POST', transfer(bob), session.token)).status, 403);
  assert.equal((await request('/v1/wallet/transfers', 'POST', transfer(), session.token)).status, 503);
  assert.equal(store.get(transfer().hash), null);
  evidence = { paymentVerified: false, settlement: { hash: transfer().hash, successful: true,
    ledger: 1, createdAt: '2026-01-01T00:00:00Z', feeCharged: '0.0000100 XLM' } };
  assert.equal((await request('/v1/wallet/transfers', 'POST', transfer(), session.token)).status, 422);
  assert.equal(store.get(transfer().hash), null);
  evidence.settlement.successful = false;
  assert.equal((await request('/v1/wallet/transfers', 'POST', transfer(), session.token)).status, 422);
  assert.equal(store.get(transfer().hash), null);
  evidence.settlement.successful = true;
  evidence.paymentVerified = true;
  assert.equal((await request('/v1/wallet/transfers', 'POST', transfer(), session.token)).status, 201);
  evidence = null;
  assert.equal((await request('/v1/wallet/transfers', 'POST', transfer(), session.token)).status, 200);
  store.register(transfer(bob, 'b'.repeat(64)));
  assert.equal((await request(`/v1/wallet/transfers/${'b'.repeat(64)}`, 'GET', undefined, session.token)).status, 404);
  assert.equal((await request(`/v1/wallet/transfers/${'b'.repeat(64)}/reconcile`, 'POST', undefined, session.token)).status, 404);
  const result = await (await request(`/v1/wallet/transfers/${'a'.repeat(64)}/reconcile`, 'POST', undefined, session.token)).json();
  assert.equal(result.outcome, 'unknown');
  for (let i = 0; i < 51; i++) store.register(transfer(alice, i.toString(16).padStart(64, '0')));
  const page = await (await request('/v1/wallet/transfers', 'GET', undefined, session.token)).json();
  assert.equal(page.records.length, 50); assert.ok(page.records.every(r => r.sender === alice.publicKey()));
  const next = await (await request(`/v1/wallet/transfers?after=${page.nextCursor}`, 'GET', undefined, session.token)).json();
  assert.equal(next.records.length, 2); assert.equal(next.nextCursor, null);
  assert.equal((await request('/v1/wallet/session', 'DELETE', undefined, session.token)).status, 200);
  assert.equal((await request('/v1/wallet/transfers', 'GET', undefined, session.token)).status, 401);
});

test('wallet registration can track its own explicit failure but rejects another transaction source', async t => {
  const store = openStore(':memory:');
  let senderVerified = false;
  const server = createApi({ store, token: 't'.repeat(64), walletOrigin: audience, lookup: async () => ({ senderVerified,
    paymentVerified: false, settlement: { hash: transfer().hash, successful: false, ledger: 1,
      createdAt: '2026-01-01T00:00:00Z', feeCharged: '0.0000100 XLM' } }) });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); });
  const auth = createWalletAuth({ store, audience });
  const session = auth.verify(proof(auth.challenge({ address: alice.publicKey() })));
  const request = () => fetch(`http://127.0.0.1:${server.address().port}/v1/wallet/transfers`, {
    method: 'POST', headers: { authorization: `Bearer ${session.token}`, 'content-type': 'application/json' }, body: JSON.stringify(transfer()),
  });
  assert.equal((await request()).status, 422);
  senderVerified = true;
  assert.equal((await request()).status, 201);
  assert.equal(store.get(transfer().hash).status, 'pending');
});

test('request limiter bounds peers and resets windows', () => {
  let time = 0;
  const limit = createRequestLimit({ now: () => time, limit: 2, maxPeers: 1 });
  limit('one'); limit('one');
  assert.throws(() => limit('one'), { code: 'RATE_LIMITED' });
  assert.throws(() => limit('two'), { code: 'RATE_LIMITED' });
  time = 60000; limit('two');
});
