// The longest life of an access token (design doc 2.2 Security). After that, a suspended user has no
// token left that works: refresh and login are refused by the Auth & User Service.
export const BLOCK_MS = 15 * 60 * 1000;

// Keeps the IDs of suspended users in memory (design doc 3.3 and Diagram 11). Each ID stays blocked for
// 15 minutes. The last changedAt of each user is kept, so an older message that arrives late is ignored.
// One small entry per user that was suspended or activated while the gateway runs.
export class BlockListStore {
  #users = new Map();

  constructor({ blockMs = BLOCK_MS, now = () => Date.now() } = {}) {
    this.blockMs = blockMs;
    this.now = now;
  }

  // changedAt: milliseconds since 1970. Returns false when the message is older than the last change.
  add(userId, changedAt) {
    return this.#apply(userId, changedAt, this.now() + this.blockMs);
  }

  remove(userId, changedAt) {
    return this.#apply(userId, changedAt, null);
  }

  isBlocked(userId) {
    const entry = this.#users.get(Number(userId));
    return entry?.blockedUntil != null && this.now() < entry.blockedUntil;
  }

  // The same changedAt again (a message handled twice) gives the same result.
  #apply(userId, changedAt, blockedUntil) {
    const last = this.#users.get(Number(userId));
    if (last && changedAt < last.changedAt) return false;
    this.#users.set(Number(userId), { changedAt, blockedUntil });
    return true;
  }
}
