import { createHash, randomBytes } from 'node:crypto';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { ApiError } from './errors.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const unauthorized = () => new ApiError(401, 'INVALID_PROOF', 'Invalid or expired wallet proof.');
const exactKeys = (input, keys) => input && typeof input === 'object' && !Array.isArray(input) &&
  Object.keys(input).length === keys.length && keys.every(key => Object.hasOwn(input, key));

// SEP-53 verifies key possession, not Stellar account signer thresholds (SEP-10).
export function verifyMessage(address, message, signature) {
  if (typeof signature !== 'string' || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) return false;
  const bytes = Buffer.from(signature, 'base64');
  if (bytes.toString('base64') !== signature) return false;
  try {
    const digest = createHash('sha256').update('Stellar Signed Message:\n').update(message, 'utf8').digest();
    return Keypair.fromPublicKey(address).verify(digest, bytes);
  } catch { return false; }
}

export function createWalletAuth({ store, audience, now = Date.now }) {
  const origin = new URL(audience);
  if (origin.origin !== audience || origin.username || origin.password ||
      (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(origin.hostname)))) {
    throw new Error('WALLET_AUTH_ORIGIN must be an HTTPS origin (HTTP loopback allowed for development).');
  }
  const sessionHash = token => hash(`${audience}\n${token}`);
  return {
    challenge(input) {
      if (!exactKeys(input, ['address']) || typeof input.address !== 'string' || !StrKey.isValidEd25519PublicKey(input.address)) {
        throw new ApiError(400, 'INVALID_ADDRESS', 'A checksummed Stellar public address is required.');
      }
      const issuedAt = now();
      const challenge = { id: randomBytes(32).toString('hex'), address: input.address, expiresAt: issuedAt + 300_000 };
      challenge.message = ['Jisr Pay wallet login v1', `Origin: ${audience}`, 'Network: TESTNET',
        `Address: ${challenge.address}`, `Nonce: ${challenge.id}`, `Issued: ${new Date(issuedAt).toISOString()}`,
        `Expires: ${new Date(challenge.expiresAt).toISOString()}`, 'Purpose: access your Jisr transfer records; no transaction is authorized.'].join('\n');
      store.createChallenge(challenge, issuedAt);
      return challenge;
    },
    verify(input) {
      if (!exactKeys(input, ['id', 'signature']) || typeof input.id !== 'string' || !/^[a-f0-9]{64}$/.test(input.id)) throw unauthorized();
      const row = store.challenge(input.id);
      if (!row || row.expires_at <= now() || !row.message.includes(`\nOrigin: ${audience}\n`) ||
          !verifyMessage(row.address, row.message, input.signature)) throw unauthorized();
      const token = randomBytes(32).toString('hex');
      const timestamp = now();
      const expiresAt = timestamp + 900_000;
      const address = store.exchangeChallenge(input.id, sessionHash(token), expiresAt, timestamp);
      return { token, address, expiresAt };
    },
    authenticate(authorization) {
      const token = /^Bearer ([a-f0-9]{64})$/.exec(authorization ?? '')?.[1];
      const address = token && store.session(sessionHash(token), now());
      if (!address) throw new ApiError(401, 'UNAUTHORIZED', 'Wallet session required.');
      return address;
    },
    logout(authorization) {
      this.authenticate(authorization);
      store.revokeSession(sessionHash(authorization.slice(7)));
    },
  };
}
