import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import {
  createDatabase,
  RunsRepository,
  SessionsRepository,
  WorkspacesRepository,
} from '../../src/repositories/index.js';
import {
  RunSupervisor,
  type AccountLease,
  type SupervisorProfileConfig,
} from '../../src/services/run-supervisor.js';
import type {
  AgyRunnerPort,
  RunnerProcess,
  SpawnRunnerOptions,
} from '../../src/services/ports/agy-runner.port.js';
import type { AgentEvent, Session } from '@agy-studio/contracts';
import { isProcessAlive, killTree } from '../../src/utils/proc-tree.js';
import { AppError } from '../../src/utils/errors.js';

describe('RunSupervisor Integration Tests', () => {
  let tempDir: string;
  let db: Database.Database;
  let runsRepo: RunsRepository;
  let sessionsRepo: SessionsRepository;
  let activeLeaseCount = 0;

  const mockProfile: SupervisorProfileConfig = {
    stream: {
      multiTurnStdin: true,
      eventTypeMap: {
        init: 'init',
        step_update: 'step_update',
        result: 'result',
      },
    },
  };

  const createMockLease = (accountName: string | null): AccountLease => {
    activeLeaseCount++;
    let released = false;
    return {
      accountName,
      env: { AGY_TEST_ENV: '1' },
      release() {
        if (!released) {
          released = true;
          activeLeaseCount--;
        }
      },
    };
  };

  const emptyEvents = (): AsyncIterable<AgentEvent> => ({
    [Symbol.asyncIterator]() {
      return {
        next: async () => ({ value: undefined as unknown as AgentEvent, done: true }),
      };
    },
  });

  const hangingEvents = (): AsyncIterable<AgentEvent> => ({
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise(() => {}),
      };
    },
  });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-supervisor-test-'));
    db = createDatabase({ dbPath: path.join(tempDir, 'test.db') });
    runsRepo = new RunsRepository(db);
    sessionsRepo = new SessionsRepository(db);
    const workspacesRepo = new WorkspacesRepository(db);
    const now = new Date().toISOString();
    workspacesRepo.create({
      id: 'ws-1',
      name: 'Default Workspace',
      path: tempDir,
      isGitRepo: false,
      createdAt: now,
      lastOpenedAt: now,
    });
    activeLeaseCount = 0;
  });

  afterEach(() => {
    try {
      db.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  const setupSession = (sessionId = 'sess-1', accountName: string | null = 'test-acc'): Session => {
    const now = new Date().toISOString();
    return sessionsRepo.create({
      id: sessionId,
      workspaceId: 'ws-1',
      accountName,
      title: 'Test Session',
      agyConversationId: null,
      status: 'idle',
      model: 'gemini-2.5-pro',
      effort: 'high',
      mode: 'plan',
      source: 'studio',
      lastRunId: null,
      lastSeq: 0,
      createdAt: now,
      updatedAt: now,
    });
  };

  it('1. 正常完成：恰好一条 run.completed、租约归零、无残留子进程', async () => {
    setupSession('sess-1');
    const spawnedPids: number[] = [];

    // Mock runner using actual node child process that exits cleanly
    const runner: AgyRunnerPort = {
      async start(): Promise<RunnerProcess> {
        const child = spawn(process.execPath, [
          '-e',
          'setTimeout(() => process.exit(0), 100);',
        ]);
        spawnedPids.push(child.pid!);

        const events: AgentEvent[] = [
          {
            type: 'message.delta',
            messageId: 'msg-1',
            text: 'Hello from runner',
          },
          {
            type: 'usage',
            usage: {
              inputTokens: 10,
              outputTokens: 20,
              thinkingTokens: 5,
              cacheReadTokens: 0,
              totalTokens: 35,
            },
          },
        ];

        return {
          pid: child.pid,
          events: (async function* () {
            for (const ev of events) {
              yield ev;
            }
          })(),
          conversationId: 'agy-conv-abc',
          terminal: { status: 'completed' },
          usage: {
            inputTokens: 10,
            outputTokens: 20,
            thinkingTokens: 5,
            cacheReadTokens: 0,
            totalTokens: 35,
          },
          async send() {},
          async kill() {
            if (child.pid) await killTree(child.pid);
          },
          exited: new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
            child.on('close', (code, sig) => resolve({ exitCode: code, signal: sig }));
          }),
        } as RunnerProcess;
      },
    };

    const emittedEvents: AgentEvent[] = [];
    const supervisor = new RunSupervisor({
      runsRepo,
      sessionsRepo,
      runner,
      profile: mockProfile,
      acquireLease: (acc) => createMockLease(acc),
      onEvent: (_sId, _rId, ev) => {
        emittedEvents.push(ev);
      },
    });

    const { runId, completion } = await supervisor.start('sess-1', {
      prompt: 'Hello',
      cwd: tempDir,
    });

    await completion;

    // 断言：恰好一条 run.started 与恰好一条 run.completed
    const started = emittedEvents.filter((e) => e.type === 'run.started');
    const completed = emittedEvents.filter((e) => e.type === 'run.completed');
    expect(started.length).toBe(1);
    expect(completed.length).toBe(1);

    const compEvent = completed[0];
    if (compEvent.type === 'run.completed') {
      expect(compEvent.status).toBe('completed');
      expect(compEvent.agyConversationId).toBe('agy-conv-abc');
      expect(compEvent.usage?.totalTokens).toBe(35);
      expect(compEvent.error).toBeNull();
    }

    // 数据库状态已持久化
    const runRecord = runsRepo.findById(runId);
    expect(runRecord?.status).toBe('completed');
    expect(runRecord?.endedAt).toBeDefined();

    // Session 状态与 conversationId 已回填
    const session = sessionsRepo.findById('sess-1');
    expect(session?.status).toBe('idle');
    expect(session?.agyConversationId).toBe('agy-conv-abc');

    // 租约计数归零
    expect(activeLeaseCount).toBe(0);

    // 无活跃运行
    expect(supervisor.hasActiveRuns()).toBe(false);
    expect(supervisor.activeRuns().length).toBe(0);

    // 无残留子进程
    for (const pid of spawnedPids) {
      expect(isProcessAlive(pid)).toBe(false);
    }
  });

  it('2. 非零退出：恰好一条 run.completed、标记 failed、租约归零、无残留子进程', async () => {
    setupSession('sess-2');
    const spawnedPids: number[] = [];

    const runner: AgyRunnerPort = {
      async start(): Promise<RunnerProcess> {
        const child = spawn(process.execPath, [
          '-e',
          'setTimeout(() => process.exit(42), 80);',
        ]);
        spawnedPids.push(child.pid!);

        return {
          pid: child.pid,
          events: emptyEvents(),
          async send() {},
          async kill() {
            if (child.pid) await killTree(child.pid);
          },
          exited: new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
            child.on('close', (code, sig) => resolve({ exitCode: code, signal: sig }));
          }),
        };
      },
    };

    const emittedEvents: AgentEvent[] = [];
    const supervisor = new RunSupervisor({
      runsRepo,
      sessionsRepo,
      runner,
      profile: mockProfile,
      acquireLease: (acc) => createMockLease(acc),
      onEvent: (_sId, _rId, ev) => {
        emittedEvents.push(ev);
      },
    });

    const { runId, completion } = await supervisor.start('sess-2', {
      prompt: 'Hello',
      cwd: tempDir,
    });

    await completion;

    const completed = emittedEvents.filter((e) => e.type === 'run.completed');
    expect(completed.length).toBe(1);
    const compEvent = completed[0];
    if (compEvent.type === 'run.completed') {
      expect(compEvent.status).toBe('failed');
      expect(compEvent.error?.code).toBe('AGY_EXIT');
      expect(compEvent.error?.message).toContain('42');
    }

    const runRecord = runsRepo.findById(runId);
    expect(runRecord?.status).toBe('failed');

    expect(activeLeaseCount).toBe(0);
    expect(supervisor.hasActiveRuns()).toBe(false);

    for (const pid of spawnedPids) {
      expect(isProcessAlive(pid)).toBe(false);
    }
  });

  it('3. 中止 (abort)：恰好一条 run.completed(status=aborted)、进程树被杀、租约归零', async () => {
    setupSession('sess-3');
    const spawnedPids: number[] = [];

    const runner: AgyRunnerPort = {
      async start(): Promise<RunnerProcess> {
        const child = spawn(process.execPath, [
          '-e',
          'setInterval(() => {}, 1000);',
        ]);
        spawnedPids.push(child.pid!);

        return {
          pid: child.pid,
          events: hangingEvents(),
          async send() {},
          async kill() {
            if (child.pid) await killTree(child.pid);
          },
          exited: new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
            child.on('close', (code, sig) => resolve({ exitCode: code, signal: sig }));
          }),
        };
      },
    };

    const emittedEvents: AgentEvent[] = [];
    const supervisor = new RunSupervisor({
      runsRepo,
      sessionsRepo,
      runner,
      profile: mockProfile,
      acquireLease: (acc) => createMockLease(acc),
      onEvent: (_sId, _rId, ev) => {
        emittedEvents.push(ev);
      },
    });

    const { runId, completion } = await supervisor.start('sess-3', {
      prompt: 'Hello',
      cwd: tempDir,
    });

    expect(supervisor.hasActiveRuns()).toBe(true);

    // Call abort
    const aborted = await supervisor.abort(runId);
    expect(aborted).toBe(true);

    await completion;

    const completed = emittedEvents.filter((e) => e.type === 'run.completed');
    expect(completed.length).toBe(1);
    const compEvent = completed[0];
    if (compEvent.type === 'run.completed') {
      expect(compEvent.status).toBe('aborted');
      expect(compEvent.error?.code).toBe('AGY_ABORTED');
    }

    const runRecord = runsRepo.findById(runId);
    expect(runRecord?.status).toBe('aborted');

    expect(activeLeaseCount).toBe(0);
    expect(supervisor.hasActiveRuns()).toBe(false);

    for (const pid of spawnedPids) {
      expect(isProcessAlive(pid)).toBe(false);
    }
  });

  it('4. 超时 (timeout)：恰好一条 run.completed(status=failed)、杀进程、租约归零', async () => {
    setupSession('sess-4');
    const spawnedPids: number[] = [];

    const runner: AgyRunnerPort = {
      async start(): Promise<RunnerProcess> {
        const child = spawn(process.execPath, [
          '-e',
          'setInterval(() => {}, 1000);',
        ]);
        spawnedPids.push(child.pid!);

        return {
          pid: child.pid,
          events: hangingEvents(),
          async send() {},
          async kill() {
            if (child.pid) await killTree(child.pid);
          },
          exited: new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
            child.on('close', (code, sig) => resolve({ exitCode: code, signal: sig }));
          }),
        };
      },
    };

    const emittedEvents: AgentEvent[] = [];
    const supervisor = new RunSupervisor({
      runsRepo,
      sessionsRepo,
      runner,
      profile: mockProfile,
      acquireLease: (acc) => createMockLease(acc),
      defaultTimeoutMs: 150, // 150ms timeout
      onEvent: (_sId, _rId, ev) => {
        emittedEvents.push(ev);
      },
    });

    const { runId, completion } = await supervisor.start('sess-4', {
      prompt: 'Hello',
      cwd: tempDir,
      timeoutMs: 100, // Explicit 100ms
    });

    await completion;

    const completed = emittedEvents.filter((e) => e.type === 'run.completed');
    expect(completed.length).toBe(1);
    const compEvent = completed[0];
    if (compEvent.type === 'run.completed') {
      expect(compEvent.status).toBe('failed');
      expect(compEvent.error?.code).toBe('AGY_TIMEOUT');
    }

    const runRecord = runsRepo.findById(runId);
    expect(runRecord?.status).toBe('failed');

    expect(activeLeaseCount).toBe(0);
    expect(supervisor.hasActiveRuns()).toBe(false);

    for (const pid of spawnedPids) {
      expect(isProcessAlive(pid)).toBe(false);
    }
  });

  it('5. 并发上限 (CONCURRENCY_LIMIT)：超额请求立即抛出 CONCURRENCY_LIMIT 且不创建多余运行', async () => {
    setupSession('sess-c1');
    setupSession('sess-c2');
    setupSession('sess-c3');

    const runner: AgyRunnerPort = {
      async start(): Promise<RunnerProcess> {
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);']);
        return {
          pid: child.pid,
          events: hangingEvents(),
          async send() {},
          async kill() {
            if (child.pid) await killTree(child.pid);
          },
          exited: new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
            child.on('close', (code, sig) => resolve({ exitCode: code, signal: sig }));
          }),
        };
      },
    };

    const supervisor = new RunSupervisor({
      runsRepo,
      sessionsRepo,
      runner,
      profile: mockProfile,
      acquireLease: (acc) => createMockLease(acc),
      maxConcurrentRuns: 2,
    });

    const run1 = await supervisor.start('sess-c1', { prompt: 'P1', cwd: tempDir });
    const run2 = await supervisor.start('sess-c2', { prompt: 'P2', cwd: tempDir });

    expect(supervisor.activeRuns().length).toBe(2);

    // 3rd attempt must throw CONCURRENCY_LIMIT immediately
    await expect(
      supervisor.start('sess-c3', { prompt: 'P3', cwd: tempDir }),
    ).rejects.toThrowError(AppError);

    try {
      await supervisor.start('sess-c3', { prompt: 'P3', cwd: tempDir });
    } catch (err) {
      expect((err as AppError).code).toBe('CONCURRENCY_LIMIT');
    }

    expect(supervisor.activeRuns().length).toBe(2);

    // Cleanup
    await supervisor.abort(run1.runId);
    await supervisor.abort(run2.runId);
    await run1.completion;
    await run2.completion;

    expect(activeLeaseCount).toBe(0);
    expect(supervisor.hasActiveRuns()).toBe(false);
  });

  it('6. 双击/并发重复发送互斥 (SESSION_BUSY)：第二次请求在同步代码段立即被拦截', async () => {
    setupSession('sess-double');

    const runner: AgyRunnerPort = {
      async start(): Promise<RunnerProcess> {
        const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);']);
        return {
          pid: child.pid,
          events: hangingEvents(),
          async send() {},
          async kill() {
            if (child.pid) await killTree(child.pid);
          },
          exited: new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
            child.on('close', (code, sig) => resolve({ exitCode: code, signal: sig }));
          }),
        };
      },
    };

    const supervisor = new RunSupervisor({
      runsRepo,
      sessionsRepo,
      runner,
      profile: mockProfile,
      acquireLease: (acc) => createMockLease(acc),
    });

    // Send two requests without awaiting between them (simulating rapid double click)
    const p1 = supervisor.start('sess-double', { prompt: 'First', cwd: tempDir });
    const p2 = supervisor.start('sess-double', { prompt: 'Second', cwd: tempDir });

    const results = await Promise.allSettled([p1, p2]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[1].status).toBe('rejected');

    if (results[1].status === 'rejected') {
      expect(results[1].reason).toBeInstanceOf(AppError);
      expect((results[1].reason as AppError).code).toBe('SESSION_BUSY');
    }

    if (results[0].status === 'fulfilled') {
      await supervisor.abort(results[0].value.runId);
      await results[0].value.completion;
    }

    expect(activeLeaseCount).toBe(0);
  });

  it('7. 租约获取失败 (ACCOUNT_SWITCH_IN_PROGRESS)：抛出异常、标记 failed、租约计数为 0', async () => {
    setupSession('sess-lease-fail');

    const runner: AgyRunnerPort = {
      async start(): Promise<RunnerProcess> {
        throw new Error('Should not reach runner start');
      },
    };

    const supervisor = new RunSupervisor({
      runsRepo,
      sessionsRepo,
      runner,
      profile: mockProfile,
      acquireLease: () => null, // Lock denied / switch in progress
    });

    await expect(
      supervisor.start('sess-lease-fail', { prompt: 'Hello', cwd: tempDir }),
    ).rejects.toThrowError(AppError);

    try {
      await supervisor.start('sess-lease-fail', { prompt: 'Hello', cwd: tempDir });
    } catch (err) {
      expect((err as AppError).code).toBe('ACCOUNT_SWITCH_IN_PROGRESS');
    }

    expect(activeLeaseCount).toBe(0);
    expect(supervisor.hasActiveRuns()).toBe(false);

    // Runs table was created synchronously and updated to failed
    const nonTerminal = runsRepo.listNonTerminal();
    expect(nonTerminal.length).toBe(0);
  });

  it('8. 监听器异常不拖垮主运行链路', async () => {
    setupSession('sess-listener-err');

    const runner: AgyRunnerPort = {
      async start(): Promise<RunnerProcess> {
        const child = spawn(process.execPath, [
          '-e',
          'setTimeout(() => process.exit(0), 50);',
        ]);
        return {
          pid: child.pid,
          events: (async function* () {
            yield { type: 'message.delta', messageId: 'm1', text: 'hi' };
          })(),
          async send() {},
          async kill() {
            if (child.pid) await killTree(child.pid);
          },
          exited: new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
            child.on('close', (code, sig) => resolve({ exitCode: code, signal: sig }));
          }),
        };
      },
    };

    const supervisor = new RunSupervisor({
      runsRepo,
      sessionsRepo,
      runner,
      profile: mockProfile,
      acquireLease: (acc) => createMockLease(acc),
    });

    // Add a buggy listener that throws synchronously
    supervisor.addEventListener(() => {
      throw new Error('Boom from bad event listener');
    });

    const { runId, completion } = await supervisor.start('sess-listener-err', {
      prompt: 'Hello',
      cwd: tempDir,
    });

    await completion;

    const runRecord = runsRepo.findById(runId);
    expect(runRecord?.status).toBe('completed');
    expect(activeLeaseCount).toBe(0);
  });

  it('9. reapOrphans() 终止 runs 表中非终止运行的 pid 进程树并标记 failed', async () => {
    setupSession('sess-orphan');

    // Spawn a real background process to simulate an orphaned process
    const orphanProc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);']);
    const pid = orphanProc.pid!;
    expect(isProcessAlive(pid)).toBe(true);

    // Insert non-terminal run record into runs table
    const now = new Date().toISOString();
    runsRepo.create({
      id: 'run-orphan-1',
      sessionId: 'sess-orphan',
      status: 'running',
      model: null,
      accountName: null,
      checkpointId: null,
      pid,
      usage: null,
      error: null,
      startedAt: now,
      endedAt: null,
    });

    const runner: AgyRunnerPort = {
      async start(): Promise<RunnerProcess> {
        throw new Error('Not used');
      },
    };

    const supervisor = new RunSupervisor({
      runsRepo,
      sessionsRepo,
      runner,
      profile: mockProfile,
      acquireLease: (acc) => createMockLease(acc),
    });

    const count = await supervisor.reapOrphans();
    expect(count).toBe(1);

    // Process was killed
    expect(isProcessAlive(pid)).toBe(false);

    // Run was marked failed
    const updated = runsRepo.findById('run-orphan-1');
    expect(updated?.status).toBe('failed');
    expect(updated?.error?.code).toBe('AGY_EXIT');
  });

  it('10. multiTurnStdin = false 时，新起进程并带续聊参数', async () => {
    // Session already has an agyConversationId from a prior run
    setupSession('sess-resume');
    sessionsRepo.update('sess-resume', { agyConversationId: 'prev-conv-777' });

    let capturedResumeId: string | undefined;

    const singleTurnProfile: SupervisorProfileConfig = {
      stream: {
        multiTurnStdin: false,
      },
    };

    const runner: AgyRunnerPort = {
      async start(options: SpawnRunnerOptions & { resumeConversationId?: string }): Promise<RunnerProcess> {
        capturedResumeId = options.resumeConversationId;
        const child = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 50);']);
        return {
          pid: child.pid,
          events: emptyEvents(),
          async send() {},
          async kill() {
            if (child.pid) await killTree(child.pid);
          },
          exited: new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
            child.on('close', (code, sig) => resolve({ exitCode: code, signal: sig }));
          }),
        };
      },
    };

    const supervisor = new RunSupervisor({
      runsRepo,
      sessionsRepo,
      runner,
      profile: singleTurnProfile,
      acquireLease: (acc) => createMockLease(acc),
    });

    const { completion } = await supervisor.start('sess-resume', {
      prompt: 'Next turn',
      cwd: tempDir,
    });

    await completion;

    expect(capturedResumeId).toBe('prev-conv-777');
    expect(activeLeaseCount).toBe(0);
  });
});
