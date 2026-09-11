import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { openStore } from './store.js';
import { createApi } from './server.js';

const rawPort = process.env.PORT ?? '3001';
if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw new Error('Invalid PORT.');
const databasePath = resolve(process.env.DATABASE_PATH ?? './data/transfers.sqlite');
mkdirSync(dirname(databasePath), { recursive: true });
const store = openStore(databasePath);
let server;
try { server = createApi({ store, token: process.env.SERVICE_TOKEN }); }
catch (error) { store.close(); throw error; }
server.on('error', error => {
  console.error(`Server failed: ${error.code ?? 'UNKNOWN'}`);
  store.close(); process.exitCode = 1;
});
server.listen(Number(rawPort), process.env.HOST ?? '127.0.0.1', () => {
  console.log(`Jisr Testnet internal API listening on port ${rawPort}; live settlement adapter not configured.`);
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
