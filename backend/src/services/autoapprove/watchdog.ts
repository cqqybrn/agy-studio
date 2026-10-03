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
  runner: Pick<RunnerProcess, 'kill'> & Partial<Pick<RunnerProcess, 'send'>>;
  profile?: WatchdogProfileConfig;
  stallTimeoutSeconds?: number;
  onEvent?: (event: AgentEvent) => void | Promise<void>;
  onStalledTimeout?: (error: AppError) => void | Promise<void>;
}

/**
 * Watchdog monitors agy run output for stalls.
 * - Emits run.stalled warning event if no output is received within stallTimeoutSeconds.
 * - Multiplies timeout by 3x when a 'run_command' or 'subagent' step is running.
 * - If still no output after another cycle, terminates run with AGY_STALLED.
 */
export class Watchdog {
  readonly runId: string;
  readonly sessionId: string;
  private readonly runner: Pick<RunnerProcess, 'kill'> & Partial<Pick<RunnerProcess, 'send'>>;
  private readonly profile?: WatchdogProfileConfig;
  private readonly stallTimeoutSeconds: number;
  private readonly onEvent?: (event: AgentEvent) => void | Promise<void>;
  private readonly onStalledTimeout?: (error: AppError) => void | Promise<void>;

  private timer: NodeJS.Timeout | null = null;
  private lastOutputTime: number;
  private isStopped = false;
  private isStalled = false;
  private readonly activeCommandTools = new Set<string>();
  private readonly activeSubagentTools = new Set<string>();
  private readonly activeSubagents = new Set<string>();

  constructor(options: WatchdogOptions) {
    this.runId = options.runId;
    this.sessionId = options.sessionId;
    this.runner = options.runner;
    this.profile = options.profile;
    this.stallTimeoutSeconds = options.stallTimeoutSeconds ?? 300;
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
   * Returns whether a subagent tool or subagent is currently active.
   */
  isSubagentRunning(): boolean {
    return this.activeSubagentTools.size > 0 || this.activeSubagents.size > 0;
  }

  /**
   * Returns the current effective timeout in milliseconds (3x if a command or subagent is running).
   */
  getEffectiveTimeoutMs(): number {
    const multiplier = this.isCommandRunning() || this.isSubagentRunning() ? 3 : 1;
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

  private isSubagentTool(tool: { kind?: string; name?: string }): boolean {
    return (
      tool.kind === 'subagent' ||
      tool.name === 'subagent' ||
      (typeof tool.name === 'string' && tool.name.toLowerCase().includes('subagent'))
    );
  }

  /**
   * Feeds an AgentEvent into the watchdog, resetting idle timers and tracking command/subagent tools.
   */
  handleEvent(event: AgentEvent): void {
    if (this.isStopped) return;

    // Track run_command and subagent tool calls
    if (event.type === 'tool.started') {
      if (event.tool.kind === 'run_command') {
        this.activeCommandTools.add(event.tool.toolCallId);
      }
      if (this.isSubagentTool(event.tool)) {
        this.activeSubagentTools.add(event.tool.toolCallId);
      }
    } else if (event.type === 'tool.finished') {
      if (event.tool.kind === 'run_command') {
        this.activeCommandTools.delete(event.tool.toolCallId);
      }
      if (this.isSubagentTool(event.tool)) {
        this.activeSubagentTools.delete(event.tool.toolCallId);
      }
    } else if (event.type === 'tool.updated') {
      if (event.patch.status === 'succeeded' || event.patch.status === 'failed') {
        this.activeCommandTools.delete(event.toolCallId);
        this.activeSubagentTools.delete(event.toolCallId);
      }
    } else if (event.type === 'subagent.spawned') {
      this.activeSubagents.add(event.subagent.conversationId);
    } else if (event.type === 'subagent.finished') {
      this.activeSubagents.delete(event.conversationId);
    }

    this.touch();
  }

  /**
   * Records progress observed outside stdout (e.g. new transcript steps while stdout is held back
   * behind a step that never finishes), resetting the idle timer and stalled state.
   */
  touch(): void {
    if (this.isStopped) return;
    this.lastOutputTime = Date.now();
    if (this.isStalled) {
      this.isStalled = false;
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
      try {
        await this.checkStall();
      } catch {
        // Prevent unhandled async errors in timer callback from crashing the process
      }
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
      // 1. Enter stalled state: publish warning event
      this.isStalled = true;

      // Publish run.stalled warning event
      await this.emitEvent({
        type: 'run.stalled',
        idleMs: elapsed,
      });

      // Schedule another cycle: if still no output, terminate run (circuit breaker)
      this.scheduleCheck(this.getEffectiveTimeoutMs());
    } else {
      // 2. Already stalled and another cycle elapsed with no output: terminate run
      this.stop();

      const error = new AppError(
        'AGY_STALLED',
        'Run stalled: process remained unresponsive and produced no output after stall warning threshold',
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
    this.activeSubagentTools.clear();
    this.activeSubagents.clear();
  }
}
