import { ApiError } from './errors.js';

export const identityFields = ['hash', 'network', 'asset', 'sender', 'recipient', 'amount', 'contractId', 'submittedAt'];
const invalid = () => { throw new ApiError(400, 'INVALID_TRANSFER', 'Invalid Testnet transfer registration.'); };
export const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

// Transport validation only. SDK StrKey checksum validation and network evidence
// remain required before addresses or payment details can be trusted.
export function registration(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !identityFields.includes(key)) ||
      !isHash(input.hash) || input.network !== 'TESTNET' || input.asset !== 'XLM' ||
      typeof input.sender !== 'string' || !/^G[A-Z2-7]{55}$/.test(input.sender) ||
      typeof input.recipient !== 'string' || !/^G[A-Z2-7]{55}$/.test(input.recipient) ||
      typeof input.contractId !== 'string' || !/^C[A-Z2-7]{55}$/.test(input.contractId) ||
      typeof input.amount !== 'string' || !/^(0|[1-9]\d{0,11})(\.\d{1,7})?$/.test(input.amount) ||
      typeof input.submittedAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.submittedAt) ||
      !Number.isFinite(Date.parse(input.submittedAt)) ||
      new Date(input.submittedAt).toISOString() !== input.submittedAt ||
      Date.parse(input.submittedAt) > Date.now() + 300_000) invalid();
  const [whole, fractional = ''] = input.amount.split('.');
  const stroops = BigInt(whole) * 10_000_000n + BigInt(fractional.padEnd(7, '0'));
  if (stroops <= 0n || stroops > 9_223_372_036_854_775_807n) invalid();
  return Object.fromEntries(identityFields.map(key => [key, input[key]]));
}
