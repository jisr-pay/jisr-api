import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.js';
import { isHash, registration } from './validation.js';
import { createReconciler, lookupWithTimeout, validSettlement } from './reconcile.js';
import { createWalletAuth } from './auth.js';
import { createRequestLimit } from './request-limit.js';

const digest = token => createHash('sha256').update(token).digest();
const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store',
    'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(body));
};
async function jsonBody(req) {
  if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new ApiError(415, 'JSON_REQUIRED', 'Use application/json.');
  }
  if (Number(req.headers['content-length']) > 16_384) {
    throw new ApiError(413, 'BODY_TOO_LARGE', 'Request body exceeds 16 KiB.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 16_384) throw new ApiError(413, 'BODY_TOO_LARGE', 'Request body exceeds 16 KiB.');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError(400, 'INVALID_JSON', 'Invalid JSON body.'); }
}

export function createApi({ store, token, lookup, timeoutMs, walletOrigin, now }) {
  if (typeof token !== 'string' || token.length < 32 || /\s/.test(token)) {
    throw new Error('SERVICE_TOKEN must have at least 32 non-whitespace characters.');
  }
  const expected = digest(`Bearer ${token}`);
  const reconcile = createReconciler(store, lookup, { timeoutMs });
  const walletAuth = walletOrigin ? createWalletAuth({ store, audience: walletOrigin, now }) : null;
  const walletLimit = createRequestLimit({ now });
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/healthz') {
        store.ping(); return send(res, 200, { status: 'ok', network: 'TESTNET' });
      }
      if (url.pathname.startsWith('/v1/wallet/')) {
        if (!walletAuth) throw new ApiError(404, 'NOT_FOUND', 'Endpoint not found.');
        walletLimit(req.socket.remoteAddress);
        // Same-origin deployment; a configured origin is never inferred from Host.
        if (req.headers.origin && req.headers.origin !== walletOrigin) {
          throw new ApiError(403, 'ORIGIN_DENIED', 'Origin is not allowed.');
        }
        if (req.method === 'POST' && url.pathname === '/v1/wallet/challenges') {
          return send(res, 201, walletAuth.challenge(await jsonBody(req)));
        }
        if (req.method === 'POST' && url.pathname === '/v1/wallet/sessions') {
          return send(res, 201, walletAuth.verify(await jsonBody(req)));
        }
        const address = walletAuth.authenticate(req.headers.authorization);
        if (req.method === 'DELETE' && url.pathname === '/v1/wallet/session') {
          walletAuth.logout(req.headers.authorization);
          return send(res, 200, { revoked: true });
        }
        if (url.pathname === '/v1/wallet/transfers') {
          if (req.method === 'POST') {
            const input = await jsonBody(req);
            if (input?.sender !== address) throw new ApiError(403, 'SENDER_MISMATCH', 'Sender must match the wallet session.');
            const identity = registration(input);
            const existing = store.get(identity.hash);
            if (existing && existing.sender !== address) throw new ApiError(404, 'NOT_FOUND', 'Transfer not found.');
            if (!existing) {
              if (!lookup) throw new ApiError(503, 'ADAPTER_UNAVAILABLE', 'Live settlement adapter is not configured.');
              let evidence;
              try { evidence = await lookupWithTimeout(lookup, identity, timeoutMs); }
              catch { throw new ApiError(503, 'EVIDENCE_UNAVAILABLE', 'Keep local history and retry registration later.'); }
              if (!evidence || !validSettlement(evidence.settlement, identity.hash)) {
                throw new ApiError(503, 'EVIDENCE_UNAVAILABLE', 'Keep local history and retry registration later.');
              }
              if (evidence.settlement.successful ? evidence.paymentVerified !== true : evidence.senderVerified !== true) {
                throw new ApiError(422, 'UNVERIFIED_PAYMENT', 'Network evidence does not establish this payment claim.');
              }
            }
            const { created, record } = store.register(input);
            return send(res, created ? 201 : 200, { record });
          }
          if (req.method === 'GET') {
            const after = url.searchParams.get('after') ?? '';
            if (after && !isHash(after)) throw new ApiError(400, 'INVALID_HASH', 'Invalid cursor.');
            const records = store.list(address, after, 51);
            const hasMore = records.length > 50;
            records.length = Math.min(records.length, 50);
            return send(res, 200, { records, nextCursor: hasMore ? records.at(-1).hash : null });
          }
        }
        const owned = /^\/v1\/wallet\/transfers\/([^/]+)(\/reconcile)?$/.exec(url.pathname);
        if (owned) {
          if (!isHash(owned[1])) throw new ApiError(400, 'INVALID_HASH', 'Invalid transaction hash.');
          const record = store.get(owned[1]);
          if (!record || record.sender !== address) throw new ApiError(404, 'NOT_FOUND', 'Transfer not found.');
          if (req.method === 'GET' && !owned[2]) return send(res, 200, { record });
          if (req.method === 'POST' && owned[2]) return send(res, 200, await reconcile(owned[1]));
        }
        throw new ApiError(404, 'NOT_FOUND', 'Endpoint not found.');
      }
      if (!timingSafeEqual(digest(req.headers.authorization ?? ''), expected)) {
        res.setHeader('www-authenticate', 'Bearer');
        throw new ApiError(401, 'UNAUTHORIZED', 'Service authentication required.');
      }
      if (req.method === 'POST' && url.pathname === '/v1/transfers') {
        const { created, record } = store.register(await jsonBody(req));
        return send(res, created ? 201 : 200, { record });
      }
      const match = /^\/v1\/transfers\/([^/]+)(\/reconcile)?$/.exec(url.pathname);
      if (match) {
        if (!isHash(match[1])) throw new ApiError(400, 'INVALID_HASH', 'Invalid transaction hash.');
        if (req.method === 'GET' && !match[2]) {
          const record = store.get(match[1]);
          if (!record) throw new ApiError(404, 'NOT_FOUND', 'Transfer not found.');
          return send(res, 200, { record });
        }
        if (req.method === 'POST' && match[2]) return send(res, 200, await reconcile(match[1]));
      }
      throw new ApiError(404, 'NOT_FOUND', 'Endpoint not found.');
    } catch (error) {
      if (res.destroyed) return;
      send(res, error instanceof ApiError ? error.status : 500,
        { error: { code: error instanceof ApiError ? error.code : 'INTERNAL_ERROR',
          message: error instanceof ApiError ? error.message : 'Request could not be completed.' } });
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  server.maxHeadersCount = 50;
  return server;
}
