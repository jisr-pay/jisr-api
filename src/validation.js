import { ApiError } from './errors.js';
import { StrKey } from '@stellar/stellar-sdk';

export const identityFields = ['hash', 'network', 'asset', 'sender', 'recipient', 'amount', 'contractId', 'submittedAt'];
const invalid = () => { throw new ApiError(400, 'INVALID_TRANSFER', 'Invalid Testnet transfer registration.'); };
export const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// Checksummed transport identities remain unverified payment claims until
// trusted network evidence establishes the registered payment.
// The stroops upper bound mirrors the frozen SDK parseAmountToStroops cap
// (90,000,000,000 XLM). When the SDK ships compiled exports, swap this count
// for a direct parseAmountToStroops call behind this strict transport grammar.
export function registration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !identityFields.includes(key)) ||
      !isHash(input.hash) || input.network !== 'TESTNET' || input.asset !== 'XLM' ||
      typeof input.sender !== 'string' || !StrKey.isValidEd25519PublicKey(input.sender) ||
      typeof input.recipient !== 'string' || !StrKey.isValidEd25519PublicKey(input.recipient) ||
      (input.contractId !== null && (typeof input.contractId !== 'string' || !StrKey.isValidContract(input.contractId))) ||
      typeof input.amount !== 'string' || !/^(0|[1-9]\d{0,11})(\.\d{1,7})?$/.test(input.amount) ||
      typeof input.submittedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.submittedAt) ||
      !Number.isFinite(Date.parse(input.submittedAt)) ||
      new Date(input.submittedAt).toISOString() !== input.submittedAt ||
      Date.parse(input.submittedAt) > Date.now() + 300_000) invalid();
  const [whole, fractional = ''] = input.amount.split('.');
  const stroops = BigInt(whole) * 10_000_000n + BigInt(fractional.padEnd(7, '0'));
  if (stroops <= 0n || stroops > 900_000_000_000_000_000n) invalid();
  return Object.fromEntries(identityFields.map(key => [key, input[key]]));
}
