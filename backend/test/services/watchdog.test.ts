import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, ToolCall } from '@agy-studio/contracts';
import { Watchdog } from '../../src/services/autoapprove/watchdog.js';
import type { RunnerProcess } from '../../src/services/ports/agy-runner.port.js';
import { RunSupervisor } from '../../src/services/run-supervisor.js';
import type { AppError } from '../../src/utils/errors.js';
import {
  createDatabase,
  PrefsRepository,
  RunsRepository,
  SessionsRepository,
  WorkspacesRepository,
} from '../../src/repositories/index.js';

describe('Watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits run.stalled warning event when stallTimeoutSeconds elapses without injecting approval', async () => {
    const emittedEvents: AgentEvent[] = [];
    const sentInputs: string[] = [];

    const mockRunner: Pick<RunnerProcess, 'send' | 'kill'> = {
      send: async (text: string) => {
        sentInputs.push(text);
      },
      kill: async () => {},
    };

    const watchdog = new Watchdog({
      runId: 'run-1',
      sessionId: 'session-1',
      runner: mockRunner,
      stallTimeoutSeconds: 2,
      onEvent: (ev) => {
        emittedEvents.push(ev);
      },
    });

    expect(watchdog.isCurrentlyStalled()).toBe(false);

    // Advance 1 second: not yet stalled
    await vi.advanceTimersByTimeAsync(1000);
    expect(watchdog.isCurrentlyStalled()).toBe(false);
    expect(emittedEvents).toHaveLength(0);

    // Advance to 2 seconds: trigger stall warning
    await vi.advanceTimersByTimeAsync(1050);
    expect(watchdog.isCurrentlyStalled()).toBe(true);

    // Watchdog converges to warning: no approval injection via runner.send
    expect(sentInputs).toEqual([]);

    // Should have emitted only run.stalled, no autoapprove.injected
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].type).toBe('run.stalled');
    expect((emittedEvents[0] as any).idleMs).toBeGreaterThanOrEqual(2000);

    watchdog.stop();
  });

  it('multiplies timeout by 3x when a run_command tool is active', async () => {
    const emittedEvents: AgentEvent[] = [];
    const mockRunner: Pick<RunnerProcess, 'send' | 'kill'> = {
      send: async () => {},
      kill: async () => {},
    };

    const watchdog = new Watchdog({
      runId: 'run-2',
      sessionId: 'session-1',
      runner: mockRunner,
      stallTimeoutSeconds: 2,
      onEvent: (ev) => {
        emittedEvents.push(ev);
      },
    });

    const commandTool: ToolCall = {
      toolCallId: 'call-cmd-1',
      name: 'run_command',
      kind: 'run_command',
      input: { command: 'npm install' },
      target: 'npm install',
      output: null,
      error: null,
      status: 'running',
      fileChanges: [],
      startedAt: new Date().toISOString(),
      endedAt: null,
    };

    // Tool starts
    watchdog.handleEvent({
      type: 'tool.started',
      tool: commandTool,
    });

    expect(watchdog.isCommandRunning()).toBe(true);
    expect(watchdog.getEffectiveTimeoutMs()).toBe(6000); // 2s * 3 = 6s

    // At 2.5 seconds (past the 1x 2s timeout): should NOT stall because command is running
    await vi.advanceTimersByTimeAsync(2500);
    expect(watchdog.isCurrentlyStalled()).toBe(false);
    expect(emittedEvents).toHaveLength(0);

    // At 5.5 seconds: still running command, not yet stalled
    await vi.advanceTimersByTimeAsync(3000);
    expect(watchdog.isCurrentlyStalled()).toBe(false);

    // At 6.1 seconds: reaches 3x timeout, should stall
    await vi.advanceTimersByTimeAsync(600);
    expect(watchdog.isCurrentlyStalled()).toBe(true);
    expect(emittedEvents[0].type).toBe('run.stalled');

    watchdog.stop();
  });

  it('multiplies timeout by 3x when a subagent tool is active and does not terminate early during long inactivity', async () => {
    const emittedEvents: AgentEvent[] = [];
    let killed = false;
    const mockRunner: Pick<RunnerProcess, 'kill'> = {
      kill: async () => {
        killed = true;
      },
    };

    const watchdog = new Watchdog({
      runId: 'run-subagent-1',
      sessionId: 'session-1',
      runner: mockRunner,
      stallTimeoutSeconds: 2, // 2s base timeout
      onEvent: (ev) => {
        emittedEvents.push(ev);
      },
    });

    const subagentTool: ToolCall = {
      toolCallId: 'call-sub-1',
      name: 'subagent',
      kind: 'subagent',
      input: { prompt: 'Subagent background research' },
      target: null,
      output: null,
      error: null,
      status: 'running',
      fileChanges: [],
      startedAt: new Date().toISOString(),
      endedAt: null,
    };

    // Subagent tool starts
    watchdog.handleEvent({
      type: 'tool.started',
      tool: subagentTool,
    });

    expect(watchdog.isSubagentRunning()).toBe(true);
    expect(watchdog.getEffectiveTimeoutMs()).toBe(6000); // 2s * 3 = 6s

    // At 2.5s (exceeds normal 1x 2s timeout): should NOT stall because subagent step is active
    await vi.advanceTimersByTimeAsync(2500);
    expect(watchdog.isCurrentlyStalled()).toBe(false);
    expect(killed).toBe(false);
    expect(emittedEvents).toHaveLength(0);

    // At 5.0s: still active subagent step, no events, not yet stalled or killed
    await vi.advanceTimersByTimeAsync(2500);
    expect(watchdog.isCurrentlyStalled()).toBe(false);
    expect(killed).toBe(false);

    // At 6.1s: reaches 3x timeout, warning event emitted
    await vi.advanceTimersByTimeAsync(1100);
    expect(watchdog.isCurrentlyStalled()).toBe(true);
    expect(emittedEvents).toHaveLength(1);
    expect(emittedEvents[0].type).toBe('run.stalled');
    expect(killed).toBe(false);

    // Subagent finishes via tool.finished
    watchdog.handleEvent({
      type: 'tool.finished',
      tool: {
        ...subagentTool,
        status: 'succeeded',
        endedAt: new Date().toISOString(),
      },
    });

    expect(watchdog.isSubagentRunning()).toBe(false);
    expect(watchdog.getEffectiveTimeoutMs()).toBe(2000); // Reverts to 1x

    watchdog.stop();
  });

  it('multiplies timeout by 3x when subagent lifecycle events (subagent.spawned/finished) are received', async () => {
    const emittedEvents: AgentEvent[] = [];
    const mockRunner: Pick<RunnerProcess, 'kill'> = {
      kill: async () => {},
    };

    const watchdog = new Watchdog({
      runId: 'run-subagent-2',
      sessionId: 'session-1',
      runner: mockRunner,
      stallTimeoutSeconds: 2,
      onEvent: (ev) => {
        emittedEvents.push(ev);
      },
    });

    watchdog.handleEvent({
      type: 'subagent.spawned',
      parentToolCallId: 'parent-1',
      subagent: {
        conversationId: 'sub-conv-1',
        role: 'researcher',
        typeName: 'subagent',
        initialPrompt: 'Researching...',
        status: 'running',
      },
    });

    expect(watchdog.isSubagentRunning()).toBe(true);
    expect(watchdog.getEffectiveTimeoutMs()).toBe(6000);

    // After 3 seconds (past 1x timeout): not stalled
    await vi.advanceTimersByTimeAsync(3000);
    expect(watchdog.isCurrentlyStalled()).toBe(false);

    // Subagent finishes
    watchdog.handleEvent({
      type: 'subagent.finished',
      conversationId: 'sub-conv-1',
      status: 'completed',
    });

    expect(watchdog.isSubagentRunning()).toBe(false);
    expect(watchdog.getEffectiveTimeoutMs()).toBe(2000);

    watchdog.stop();
  });

  it('defaults stallTimeoutSeconds to 300 seconds (5 minutes)', () => {
    const mockRunner: Pick<RunnerProcess, 'kill'> = {
      kill: async () => {},
    };

    const watchdog = new Watchdog({
      runId: 'run-def-1',
      sessionId: 'session-1',
      runner: mockRunner,
    });

    expect(watchdog.getEffectiveTimeoutMs()).toBe(300 * 1000);
    watchdog.stop();
  });

  it('touch() (activity seen outside stdout) resets the idle timer and stalled state', async () => {
    const emittedEvents: AgentEvent[] = [];
    const watchdog = new Watchdog({
      runId: 'run-1',
      sessionId: 'session-1',
      runner: { send: async () => {}, kill: async () => {} },
      stallTimeoutSeconds: 2,
      onEvent: (ev) => {
        emittedEvents.push(ev);
      },
    });

    await vi.advanceTimersByTimeAsync(1500);
    watchdog.touch();
    await vi.advanceTimersByTimeAsync(1500);
    expect(watchdog.isCurrentlyStalled()).toBe(false);
    expect(emittedEvents).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(600);
    expect(watchdog.isCurrentlyStalled()).toBe(true);
    watchdog.touch();
    expect(watchdog.isCurrentlyStalled()).toBe(false);

    watchdog.stop();
  });

  it('recovers from stalled state when new runner output arrives', async () => {
    const emittedEvents: AgentEvent[] = [];
    const mockRunner: Pick<RunnerProcess, 'send' | 'kill'> = {
      send: async () => {},
      kill: async () => {},
    };

    const watchdog = new Watchdog({
      runId: 'run-3',
      sessionId: 'session-1',
      runner: mockRunner,
      stallTimeoutSeconds: 1,
      onEvent: (ev) => {
        emittedEvents.push(ev);
      },
    });

    // Advance 1.1s to enter stalled
    await vi.advanceTimersByTimeAsync(1100);
    expect(watchdog.isCurrentlyStalled()).toBe(true);

    // New runner output event arrives
    watchdog.handleEvent({
      type: 'message.delta',
      messageId: 'msg-1',
      text: 'Recovered and continuing...',
    });

    expect(watchdog.isCurrentlyStalled()).toBe(false);

    // Wait another 0.5s: still healthy
    await vi.advanceTimersByTimeAsync(500);
    expect(watchdog.isCurrentlyStalled()).toBe(false);

    watchdog.stop();
  });

  it('terminates run with AGY_STALLED if another cycle elapses without output after stall warning', async () => {
    let killed = false;
    let timeoutError: AppError | null = null;

    const mockRunner: Pick<RunnerProcess, 'send' | 'kill'> = {
      send: async () => {},
      kill: async () => {
        killed = true;
      },
    };

    const watchdog = new Watchdog({
      runId: 'run-4',
      sessionId: 'session-1',
      runner: mockRunner,
      stallTimeoutSeconds: 1,
      onStalledTimeout: (err) => {
        timeoutError = err;
      },
    });

    // 1. First cycle: enters stall warning
    await vi.advanceTimersByTimeAsync(1100);
    expect(watchdog.isCurrentlyStalled()).toBe(true);
    expect(killed).toBe(false);
    expect(timeoutError).toBeNull();

    // 2. Second cycle with NO output: terminates run
    await vi.advanceTimersByTimeAsync(1100);
    expect(killed).toBe(true);
    expect((timeoutError as any)?.code).toBe('AGY_STALLED');

    watchdog.stop();
  });

  it('safely catches errors in setTimeout async callback to prevent unhandled rejection', async () => {
    const mockRunner: Pick<RunnerProcess, 'kill'> = {
      kill: async () => {},
    };

    const watchdog = new Watchdog({
      runId: 'run-err-1',
      sessionId: 'session-1',
      runner: mockRunner,
      stallTimeoutSeconds: 1,
    });

    // Spy on checkStall to reject
    vi.spyOn(watchdog as any, 'checkStall').mockRejectedValueOnce(new Error('Unexpected timer error'));

    // Advance timer: setTimeout executes async callback, try/catch catches it
    await vi.advanceTimersByTimeAsync(1100);

    // No uncaught rejection thrown
    watchdog.stop();
  });

  describe('Integration with RunSupervisor', () => {
    it('RunSupervisor detects stall, emits warning event, and fails with AGY_STALLED on persistent stall', async () => {
      vi.useRealTimers(); // Use real short timers for async loop integration

      const db = createDatabase(':memory:');
      const runsRepo = new RunsRepository(db);
      const sessionsRepo = new SessionsRepository(db);
      const workspacesRepo = new WorkspacesRepository(db);

      const now = new Date().toISOString();
      const ws = workspacesRepo.create({
        id: 'ws-test',
        name: 'test-ws',
        path: 'G:/new',
        isGitRepo: false,
        createdAt: now,
        lastOpenedAt: now,
      });

      const session = sessionsRepo.create({
        id: 'sess-test',
        workspaceId: ws.id,
        accountName: 'default',
        title: 'Watchdog test session',
        agyConversationId: null,
        status: 'idle',
        model: 'gemini',
        effort: 'high',
        mode: 'plan',
        source: 'studio',
        lastRunId: null,
        lastSeq: 0,
        createdAt: now,
        updatedAt: now,
      });

      const eventsReceived: AgentEvent[] = [];
      const sentFrames: string[] = [];

      // Create an async iterable queue that hangs without yielding events
      let resolveDone: (() => void) | null = null;
      const donePromise = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });

      const hangingEventsQueue: AsyncIterable<AgentEvent> = {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              await donePromise;
              return { done: true, value: undefined };
            },
          };
        },
      };

      const mockRunnerProcess: RunnerProcess = {
        pid: 99999,
        events: hangingEventsQueue,
        exited: new Promise((res) => {
          // Keep active until killed
        }),
        send: async (prompt: string) => {
          sentFrames.push(prompt);
        },
        closeInput: () => {},
        kill: async () => {
          resolveDone?.();
        },
      };

      const mockAgyRunner = {
        async start() {
          return mockRunnerProcess;
        },
      };

      const supervisor = new RunSupervisor({
        runsRepo,
        sessionsRepo,
        runner: mockAgyRunner as any,
        profile: {
          stream: {
            multiTurnStdin: true,
            permissionEvent: {
              replyTemplate: '{"event":"permission_response","allow":true}',
            },
          },
        },
        acquireLease: () => ({ accountName: 'default', release: () => {} }),
        stallTimeoutSeconds: 0.1, // 100ms stall timeout for fast test
        onEvent: (sId, rId, ev) => {
          eventsReceived.push(ev);
        },
      });

      const { runId, completion } = await supervisor.start(session.id, {
        prompt: 'Start hanging run',
      });

      await completion;

      // Assertions
      const completedEv = eventsReceived.find((e) => e.type === 'run.completed');
      expect(completedEv).toBeDefined();
      expect((completedEv as any).status).toBe('failed');
      expect((completedEv as any).error?.code).toBe('AGY_STALLED');

      const stalledEv = eventsReceived.find((e) => e.type === 'run.stalled');
      expect(stalledEv).toBeDefined();

      const injectedEv = eventsReceived.find(
        (e) => e.type === 'autoapprove.injected' && e.layer === 'watchdog',
      );
      expect(injectedEv).toBeUndefined();

      // Verify approval was NOT sent into runner.send by watchdog
      expect(sentFrames).toEqual(['Start hanging run']);
      expect(sentFrames).not.toContain('{"event":"permission_response","allow":true}');

      // Run record in database
      const runRecord = runsRepo.findById(runId);
      expect(runRecord?.status).toBe('failed');
      expect(runRecord?.error?.code).toBe('AGY_STALLED');
    });

    it('takes stallTimeoutSeconds from prefs and keeps a run alive while noteActivity() reports progress', async () => {
      vi.useRealTimers();

      const db = createDatabase(':memory:');
      const runsRepo = new RunsRepository(db);
      const sessionsRepo = new SessionsRepository(db);
      const prefsRepo = new PrefsRepository(db);
      prefsRepo.update({ stallTimeoutSeconds: 0.15 });
      const now = new Date().toISOString();
      const ws = new WorkspacesRepository(db).create({
        id: 'ws-prefs',
        name: 'ws',
        path: 'G:/new',
        isGitRepo: false,
        createdAt: now,
        lastOpenedAt: now,
      });
      const session = sessionsRepo.create({
        id: 'sess-prefs',
        workspaceId: ws.id,
        accountName: 'default',
        title: 'prefs watchdog',
        agyConversationId: null,
        status: 'idle',
        model: null,
        effort: null,
        mode: null,
        source: 'studio',
        lastRunId: null,
        lastSeq: 0,
        createdAt: now,
        updatedAt: now,
      });

      let resolveDone: (() => void) | null = null;
      const donePromise = new Promise<void>((resolve) => {
        resolveDone = resolve;
      });
      const runnerProcess: RunnerProcess = {
        pid: 99998,
        events: {
          [Symbol.asyncIterator]() {
            return {
              async next() {
                await donePromise;
                return { done: true, value: undefined };
              },
            };
          },
        },
        exited: new Promise(() => {}),
        send: async () => {},
        closeInput: () => {},
        kill: async () => {
          resolveDone?.();
        },
      };

      const events: AgentEvent[] = [];
      const supervisor = new RunSupervisor({
        runsRepo,
        sessionsRepo,
        runner: { start: async () => runnerProcess } as any,
        profile: { stream: { multiTurnStdin: true, permissionEvent: null } } as any,
        acquireLease: () => ({ accountName: 'default', release: () => {} }),
        prefsRepo,
        onEvent: (_s, _r, ev) => {
          events.push(ev);
        },
      });

      const { runId, completion } = await supervisor.start(session.id, { prompt: 'long task' });
      const heartbeat = setInterval(() => supervisor.noteActivity(runId), 50);
      await new Promise((r) => setTimeout(r, 500));
      clearInterval(heartbeat);
      expect(events.some((e) => e.type === 'run.stalled' || e.type === 'run.completed')).toBe(false);

      await completion;
      const completed = events.find((e) => e.type === 'run.completed');
      expect((completed as any).error?.code).toBe('AGY_STALLED');
    });
  });
});
