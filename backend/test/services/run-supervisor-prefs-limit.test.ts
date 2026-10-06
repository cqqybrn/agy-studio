import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import type { AgentEvent } from '@agy-studio/contracts';
import {
  createDatabase,
  PrefsRepository,
  RunsRepository,
  SessionsRepository,
  WorkspacesRepository,
} from '../../src/repositories/index.js';
import { RunSupervisor, type SupervisorProfileConfig } from '../../src/services/run-supervisor.js';
import type { AgyRunnerPort, RunnerProcess } from '../../src/services/ports/agy-runner.port.js';

const profile: SupervisorProfileConfig = {
  stream: { multiTurnStdin: false, eventTypeMap: { init: 'init', step_update: 'step_update', result: 'result' } },
};

describe('RunSupervisor: concurrency limit from prefs', () => {
  let tempDir: string;
  let db: Database.Database;
  let sessionsRepo: SessionsRepository;
  let prefsRepo: PrefsRepository;
  let supervisor: RunSupervisor;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-prefs-limit-'));
    db = createDatabase({ dbPath: path.join(tempDir, 'test.db') });
    sessionsRepo = new SessionsRepository(db);
    prefsRepo = new PrefsRepository(db);
    const now = new Date().toISOString();
    new WorkspacesRepository(db).create({
      id: 'ws-1',
      name: 'ws',
      path: tempDir,
      isGitRepo: false,
      createdAt: now,
      lastOpenedAt: now,
    });
    for (const id of ['s1', 's2', 's3']) {
      sessionsRepo.create({
        id,
        workspaceId: 'ws-1',
        accountName: null,
        title: id,
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
    }

    // A run that never ends until it is killed.
    const runner: AgyRunnerPort = {
      async start(): Promise<RunnerProcess> {
        let release!: (r: { exitCode: number | null; signal: string | null }) => void;
        const exited = new Promise<{ exitCode: number | null; signal: string | null }>((r) => (release = r));
        return {
          pid: undefined,
          events: (async function* () {
            await exited;
            yield* [] as AgentEvent[];
          })(),
          async send() {},
          closeInput() {},
          async kill() {
            release({ exitCode: null, signal: 'SIGTERM' });
          },
          exited,
        } as unknown as RunnerProcess;
      },
    };
    supervisor = new RunSupervisor({
      runsRepo: new RunsRepository(db),
      sessionsRepo,
      runner,
      profile,
      prefsRepo,
      acquireLease: (accountName) => ({ accountName, env: {}, release() {} }),
    });
  });

  afterEach(async () => {
    for (const run of supervisor.activeRuns()) await supervisor.abort(run.id);
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('reads prefs.maxConcurrentRuns on every start', async () => {
    prefsRepo.update({ maxConcurrentRuns: 1 });
    await supervisor.start('s1', { prompt: 'a', cwd: tempDir });
    await expect(supervisor.start('s2', { prompt: 'b', cwd: tempDir })).rejects.toMatchObject({
      code: 'CONCURRENCY_LIMIT',
    });

    prefsRepo.update({ maxConcurrentRuns: 2 });
    await supervisor.start('s2', { prompt: 'b', cwd: tempDir });
    expect(supervisor.activeRuns()).toHaveLength(2);
  });
});
