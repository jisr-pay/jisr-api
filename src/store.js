import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { ApiError } from './errors.js';
import { registration } from './validation.js';

export function openStore(path) {
  const db = new DatabaseSync(path, { timeout: 5000 });
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; BEGIN IMMEDIATE;');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > 1) throw new Error('Database schema is newer than this application.');
    if (version === 0) {
      db.exec(readFileSync(new URL('../migrations/001_transfers.sql', import.meta.url), 'utf8'));
      db.exec('PRAGMA user_version = 1;');
    }
    db.exec('COMMIT;');
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK;');
    db.close();
    throw error;
  }
  const read = db.prepare('SELECT * FROM transfers WHERE network = ? AND hash = ?');
  const decode = row => row ? {
    ...JSON.parse(row.identity_json), status: row.status, revision: row.revision,
    ...(row.settlement_json ? { settlement: JSON.parse(row.settlement_json) } : {}),
  } : null;
  return {
    get(hash) { return decode(read.get('TESTNET', hash)); },
    register(input) {
      const identity = registration(input);
      const serialized = JSON.stringify(identity);
      db.exec('BEGIN IMMEDIATE;');
      try {
        const existing = read.get('TESTNET', identity.hash);
        if (existing && existing.identity_json !== serialized) {
          throw new ApiError(409, 'TRANSFER_CONFLICT', 'Transfer identity is immutable.');
        }
        if (!existing) db.prepare('INSERT INTO transfers (network, hash, identity_json) VALUES (?, ?, ?)')
          .run('TESTNET', identity.hash, serialized);
        const record = decode(read.get('TESTNET', identity.hash));
        db.exec('COMMIT;');
        return { created: !existing, record };
      } catch (error) {
        db.exec('ROLLBACK;');
        throw error;
      }
    },
    // Compare-and-set prevents a delayed lookup from overwriting newer evidence.
    settle(hash, revision, settlement) {
      db.prepare(`UPDATE transfers SET status = ?, settlement_json = ?, revision = revision + 1
        WHERE network = 'TESTNET' AND hash = ? AND revision = ? AND status != 'confirmed'`)
        .run(settlement.successful ? 'confirmed' : 'failed', JSON.stringify(settlement), hash, revision);
      return decode(read.get('TESTNET', hash));
    },
    ping() { db.prepare('SELECT 1').get(); },
    close() { db.close(); },
  };
}
