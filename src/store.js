import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { ApiError } from './errors.js';
import { registration } from './validation.js';

export function openStore(path) {
  const db = new DatabaseSync(path, { timeout: 5000 });
  try {
    db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL; BEGIN IMMEDIATE;');
    const version = db.prepare('PRAGMA user_version').get().user_version;
    if (version > 2) throw new Error('Database schema is newer than this application.');
    if (version === 0) {
      db.exec(readFileSync(new URL('../migrations/001_transfers.sql', import.meta.url), 'utf8'));
      db.exec('PRAGMA user_version = 1;');
    }
    if (version < 2) {
      db.exec(readFileSync(new URL('../migrations/002_auth.sql', import.meta.url), 'utf8'));
      db.exec('PRAGMA user_version = 2;');
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
    list(sender, after = '', limit = 50) {
      return db.prepare(`SELECT * FROM transfers WHERE network = 'TESTNET'
        AND json_extract(identity_json, '$.sender') = ? AND hash > ? ORDER BY hash LIMIT ?`)
        .all(sender, after, limit).map(decode);
    },
    createChallenge(challenge, now) {
      db.prepare('DELETE FROM auth_challenges WHERE expires_at <= ?').run(now);
      if (db.prepare('SELECT count(*) AS count FROM auth_challenges').get().count >= 10000 ||
          db.prepare('SELECT count(*) AS count FROM auth_challenges WHERE address = ?').get(challenge.address).count >= 5) {
        throw new ApiError(429, 'RATE_LIMITED', 'Too many outstanding challenges. Try again later.');
      }
      db.prepare('INSERT INTO auth_challenges (id, address, message, expires_at) VALUES (?, ?, ?, ?)')
        .run(challenge.id, challenge.address, challenge.message, challenge.expiresAt);
    },
    challenge(id) { return db.prepare('SELECT * FROM auth_challenges WHERE id = ?').get(id); },
    // Consumption and session creation are atomic across processes/restarts.
    exchangeChallenge(id, tokenHash, expiresAt, now) {
      db.exec('BEGIN IMMEDIATE;');
      try {
        const row = db.prepare('DELETE FROM auth_challenges WHERE id = ? AND expires_at > ? RETURNING address').get(id, now);
        if (!row) throw new ApiError(401, 'INVALID_PROOF', 'Challenge expired or already used.');
        db.prepare('DELETE FROM auth_sessions WHERE expires_at <= ?').run(now);
        db.prepare('INSERT INTO auth_sessions (token_hash, address, expires_at) VALUES (?, ?, ?)')
          .run(tokenHash, row.address, expiresAt);
        db.exec('COMMIT;');
        return row.address;
      } catch (error) { db.exec('ROLLBACK;'); throw error; }
    },
    session(tokenHash, now) {
      return db.prepare('SELECT address FROM auth_sessions WHERE token_hash = ? AND expires_at > ?').get(tokenHash, now)?.address;
    },
    revokeSession(tokenHash) { db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(tokenHash); },
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
