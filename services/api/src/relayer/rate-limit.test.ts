import { describe, expect, it } from 'vitest';
import { RateLimiter } from './rate-limit';

/**
 * The limiter is what bounds the residue that simulation cannot catch: an
 * operation that simulates clean and reverts on inclusion still costs the
 * relayer real AVAX and costs the caller nothing. See `relayer.ts`.
 */

function at(seconds: { value: number }) {
  return () => seconds.value;
}

describe('a fixed window per key', () => {
  it('allows up to the limit and refuses the next one', () => {
    const clock = { value: 1_000 };
    const limiter = new RateLimiter({ limit: 3, windowSeconds: 60, now: at(clock) });

    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false);
  });

  it('says when the window closes, so a caller can be told', () => {
    const clock = { value: 1_000 };
    const limiter = new RateLimiter({ limit: 1, windowSeconds: 60, now: at(clock) });

    limiter.take('a');

    expect(limiter.take('a')).toEqual({
      allowed: false,
      used: 1,
      limit: 1,
      windowEndsAt: 1_060,
    });
  });

  it('opens a fresh window once the old one has closed', () => {
    const clock = { value: 1_000 };
    const limiter = new RateLimiter({ limit: 1, windowSeconds: 60, now: at(clock) });

    expect(limiter.take('a').allowed).toBe(true);
    expect(limiter.take('a').allowed).toBe(false);

    clock.value = 1_060;

    expect(limiter.take('a').allowed).toBe(true);
  });

  it('keeps keys independent, so one caller cannot lock out another', () => {
    const clock = { value: 1_000 };
    const limiter = new RateLimiter({ limit: 1, windowSeconds: 60, now: at(clock) });

    expect(limiter.take('ip:1.2.3.4').allowed).toBe(true);
    expect(limiter.take('ip:1.2.3.4').allowed).toBe(false);
    expect(limiter.take('ip:5.6.7.8').allowed).toBe(true);
  });

  /**
   * A refusal costs this service a map lookup and nothing else, so counting it
   * would let a client that is already over the limit extend its own lockout
   * indefinitely by continuing to knock. The paymaster's quota works the other
   * way round, on purpose: a reverting operation costs it AVAX.
   */
  it('does not count a request it refused', () => {
    const clock = { value: 1_000 };
    const limiter = new RateLimiter({ limit: 1, windowSeconds: 60, now: at(clock) });

    limiter.take('a');

    for (let i = 0; i < 5; i += 1) {
      expect(limiter.take('a').used).toBe(1);
    }

    clock.value = 1_060;

    expect(limiter.take('a').allowed).toBe(true);
  });
});

/**
 * The sender-keyed bucket bounds what one ACCOUNT SPENDS and a refused
 * submission spends nothing, so the route must decide first and charge after.
 */
describe('checking a key without charging it', () => {
  it('reports the verdict without moving the count or opening a window', () => {
    const clock = { value: 1_000 };
    const limiter = new RateLimiter({ limit: 1, windowSeconds: 60, now: at(clock) });

    expect(limiter.peek('a')).toEqual({ allowed: true, used: 0, limit: 1, windowEndsAt: 1_060 });
    expect(limiter.size).toBe(0);
    limiter.take('a');
    expect(limiter.peek('a')).toEqual({ allowed: false, used: 1, limit: 1, windowEndsAt: 1_060 });

    clock.value = 1_060;

    expect(limiter.peek('a').allowed).toBe(true);
  });
});

describe('the map does not grow without bound', () => {
  it('forgets a key whose window has closed', () => {
    const clock = { value: 1_000 };
    const limiter = new RateLimiter({ limit: 5, windowSeconds: 60, now: at(clock) });

    limiter.take('a');
    limiter.take('b');

    expect(limiter.size).toBe(2);

    clock.value = 1_061;
    limiter.sweep();

    expect(limiter.size).toBe(0);
  });

  it('keeps a key whose window is still open', () => {
    const clock = { value: 1_000 };
    const limiter = new RateLimiter({ limit: 5, windowSeconds: 60, now: at(clock) });

    limiter.take('a');
    clock.value = 1_030;
    limiter.sweep();

    expect(limiter.size).toBe(1);
  });
});
