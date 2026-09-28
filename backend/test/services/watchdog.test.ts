import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent, ToolCall } from '@agy-studio/contracts';
import { Watchdog } from '../../src/services/autoapprove/watchdog.js';
import type { RunnerProcess } from '../../src/services/ports/agy-runner.port.js';
import { RunSupervisor } from '../../src/services/run-supervisor.js';
import { AppError } from '../../src/utils/errors.js';
import {
  createDatabase,
  RunsRepository,
  SessionsRepository,
  WorkspacesRepository,
} from '../../src/repositories/index.js';
import type { AgyProfile } from '../../src/integrations/agy/profile/schema.js';

describe('Watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits run.stalled and injects approval reply via runner.send when stallTimeoutSeconds elapses', async () => {
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
      profile: {
        stream: {
          permissionEvent: {
            replyTemplate: '{"event":"permission_response","allow":true}',
          },
        },
      },
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

    // Advance to 2 seconds: trigger stall
    await vi.advanceTimersByTimeAsync(1050);
    expect(watchdog.isCurrentlyStalled()).toBe(true);

    // Should have sent approval reply to runner
    expect(sentInputs).toEqual(['{"event":"permission_response","allow":true}']);

    // Should have emitted run.stalled and autoapprove.injected(layer='watchdog')
    expect(emittedEvents).toHaveLength(2);
    expect(emittedEvents[0].type).toBe('run.stalled');
    expect((emittedEvents[0] as any).idleMs).toBeGreaterThanOrEqual(2000);

    expect(emittedEvents[1]).toEqual({
      type: 'autoapprove.injected',
      layer: 'watchdog',
      detail: 'Watchdog injected approval reply after stall',
    });

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

  it('terminates run with AGY_STALLED if another cycle elapses without output after stall injection', async () => {
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

    // 1. First cycle: enters stall and injects approval
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

  describe('Integration with RunSupervisor', () => {
    it('RunSupervisor detects stall, injects approval, and fails with AGY_STALLED on persistent stall', async () => {
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
      expect(injectedEv).toBeDefined();

      // Verify approval was sent into runner.send
      expect(sentFrames).toContain('{"event":"permission_response","allow":true}');

      // Run record in database
      const runRecord = runsRepo.findById(runId);
      expect(runRecord?.status).toBe('failed');
      expect(runRecord?.error?.code).toBe('AGY_STALLED');
    });
  });
});
