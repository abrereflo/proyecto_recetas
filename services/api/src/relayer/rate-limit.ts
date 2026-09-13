/**
 * A fixed window per key, in memory.
 *
 * WHY THE RELAYER NEEDS ONE AT ALL — the argument is worked in full in
 * `relayer.ts` under "WHAT AN OPEN ENDPOINT ACTUALLY EXPOSES", and the short
 * version is this: the paymaster bounds what the PAYMASTER'S DEPOSIT pays for,
 * and it bounds nothing about the relayer's own AVAX. A `handleOps` that fails
 * validation reverts, so the EntryPoint reimburses no one and the relayer has
 * still burned the gas of a reverted transaction. Simulation catches almost all
 * of those for free, but not the ones that pass simulation and fail on
 * inclusion — a quota consumed by another operation in between, a credential
 * revoked in the same block. That residue is what this bounds.
 *
 * WHY FIXED WINDOW RATHER THAN TOKEN BUCKET. The same reason
 * `PrescriptionPaymaster._consumeQuota` gives for its own choice: a fixed window
 * is one number per key, its only weakness is a double burst across a boundary,
 * and a burst is not what this is defending against. Two implementations of the
 * same idea in one system should not disagree about what a window is.
 *
 * WHAT THIS IS NOT. It is in-memory and therefore per process: two API
 * instances behind a load balancer have two independent limits, and a restart
 * forgets everything. That is honest for a demo and a single-process pilot and
 * it is NOT a production rate limiter. Saying so here is cheaper than
 * discovering it.
 *
 * The clock is injected so the tests do not sleep.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Requests already counted in the window that is open now. */
  used: number;
  limit: number;
  /** When `used` returns to zero, in epoch seconds. */
  windowEndsAt: number;
}

export interface RateLimiterOptions {
  limit: number;
  windowSeconds: number;
  /** Epoch seconds. Injected so a test can move time without waiting. */
  now?: () => number;
}

interface Window {
  endsAt: number;
  used: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly now: () => number;

  constructor(private readonly options: RateLimiterOptions) {
    this.now = options.now ?? (() => Math.floor(Date.now() / 1000));
  }

  /**
   * Count one request against `key` and say whether it may proceed.
   *
   * A REFUSED REQUEST IS NOT COUNTED. That is deliberate and it is the opposite
   * of what the paymaster does with its quota: the paymaster spends quota on a
   * reverting operation because that operation still cost it AVAX, while a
   * request refused here costs this service nothing beyond a map lookup.
   * Counting refusals would let a client that is already over the limit extend
   * its own lockout indefinitely.
   */
  take(key: string): RateLimitDecision {
    const now = this.now();
    const existing = this.windows.get(key);
    const window: Window =
      existing === undefined || now >= existing.endsAt
        ? { endsAt: now + this.options.windowSeconds, used: 0 }
        : existing;

    if (window.used >= this.options.limit) {
      this.windows.set(key, window);

      return {
        allowed: false,
        used: window.used,
        limit: this.options.limit,
        windowEndsAt: window.endsAt,
      };
    }

    window.used += 1;
    this.windows.set(key, window);

    return {
      allowed: true,
      used: window.used,
      limit: this.options.limit,
      windowEndsAt: window.endsAt,
    };
  }

  /**
   * Whether `key` may proceed, WITHOUT counting the request against it. The
   * sender-keyed bucket in `routes/relayer.ts` bounds what one ACCOUNT SPENDS,
   * and only a submission that reaches the chain spends any; addresses are
   * public, so charging before the operation is checked lets anyone empty a
   * doctor's window with bodies the relayer refuses. Writes nothing: only
   * `take` opens a window.
   */
  peek(key: string): RateLimitDecision {
    const now = this.now();
    const window = this.windows.get(key);
    const limit = this.options.limit;

    if (window === undefined || now >= window.endsAt) {
      return { allowed: true, used: 0, limit, windowEndsAt: now + this.options.windowSeconds };
    }

    return { allowed: window.used < limit, used: window.used, limit, windowEndsAt: window.endsAt };
  }

  /**
   * Drop windows that have already closed.
   *
   * Without this the map is a slow leak keyed by whatever a caller sends —
   * remote addresses and sender addresses, both attacker-chosen. Called on
   * every `take` would be O(n) per request; called on a timer is the wrong
   * shape for a module with no I/O. So it is exposed and the route owner calls
   * it, which `routes/relayer.ts` does once per request cheaply because the
   * sweep is bounded by how many distinct keys one window can hold.
   */
  sweep(): void {
    const now = this.now();

    for (const [key, window] of this.windows) {
      if (now >= window.endsAt) {
        this.windows.delete(key);
      }
    }
  }

  /** Distinct keys currently tracked. For tests and for a health line. */
  get size(): number {
    return this.windows.size;
  }
}
