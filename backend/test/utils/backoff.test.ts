import { describe, expect, it } from 'vitest';
import { nextDelay } from '../../src/utils/backoff.js';

describe('utils/backoff', () => {
  it('calculates deterministic delay without jitter', () => {
    const baseMs = 100;
    const maxMs = 1000;

    expect(nextDelay(0, baseMs, maxMs, { jitter: false })).toBe(100);
    expect(nextDelay(1, baseMs, maxMs, { jitter: false })).toBe(200);
    expect(nextDelay(2, baseMs, maxMs, { jitter: false })).toBe(400);
    expect(nextDelay(3, baseMs, maxMs, { jitter: false })).toBe(800);
    expect(nextDelay(4, baseMs, maxMs, { jitter: false })).toBe(1000); // capped
    expect(nextDelay(10, baseMs, maxMs, { jitter: false })).toBe(1000); // capped
  });

  it('produces delay within [0, capped] with jitter', () => {
    const baseMs = 100;
    const maxMs = 500;

    for (let attempt = 0; attempt < 5; attempt++) {
      const delay = nextDelay(attempt, baseMs, maxMs);
      const capped = Math.min(maxMs, baseMs * Math.pow(2, attempt));
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(capped);
    }
  });

  it('handles negative attempt by treating as 0', () => {
    const delay = nextDelay(-1, 100, 1000, { jitter: false });
    expect(delay).toBe(100);
  });
});
