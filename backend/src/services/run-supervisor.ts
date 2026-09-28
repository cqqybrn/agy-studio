import type {
  AgentEvent,
  AgentMode,
  ApiErrorBody,
  Effort,
  TerminalRunStatus,
  TokenUsage,
} from '@agy-studio/contracts';
import type {
  AgyRunnerPort,
  RunnerProcess,
  SpawnRunnerOptions,
} from './ports/agy-runner.port.js';
import type { RunRecord, RunsRepository } from '../repositories/runs.js';
import type { SessionsRepository } from '../repositories/sessions.js';
import { killTree } from '../utils/proc-tree.js';
import { AppError } from '../utils/errors.js';
import { createId } from '../utils/ids.js';

export interface SupervisorLogger {
  error(obj: unknown, msg?: string): void;
  warn?(obj: unknown, msg?: string): void;
  info?(obj: unknown, msg?: string): void;
  debug?(obj: unknown, msg?: string): void;
}

export interface AccountLease {
  readonly accountName: string | null;
  readonly env?: Record<string, string | undefined>;
  release(): void;
}

export type LeaseProvider = (
  accountName: string | null,
) => Promise<AccountLease | null> | AccountLease | null;

export type SupervisorEventListener = (
  sessionId: string,
  runId: string,
  event: AgentEvent,
) => void | Promise<void>;

export interface SupervisorProfileConfig {
  stream: {
    multiTurnStdin: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface RunSupervisorOptions {
  runsRepo: RunsRepository;
  sessionsRepo: SessionsRepository;
  runner: AgyRunnerPort;
  profile: SupervisorProfileConfig;
  acquireLease: LeaseProvider;
  maxConcurrentRuns?: number;
  defaultTimeoutMs?: number;
  logger?: SupervisorLogger;
  onEvent?: SupervisorEventListener;
}

export interface StartRunInput {
  runId?: string;
  prompt: string;
  images?: string[];
  model?: string | null;
  effort?: Effort | null;
  mode?: AgentMode | null;
  cwd?: string;
  accountName?: string | null;
  checkpointId?: string | null;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  argv?: string[];
}

export interface StartRunResult {
  runId: string;
  completion: Promise<void>;
}

interface ActiveRunState {
  record: RunRecord;
  sessionId: string;
  accountName: string | null;
  runner: RunnerProcess | null;
  lease: AccountLease | null;
  isAborted: boolean;
  completeOnce: (
    status: TerminalRunStatus,
    error: ApiErrorBody | null,
    overrideUsage?: TokenUsage | null,
  ) => Promise<void>;
  completion: Promise<void>;
}

/**
 * Supervises the lifecycle of agy runs, managing state transitions, concurrency limits,
 * session exclusivity, process tree termination, and account lease acquisition/release.
 */
export class RunSupervisor {
  private readonly runsRepo: RunsRepository;
  private readonly sessionsRepo: SessionsRepository;
  private readonly runner: AgyRunnerPort;
  private readonly profile: SupervisorProfileConfig;
  private readonly acquireLease: LeaseProvider;
  private readonly maxConcurrentRuns: number;
  private readonly defaultTimeoutMs: number;
  private readonly logger?: SupervisorLogger;
  private readonly eventListeners: SupervisorEventListener[] = [];

  private readonly activeSessions = new Map<string, string>(); // sessionId -> runId
  private readonly activeRunsMap = new Map<string, ActiveRunState>(); // runId -> state

  constructor(options: RunSupervisorOptions) {
    this.runsRepo = options.runsRepo;
    this.sessionsRepo = options.sessionsRepo;
    this.runner = options.runner;
    this.profile = options.profile;
    this.acquireLease = options.acquireLease;
    this.maxConcurrentRuns = options.maxConcurrentRuns ?? 3;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 10 * 60 * 1000;
    this.logger = options.logger;

    if (options.onEvent) {
      this.eventListeners.push(options.onEvent);
    }
  }

  /**
   * Registers an event listener for all events emitted during runs.
   */
  addEventListener(listener: SupervisorEventListener): () => void {
    this.eventListeners.push(listener);
    return () => {
      const idx = this.eventListeners.indexOf(listener);
      if (idx >= 0) this.eventListeners.splice(idx, 1);
    };
  }

  /**
   * Starts a new run for the specified session.
   * Performs mutual exclusion, concurrency limit, and database initialization synchronously.
   */
  async start(sessionId: string, input: StartRunInput): Promise<StartRunResult> {
    // 1. 同步互斥检查：同一会话只能有一个非终止运行
    if (this.activeSessions.has(sessionId)) {
      throw new AppError(
        'SESSION_BUSY',
        `Session ${sessionId} already has an active run: ${this.activeSessions.get(sessionId)}`,
      );
    }

    // 2. 同步并发上限检查
    if (this.activeRunsMap.size >= this.maxConcurrentRuns) {
      throw new AppError(
        'CONCURRENCY_LIMIT',
        `Concurrency limit of ${this.maxConcurrentRuns} active runs reached`,
      );
    }

    // 3. 解析字段
    const runId = input.runId ?? createId('run');
    const session = this.sessionsRepo.findById(sessionId);
    const accountName =
      input.accountName !== undefined ? input.accountName : (session?.accountName ?? null);
    const model = input.model !== undefined ? input.model : (session?.model ?? null);
    const effort = input.effort !== undefined ? input.effort : (session?.effort ?? null);
    const mode = input.mode !== undefined ? input.mode : (session?.mode ?? null);
    const checkpointId = input.checkpointId ?? null;
    const cwd = input.cwd ?? process.cwd();
    const startTime = Date.now();
    const startedAt = new Date().toISOString();

    // 4. 同步内存锁定
    this.activeSessions.set(sessionId, runId);

    // 5. 同步写入数据库
    const initialRecord: RunRecord = {
      id: runId,
      sessionId,
      status: 'starting',
      model,
      accountName,
      checkpointId,
      pid: null,
      usage: null,
      error: null,
      startedAt,
      endedAt: null,
    };
    this.runsRepo.create(initialRecord);

    if (session) {
      this.sessionsRepo.update(sessionId, {
        status: 'running',
        lastRunId: runId,
      });
    }

    // 设置「只完成一次守卫」
    let completed = false;
    let timeoutTimer: NodeJS.Timeout | null = null;
    let resolveCompletion: () => void;
    const completionPromise = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });

    const completeOnce = async (
      status: TerminalRunStatus,
      error: ApiErrorBody | null,
      overrideUsage?: TokenUsage | null,
    ) => {
      if (completed) return;
      completed = true;

      if (timeoutTimer) {
        clearTimeout(timeoutTimer);
        timeoutTimer = null;
      }

      const endedAt = new Date().toISOString();
      const durationMs = Date.now() - startTime;

      const runnerAny = activeState.runner as {
        conversationId?: string | null;
        usage?: TokenUsage | null;
      } | null;

      const finalUsage = overrideUsage ?? runnerAny?.usage ?? null;
      const conversationId = runnerAny?.conversationId ?? session?.agyConversationId ?? null;

      // 首次拿到 conversationId 时回填 session
      if (conversationId && (!session || session.agyConversationId !== conversationId)) {
        try {
          this.sessionsRepo.update(sessionId, { agyConversationId: conversationId });
        } catch (err) {
          this.logger?.error(
            { err, sessionId, conversationId },
            'Failed to update session agyConversationId',
          );
        }
      }

      // 更新 runs 表
      try {
        this.runsRepo.update(runId, {
          status,
          error,
          usage: finalUsage,
          endedAt,
        });
      } catch (err) {
        this.logger?.error({ err, runId }, 'Failed to update run status in database');
      }

      // 更新 sessions 表状态
      try {
        this.sessionsRepo.update(sessionId, {
          status: status === 'completed' ? 'idle' : status === 'aborted' ? 'idle' : 'error',
        });
      } catch (err) {
        this.logger?.error({ err, sessionId }, 'Failed to update session status in database');
      }

      // 同一处释放账号租约（保证不泄漏）
      if (activeState.lease) {
        try {
          activeState.lease.release();
        } catch (err) {
          this.logger?.error({ err, accountName }, 'Failed to release account lease');
        }
        activeState.lease = null;
      }

      // 清除内存状态
      this.activeSessions.delete(sessionId);
      this.activeRunsMap.delete(runId);

      // 发出恰好一条 run.completed 事件
      const completedEvent: AgentEvent = {
        type: 'run.completed',
        status,
        usage: finalUsage,
        error,
        durationMs,
        agyConversationId: conversationId,
      };
      await this.emitEvent(sessionId, runId, completedEvent);

      resolveCompletion();
    };

    const activeState: ActiveRunState = {
      record: initialRecord,
      sessionId,
      accountName,
      runner: null,
      lease: null,
      isAborted: false,
      completeOnce,
      completion: completionPromise,
    };
    this.activeRunsMap.set(runId, activeState);

    // 申请账号租约（读锁）
    try {
      const lease = await this.acquireLease(accountName);
      if (!lease) {
        throw new AppError(
          'ACCOUNT_SWITCH_IN_PROGRESS',
          `Cannot acquire lease for account "${accountName ?? 'default'}": switch in progress`,
        );
      }
      activeState.lease = lease;
    } catch (err) {
      const apiErr = AppError.from(err).toApiError();
      await completeOnce('failed', apiErr);
      throw err;
    }

    // 启动进程
    let runnerProcess: RunnerProcess;
    try {
      const continuationId =
        !this.profile.stream.multiTurnStdin && session?.agyConversationId
          ? session.agyConversationId
          : undefined;

      const spawnOptions: SpawnRunnerOptions & {
        model?: string | null;
        effort?: Effort | null;
        mode?: AgentMode | null;
        resumeConversationId?: string | null;
      } = {
        bin: undefined,
        argv: input.argv,
        cwd,
        env: {
          ...input.env,
          ...(activeState.lease?.env ?? {}),
        },
        sessionId,
        runId,
        model,
        effort,
        mode,
        resumeConversationId: continuationId,
      };

      runnerProcess = await this.runner.start(spawnOptions);
      activeState.runner = runnerProcess;

      if (runnerProcess.pid) {
        initialRecord.pid = runnerProcess.pid;
        this.runsRepo.update(runId, { pid: runnerProcess.pid });
      }
    } catch (err) {
      const apiErr = AppError.from(err).toApiError();
      await completeOnce('failed', apiErr);
      throw err;
    }

    // 发出 run.started 事件
    await this.emitEvent(sessionId, runId, {
      type: 'run.started',
      runId,
      model,
      cwd,
      checkpointId,
    });
    this.runsRepo.update(runId, { status: 'running' });

    // 设置运行超时定时器
    const timeoutMs = input.timeoutMs ?? this.defaultTimeoutMs;
    if (timeoutMs > 0) {
      timeoutTimer = setTimeout(async () => {
        try {
          await activeState.runner?.kill();
        } catch (err) {
          this.logger?.debug?.({ err }, 'Ignoring runner kill error on timeout');
        }
        await completeOnce(
          'failed',
          new AppError('AGY_TIMEOUT', `Run exceeded timeout of ${timeoutMs}ms`).toApiError(),
        );
      }, timeoutMs);
    }

    // 发送用户输入
    try {
      await runnerProcess.send(input.prompt, input.images);
      if (!this.profile.stream.multiTurnStdin) {
        const child = (runnerProcess as { child?: { stdin?: { end?: () => void } } }).child;
        child?.stdin?.end?.();
      }
    } catch (err) {
      const apiErr = AppError.from(err).toApiError();
      await completeOnce('failed', apiErr);
      throw err;
    }

    // 后台流式转发事件并收口
    this.runBackgroundLoop(sessionId, runId, runnerProcess, activeState, completeOnce);

    return { runId, completion: completionPromise };
  }

  /**
   * Background event consumption loop.
   */
  private async runBackgroundLoop(
    sessionId: string,
    runId: string,
    runner: RunnerProcess,
    activeState: ActiveRunState,
    completeOnce: (
      status: TerminalRunStatus,
      error: ApiErrorBody | null,
      overrideUsage?: TokenUsage | null,
    ) => Promise<void>,
  ): Promise<void> {
    try {
      for await (const event of runner.events) {
        if (activeState.isAborted) {
          break;
        }
        await this.emitEvent(sessionId, runId, event);
      }

      // 等待进程退出
      const { exitCode } = await runner.exited;

      if (activeState.isAborted) {
        await completeOnce(
          'aborted',
          new AppError('AGY_ABORTED', 'Run was aborted by user').toApiError(),
        );
      } else if (exitCode !== 0 && exitCode !== null) {
        const runnerAny = runner as { terminal?: { error?: ApiErrorBody } };
        const err =
          runnerAny.terminal?.error ??
          new AppError('AGY_EXIT', `Process exited with code ${exitCode}`).toApiError();
        await completeOnce('failed', err);
      } else {
        const runnerAny = runner as {
          terminal?: { status?: TerminalRunStatus; error?: ApiErrorBody };
          usage?: TokenUsage | null;
        };
        const status = runnerAny.terminal?.status ?? 'completed';
        const err = runnerAny.terminal?.error ?? null;
        await completeOnce(status, err, runnerAny.usage);
      }
    } catch (err) {
      await completeOnce('failed', AppError.from(err).toApiError());
    }
  }

  /**
   * Aborts an active run.
   */
  async abort(runId: string): Promise<boolean> {
    const active = this.activeRunsMap.get(runId);
    if (!active) {
      return false;
    }

    active.isAborted = true;

    try {
      await active.runner?.kill();
    } catch (err) {
      this.logger?.error({ err, runId }, 'Failed to kill runner on abort');
    }

    await active.completeOnce(
      'aborted',
      new AppError('AGY_ABORTED', 'Run was aborted by user').toApiError(),
    );
    return true;
  }

  /**
   * Returns list of currently active runs.
   */
  activeRuns(): RunRecord[] {
    return Array.from(this.activeRunsMap.values()).map((s) => s.record);
  }

  /**
   * Checks whether there are active runs, optionally filtered by account name.
   */
  hasActiveRuns(accountName?: string | null): boolean {
    if (accountName === undefined) {
      return this.activeRunsMap.size > 0;
    }
    for (const active of this.activeRunsMap.values()) {
      if (active.accountName === accountName) {
        return true;
      }
    }
    return false;
  }

  /**
   * Returns active run record for a given session, or null if none active.
   */
  getActiveRunBySessionId(sessionId: string): RunRecord | null {
    const runId = this.activeSessions.get(sessionId);
    if (!runId) return null;
    return this.activeRunsMap.get(runId)?.record ?? null;
  }

  /**
   * Terminates orphaned runs left in non-terminal states from prior crashes.
   */
  async reapOrphans(): Promise<number> {
    const nonTerminal = this.runsRepo.listNonTerminal();
    let reapedCount = 0;

    for (const run of nonTerminal) {
      if (run.pid) {
        try {
          await killTree(run.pid);
        } catch (err) {
          this.logger?.error(
            { err, pid: run.pid, runId: run.id },
            'Failed to kill orphaned process tree',
          );
        }
      }

      try {
        this.runsRepo.update(run.id, {
          status: 'failed',
          error: new AppError('AGY_EXIT', 'Orphaned run terminated during startup reap').toApiError(),
          endedAt: new Date().toISOString(),
        });
        reapedCount++;
      } catch (err) {
        this.logger?.error({ err, runId: run.id }, 'Failed to mark orphan run as failed');
      }
    }

    return reapedCount;
  }

  /**
   * Dispatches an event to all registered listeners. Exceptions from listeners are caught and logged.
   */
  private async emitEvent(sessionId: string, runId: string, event: AgentEvent): Promise<void> {
    for (const listener of this.eventListeners) {
      try {
        await listener(sessionId, runId, event);
      } catch (err) {
        // 捕获并记录监听器异常，绝对不拖垮主运行链路
        this.logger?.error(
          { err, sessionId, runId, eventType: event.type },
          'Supervisor event listener threw an error',
        );
      }
    }
  }
}
