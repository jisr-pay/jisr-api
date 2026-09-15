import { ApiError } from './errors.js';

// Bound memory and trust the socket peer only; proxy headers are client input.
export function createRequestLimit({ now = Date.now, limit = 120, maxPeers = 10000 } = {}) {
  const peers = new Map();
  return peer => {
    const time = now();
    for (const [key, value] of peers) if (value.until <= time) peers.delete(key);
    let entry = peers.get(peer);
    if (!entry) {
      if (peers.size >= maxPeers) throw new ApiError(429, 'RATE_LIMITED', 'Try again later.');
      entry = { count: 0, until: time + 60_000 };
      peers.set(peer, entry);
    }
    if (++entry.count > limit) throw new ApiError(429, 'RATE_LIMITED', 'Try again later.');
  };
}
