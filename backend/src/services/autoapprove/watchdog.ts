import type { AgentEvent } from '@agy-studio/contracts';
import type { RunnerProcess } from '../ports/agy-runner.port.js';
import { AppError } from '../../utils/errors.js';

export interface WatchdogProfileConfig {
  stream?: {
    permissionEvent?: {
      replyTemplate?: unknown;
      [key: string]: unknown;
    } | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface WatchdogOptions {
  runId: string;
  sessionId: string;
  runner: Pick<RunnerProcess, 'send' | 'kill'>;
  profile?: WatchdogProfileConfig;
  stallTimeoutSeconds?: number;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
  onStalledTimeout?: (error: AppError) => void | Promise<void>;
}

/**
 * Watchdog monitors agy run output for stalls.
 * - Emits run.stalled if no output is received within stallTimeoutSeconds.
 * - Multiplies timeout by 3x when a 'run_command' tool is running.
 * - Upon entering stalled, injects approval reply via runner.send and emits autoapprove.injected(layer='watchdog').
 * - If still no output after another cycle, terminates run with AGY_STALLED.
 */
export class Watchdog {
  readonly runId: string;
  readonly sessionId: string;
  private readonly runner: Pick<RunnerProcess, 'send' | 'kill'>;
  private readonly profile?: WatchdogProfileConfig;
  private readonly stallTimeoutSeconds: number;
  private readonly onEvent?: (event: AgentEvent) => void | Promise<void>;
  private readonly onStalledTimeout?: (error: AppError) => void | Promise<void>;

  private timer: NodeJS.Timeout | null = null;
  private lastOutputTime: number;
  private isStopped = false;
  private isStalled = false;
  private hasInjected = false;
  private readonly activeCommandTools = new Set<string>();

  constructor(options: WatchdogOptions) {
    this.runId = options.runId;
    this.sessionId = options.sessionId;
    this.runner = options.runner;
    this.profile = options.profile;
    this.stallTimeoutSeconds = options.stallTimeoutSeconds ?? 180;
    this.onEvent = options.onEvent;
    this.onStalledTimeout = options.onStalledTimeout;

    this.lastOutputTime = Date.now();
    this.scheduleCheck();
  }

  /**
   * Returns whether the watchdog is currently in stalled state.
   */
  isCurrentlyStalled(): boolean {
    return this.isStalled;
  }

  /**
   * Returns whether a run_command tool is currently active.
   */
  isCommandRunning(): boolean {
    return this.activeCommandTools.size > 0;
  }

  /**
   * Returns the current effective timeout in milliseconds (3x if a command is running).
   */
  getEffectiveTimeoutMs(): number {
    const multiplier = this.isCommandRunning() ? 3 : 1;
    return this.stallTimeoutSeconds * 1000 * multiplier;
  }

  /**
   * Dispatches an event to the registered listener.
   */
  private async emitEvent(event: AgentEvent): Promise<void> {
    if (this.onEvent) {
      try {
        await this.onEvent(event);
      } catch {
        // Suppress listener error
      }
    }
  }

  /**
   * Extracts the approval reply string from the profile or falls back to default.
   */
  private getApprovalReply(): string {
    const replyTemplate = this.profile?.stream?.permissionEvent?.replyTemplate;
    if (typeof replyTemplate === 'string') {
      return replyTemplate;
    }
    if (replyTemplate && typeof replyTemplate === 'object') {
      return JSON.stringify(replyTemplate);
    }
    return '{"event":"permission_response","allow":true}';
  }

  /**
   * Feeds an AgentEvent into the watchdog, resetting idle timers and tracking command tools.
   */
  handleEvent(event: AgentEvent): void {
    if (this.isStopped) return;

    // Track run_command tool calls
    if (event.type === 'tool.started') {
      if (event.tool.kind === 'run_command') {
        this.activeCommandTools.add(event.tool.toolCallId);
      }
    } else if (event.type === 'tool.finished') {
      if (event.tool.kind === 'run_command') {
        this.activeCommandTools.delete(event.tool.toolCallId);
      }
    } else if (event.type === 'tool.updated') {
      if (event.patch.status === 'succeeded' || event.patch.status === 'failed') {
        this.activeCommandTools.delete(event.toolCallId);
      }
    }

    // New runner output received: reset stalled state
    this.lastOutputTime = Date.now();
    if (this.isStalled) {
      this.isStalled = false;
      this.hasInjected = false;
    }

    this.scheduleCheck();
  }

  /**
   * Schedules or reschedules the timer check.
   */
  private scheduleCheck(overrideDelayMs?: number): void {
    if (this.isStopped) return;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    const effectiveTimeoutMs = this.getEffectiveTimeoutMs();
    const elapsed = Date.now() - this.lastOutputTime;
    const delay = overrideDelayMs ?? Math.max(0, effectiveTimeoutMs - elapsed);

    this.timer = setTimeout(async () => {
      await this.checkStall();
    }, delay);
  }

  /**
   * Evaluates current idle duration and triggers stall transition or timeout termination.
   */
  private async checkStall(): Promise<void> {
    if (this.isStopped) return;

    const effectiveTimeoutMs = this.getEffectiveTimeoutMs();
    const elapsed = Date.now() - this.lastOutputTime;

    if (elapsed < effectiveTimeoutMs) {
      // Idle threshold not yet reached (e.g. multiplier was applied)
      this.scheduleCheck(effectiveTimeoutMs - elapsed);
      return;
    }

    if (!this.isStalled) {
      // 1. Enter stalled state
      this.isStalled = true;

      // Publish run.stalled
      await this.emitEvent({
        type: 'run.stalled',
        idleMs: elapsed,
      });

      // Inject approval reply via runner.send
      const reply = this.getApprovalReply();
      try {
        await this.runner.send(reply);
      } catch {
        // Ignore send errors if runner closed
      }

      this.hasInjected = true;
      await this.emitEvent({
        type: 'autoapprove.injected',
        layer: 'watchdog',
        detail: 'Watchdog injected approval reply after stall',
      });

      // Schedule another cycle: if still no output, terminate run
      this.scheduleCheck(this.getEffectiveTimeoutMs());
    } else {
      // 2. Already stalled and another cycle elapsed with no output: terminate
      this.stop();

      const error = new AppError(
        'AGY_STALLED',
        'Run stalled: no output produced after watchdog approval injection',
      );

      try {
        await this.runner.kill();
      } catch {
        // Ignore kill error
      }

      if (this.onStalledTimeout) {
        try {
          await this.onStalledTimeout(error);
        } catch {
          // Suppress error
        }
      }
    }
  }

  /**
   * Stops watchdog and clears all timers.
   */
  stop(): void {
    this.isStopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.activeCommandTools.clear();
  }
}
