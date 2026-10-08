import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGY_DISABLE_AUTO_UPDATE_ENV,
  AgyUpdateScheduler,
  disableAgyBackgroundUpdater,
  STUDIO_AGY_UPDATES_ENV,
} from '../../src/integrations/agy/updater.js';

describe('disableAgyBackgroundUpdater', () => {
  it('turns agy\'s own updater off and lets Studio update instead', () => {
    const env: NodeJS.ProcessEnv = {};
    expect(disableAgyBackgroundUpdater(env)).toBe(true);
    expect(env[AGY_DISABLE_AUTO_UPDATE_ENV]).toBe('true');
  });

  it('keeps agy\'s own updater when asked to', () => {
    const env: NodeJS.ProcessEnv = { [STUDIO_AGY_UPDATES_ENV]: 'agy' };
    expect(disableAgyBackgroundUpdater(env)).toBe(false);
    expect(env[AGY_DISABLE_AUTO_UPDATE_ENV]).toBeUndefined();
  });

  it('does not update at all when updates are switched off', () => {
    expect(disableAgyBackgroundUpdater({ [STUDIO_AGY_UPDATES_ENV]: 'off' })).toBe(false);
    // the user's own value wins; Studio does not update behind a deliberate setting
    const env: NodeJS.ProcessEnv = { [AGY_DISABLE_AUTO_UPDATE_ENV]: 'false' };
    expect(disableAgyBackgroundUpdater(env)).toBe(false);
    expect(env[AGY_DISABLE_AUTO_UPDATE_ENV]).toBe('false');
  });
});

describe('AgyUpdateScheduler', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('updates after the first delay, then on the interval, waiting while runs are active', async () => {
    let busy = false;
    const update = vi.fn(async () => 'You are already on the latest version.');
    const scheduler = new AgyUpdateScheduler({
      update,
      isBusy: () => busy,
      firstDelayMs: 1_000,
      intervalMs: 10_000,
      busyRetryMs: 3_000,
    });
    scheduler.start();

    await vi.advanceTimersByTimeAsync(999);
    expect(update).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(update).toHaveBeenCalledTimes(1);

    busy = true;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(update).toHaveBeenCalledTimes(1);
    busy = false;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(update).toHaveBeenCalledTimes(2);

    scheduler.stop();
    await vi.advanceTimersByTimeAsync(100_000);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('keeps going after a failed update', async () => {
    const update = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue('ok');
    const warn = vi.fn();
    const scheduler = new AgyUpdateScheduler({
      update,
      isBusy: () => false,
      firstDelayMs: 1,
      intervalMs: 1_000,
      logger: { info: vi.fn(), warn },
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(warn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(update).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });
});
