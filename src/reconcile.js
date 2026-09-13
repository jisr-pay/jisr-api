import { ApiError } from './errors.js';

export async function lookupWithTimeout(lookup, record, timeoutMs = 10_000) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => lookup(record, { signal: controller.signal })),
      new Promise((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(new Error('Lookup timeout'));
      }, timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

export function validSettlement(s, hash) {
  return !!s && s.hash === hash && typeof s.successful === 'boolean' &&
    Number.isSafeInteger(s.ledger) && s.ledger > 0 &&
    typeof s.createdAt === 'string' && Number.isFinite(Date.parse(s.createdAt)) &&
    Date.parse(s.createdAt) <= Date.now() + 300_000 &&
    typeof s.feeCharged === 'string' && /^\d+\.\d{7} XLM$/.test(s.feeCharged);
}

/**
 * lookup(record, { signal }) is a trusted server adapter, never request data.
 * Returns null for unknown; otherwise { settlement, paymentVerified }.
 * A successful transaction needs verified payment identity, not just a hash hit.
 * The SDK bridge must validate network, contract, token, sender, recipient and
 * amount from operation/event evidence before setting paymentVerified to true.
 */
export function createReconciler(store, lookup, { timeoutMs = 10_000 } = {}) {
  const inflight = new Map();
  async function run(hash) {
    const record = store.get(hash);
    if (!record) throw new ApiError(404, 'NOT_FOUND', 'Transfer not found.');
    if (record.status === 'confirmed') return { record, outcome: 'confirmed' };
    if (!lookup) throw new ApiError(503, 'ADAPTER_UNAVAILABLE', 'Live settlement adapter is not configured.');
    let evidence;
    try {
      evidence = await lookupWithTimeout(lookup, record, timeoutMs);
    } catch {
      return { record: store.get(hash), outcome: 'unavailable' };
    }
    if (evidence === null) return { record: store.get(hash), outcome: 'unknown' };
    const s = evidence?.settlement;
    if (!validSettlement(s, hash)) {
      return { record: store.get(hash), outcome: 'invalid_evidence' };
    }
    if (s.successful && evidence.paymentVerified !== true) {
      return { record: store.get(hash), outcome: 'unverified_payment' };
    }
    const settlement = { hash: s.hash, successful: s.successful, ledger: s.ledger,
      createdAt: s.createdAt, feeCharged: s.feeCharged };
    const updated = store.settle(hash, record.revision, settlement);
    return { record: updated, outcome: updated.status };
  }
  return hash => {
    if (inflight.has(hash)) return inflight.get(hash);
    const task = run(hash).finally(() => inflight.delete(hash));
    inflight.set(hash, task);
    return task;
  };
}
