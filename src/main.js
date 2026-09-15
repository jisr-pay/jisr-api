import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openStore } from './store.js';
import { createApi } from './server.js';
import { createHorizonLookup } from './evidence.js';

const rawPort = process.env.PORT ?? '3001';
if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw new Error('Invalid PORT.');
const databasePath = resolve(process.env.DATABASE_PATH ?? './data/transfers.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });
const store = openStore(databasePath);
// Opt-in live evidence adapter. Without HORIZON_URL the executable keeps the
// original no-adapter default so it cannot report false settlement evidence.
let lookup;
let server;
try {
  lookup = process.env.HORIZON_URL ? createHorizonLookup({ horizonUrl: process.env.HORIZON_URL }) : undefined;
  server = createApi({ store, token: process.env.SERVICE_TOKEN, lookup, walletOrigin: process.env.WALLET_AUTH_ORIGIN });
}
catch (error) { store.close(); throw error; }
server.on('error', error => {
  console.error(`Server failed: ${error.code ?? 'UNKNOWN'}`);
  store.close(); process.exitCode = 1;
});
server.listen(Number(rawPort), process.env.HOST ?? '127.0.0.1', () => {
  console.log(`Jisr Testnet internal API listening on port ${rawPort}; ` +
    (lookup ? 'live Horizon evidence adapter enabled.' : 'live settlement adapter not configured.'));
});
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  server.close(() => { store.close(); });
  server.closeIdleConnections();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
