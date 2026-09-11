import { createServer } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import { ApiError } from './errors.js';
import { isHash } from './validation.js';
import { createReconciler } from './reconcile.js';

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

export function createApi({ store, token, lookup, timeoutMs }) {
  if (typeof token !== 'string' || token.length < 32 || /\s/.test(token)) {
    throw new Error('SERVICE_TOKEN must have at least 32 non-whitespace characters.');
  }
  const expected = digest(`Bearer ${token}`);
  const reconcile = createReconciler(store, lookup, { timeoutMs });
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/healthz') {
        store.ping(); return send(res, 200, { status: 'ok', network: 'TESTNET' });
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
