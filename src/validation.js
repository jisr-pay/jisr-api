import { ApiError } from './errors.js';
import { StrKey } from '@stellar/stellar-sdk';
import { parseAmountToStroops } from '@workspace/jisr-sdk/amount';

export const identityFields = ['hash', 'network', 'asset', 'sender', 'recipient', 'amount', 'contractId', 'submittedAt'];
const invalid = () => { throw new ApiError(400, 'INVALID_TRANSFER', 'Invalid Testnet transfer registration.'); };
export const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// Checksummed transport identities remain unverified payment claims until
// trusted network evidence establishes the registered payment.
// Keep the strict API grammar; delegate exact arithmetic and bounds to the SDK.
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
  try { parseAmountToStroops(input.amount); } catch { invalid(); }
  return Object.fromEntries(identityFields.map(key => [key, input[key]]));
}
