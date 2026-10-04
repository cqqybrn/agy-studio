import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { AgentEvent, ApiErrorBody } from '@agy-studio/contracts';
import {
  createDatabase,
  RunsRepository,
  SessionsRepository,
  WorkspacesRepository,
} from '../../src/repositories/index.js';
import { RunSupervisor, type SupervisorProfileConfig } from '../../src/services/run-supervisor.js';
import type { AgyRunnerPort, RunnerProcess } from '../../src/services/ports/agy-runner.port.js';

const profile: SupervisorProfileConfig = {
  stream: { multiTurnStdin: false, eventTypeMap: { init: 'init', step_update: 'step_update', result: 'result' } },
};

const STALE: ApiErrorBody = {
  code: 'BAD_REQUEST',
  message: 'FAILED_PRECONDITION (code 400): User location is not supported for the API use.',
  retryable: false,
};

const reply: AgentEvent[] = [
  { type: 'message.delta', messageId: 'm1', text: '我是 Gemini' },
  { type: 'message.done', messageId: 'm1' },
];

describe('RunSupervisor: failed result left over from an earlier turn', () => {
  let tempDir: string;
  let db: Database.Database;
  let runsRepo: RunsRepository;
  let sessionsRepo: SessionsRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-stale-error-'));
    db = createDatabase({ dbPath: path.join(tempDir, 'test.db') });
    runsRepo = new RunsRepository(db);
    sessionsRepo = new SessionsRepository(db);
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
      id: 'sess-1',
      workspaceId: 'ws-1',
      accountName: null,
      title: 't',
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
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function run(events: AgentEvent[], exitCode = 0) {
    const runner: AgyRunnerPort = {
      async start(): Promise<RunnerProcess> {
        return {
          pid: undefined,
          events: (async function* () {
            yield* events;
          })(),
          terminal: { status: 'failed', error: STALE },
          usage: null,
          async send() {},
          closeInput() {},
          async kill() {},
          exited: Promise.resolve({ exitCode, signal: null }),
        } as unknown as RunnerProcess;
      },
    };
    const emitted: AgentEvent[] = [];
    const supervisor = new RunSupervisor({
      runsRepo,
      sessionsRepo,
      runner,
      profile,
      acquireLease: (accountName) => ({ accountName, env: {}, release() {} }),
      onEvent: (_s, _r, ev) => {
        emitted.push(ev);
      },
    });
    const { runId, completion } = await supervisor.start('sess-1', { prompt: 'hi', cwd: tempDir });
    await completion;
    const completed = emitted.find((e) => e.type === 'run.completed');
    return { record: runsRepo.findById(runId), completed };
  }

  it('completes a turn that replied without an error step', async () => {
    const { record, completed } = await run(reply);
    expect(record?.status).toBe('completed');
    expect(record?.error).toBeNull();
    expect(completed).toMatchObject({ status: 'completed', error: null });
  });

  it('also when agy exits non-zero after reporting the result', async () => {
    const { record } = await run(reply, 1);
    expect(record?.status).toBe('completed');
  });

  it('keeps the failure when the turn itself reported an error step', async () => {
    const { record } = await run([
      ...reply,
      { type: 'run.error', error: { code: 'QUOTA_EXHAUSTED', message: 'quota', retryable: false } },
    ]);
    expect(record?.status).toBe('failed');
    expect(record?.error).toEqual(STALE);
  });

  it('keeps the failure when the turn produced no reply', async () => {
    const { record } = await run([]);
    expect(record?.status).toBe('failed');
  });
});
