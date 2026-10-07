import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { AgentEvent, TokenUsage } from '@agy-studio/contracts';
import {
  createDatabase,
  RunsRepository,
  SessionsRepository,
  WorkspacesRepository,
} from '../../src/repositories/index.js';
import { perRunUsage, RunSupervisor, type SupervisorProfileConfig } from '../../src/services/run-supervisor.js';
import type { AgyRunnerPort, RunnerProcess } from '../../src/services/ports/agy-runner.port.js';

const profile: SupervisorProfileConfig = {
  stream: { multiTurnStdin: false, eventTypeMap: { init: 'init', step_update: 'step_update', result: 'result' } },
};

const usage = (input: number, output: number, cache = 0): TokenUsage => ({
  inputTokens: input,
  outputTokens: output,
  thinkingTokens: 0,
  cacheReadTokens: cache,
  totalTokens: input + output,
});

describe('perRunUsage', () => {
  it('subtracts the previous conversation total', () => {
    expect(perRunUsage(usage(52_470, 3_715), usage(33_168, 1_864))).toEqual(usage(19_302, 1_851));
  });

  it('keeps the reported value without an earlier total, or when agy reset its count', () => {
    expect(perRunUsage(usage(33_168, 1_864), null)).toEqual(usage(33_168, 1_864));
    expect(perRunUsage(usage(1_000, 10), usage(50_000, 500))).toEqual(usage(1_000, 10));
    expect(perRunUsage(null, usage(1, 1))).toBeNull();
  });
});

describe('RunSupervisor: run.completed reports per-run usage', () => {
  let tempDir: string;
  let db: Database.Database;
  let runsRepo: RunsRepository;
  let supervisor: RunSupervisor;
  let nextUsage: TokenUsage | null;
  const completed: AgentEvent[] = [];

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-usage-'));
    db = createDatabase({ dbPath: path.join(tempDir, 'test.db') });
    runsRepo = new RunsRepository(db);
    const sessionsRepo = new SessionsRepository(db);
    const now = new Date().toISOString();
    new WorkspacesRepository(db).create({
      id: 'ws-1',
      name: 'ws',
      path: tempDir,
      isGitRepo: false,
      createdAt: now,
      lastOpenedAt: now,
    });
    sessionsRepo.create({
      id: 's1',
      workspaceId: 'ws-1',
      accountName: null,
      title: 's1',
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
    completed.length = 0;
    const runner: AgyRunnerPort = {
      async start(): Promise<RunnerProcess> {
        return {
          pid: undefined,
          events: (async function* () {
            yield* [] as AgentEvent[];
          })(),
          terminal: { status: 'completed' },
          usage: nextUsage,
          async send() {},
          closeInput() {},
          async kill() {},
          exited: Promise.resolve({ exitCode: 0, signal: null }),
        } as unknown as RunnerProcess;
      },
    };
    supervisor = new RunSupervisor({
      runsRepo,
      sessionsRepo,
      runner,
      profile,
      acquireLease: (accountName) => ({ accountName, env: {}, release() {} }),
      onEvent: (_s, _r, ev) => {
        if (ev.type === 'run.completed') completed.push(ev);
      },
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function run(reported: TokenUsage | null) {
    nextUsage = reported;
    const { runId, completion } = await supervisor.start('s1', { prompt: 'hi', cwd: tempDir });
    await completion;
    // keep runs strictly ordered by start time
    await new Promise((r) => setTimeout(r, 5));
    return runId;
  }

  it('shows each run its own share, skipping runs without usage, and stores agy totals', async () => {
    const first = await run(usage(33_168, 1_864));
    await run(null); // aborted / no result
    const third = await run(usage(52_470, 3_715));

    const usages = completed.map((e) => (e.type === 'run.completed' ? e.usage : null));
    expect(usages).toEqual([usage(33_168, 1_864), null, usage(19_302, 1_851)]);
    // the database keeps the running totals for the next subtraction
    expect(runsRepo.findById(first)?.usage).toEqual(usage(33_168, 1_864));
    expect(runsRepo.findById(third)?.usage).toEqual(usage(52_470, 3_715));
  });
});
