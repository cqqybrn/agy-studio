import type { AgyProfile } from './profile/schema.js';
import { execAgy } from './catalog.js';
import { resolveRunnerBinary } from './process.js';

/**
 * agy's own auto-updater (agy 1.2.16 / 1.3.1): once more than 15 minutes have passed since its
 * last check, an agy start spawns a detached `agy --bg-updater`. That process has no console, so
 * the `agy --version` it runs gets a brand-new console window — with Windows Terminal as the
 * default terminal this shows up as a black window flashing over the desktop.
 * agy skips that updater when this variable is "true" (other values are ignored).
 */
export const AGY_DISABLE_AUTO_UPDATE_ENV = 'AGY_CLI_DISABLE_AUTO_UPDATE';

/** Set to "agy" to leave agy's own updater on (and Studio's hidden updates off). */
export const STUDIO_AGY_UPDATES_ENV = 'AGY_STUDIO_AGY_UPDATES';

/**
 * Turns off agy's background updater for every agy process started from now on (they inherit
 * this environment). Returns true when Studio should run updates itself.
 */
export function disableAgyBackgroundUpdater(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env[STUDIO_AGY_UPDATES_ENV] === 'agy') return false;
  if (env[AGY_DISABLE_AUTO_UPDATE_ENV] === undefined) {
    env[AGY_DISABLE_AUTO_UPDATE_ENV] = 'true';
  }
  // The user disabled agy updates on purpose: Studio does not update either.
  return env[AGY_DISABLE_AUTO_UPDATE_ENV] === 'true' && env[STUDIO_AGY_UPDATES_ENV] !== 'off';
}

/** Runs `agy update` without a window. */
export async function runAgyUpdate(profile: AgyProfile, defaultBin?: string): Promise<string> {
  const bin = resolveRunnerBinary(profile, defaultBin);
  const { stdout, stderr } = await execAgy(bin, ['update'], 5 * 60_000);
  return `${stdout}\n${stderr}`.trim();
}

export interface AgyUpdateSchedulerOptions {
  update: () => Promise<string>;
  /** True while agy runs are active; the update then waits. */
  isBusy: () => boolean;
  firstDelayMs?: number;
  intervalMs?: number;
  busyRetryMs?: number;
  logger?: { info(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void };
}

/**
 * Keeps agy up to date in place of its own background updater: shortly after Studio starts and
 * then every few hours, only while no run is active.
 */
export class AgyUpdateScheduler {
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;
  private readonly firstDelayMs: number;
  private readonly intervalMs: number;
  private readonly busyRetryMs: number;

  constructor(private readonly options: AgyUpdateSchedulerOptions) {
    this.firstDelayMs = options.firstDelayMs ?? 2 * 60_000;
    this.intervalMs = options.intervalMs ?? 6 * 60 * 60_000;
    this.busyRetryMs = options.busyRetryMs ?? 10 * 60_000;
  }

  start(): void {
    this.schedule(this.firstDelayMs);
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    this.timer = null;
    if (this.stopped) return;
    if (this.options.isBusy()) {
      this.schedule(this.busyRetryMs);
      return;
    }
    try {
      const output = await this.options.update();
      this.options.logger?.info({ output }, 'agy update check finished');
    } catch (err) {
      this.options.logger?.warn({ err }, 'agy update check failed');
    }
    this.schedule(this.intervalMs);
  }
}
