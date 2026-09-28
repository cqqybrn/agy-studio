import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type Database from 'better-sqlite3';
import {
  createDatabase,
  CheckpointsRepository,
  WorkspacesRepository,
  SessionsRepository,
  RunsRepository,
  PrefsRepository,
} from '../../src/repositories/index.js';
import { CheckpointService, parseCheckpointDiff } from '../../src/services/checkpoint.js';
import { RunSupervisor } from '../../src/services/run-supervisor.js';
import { AppError } from '../../src/utils/errors.js';
import type { AgyRunnerPort, RunnerProcess } from '../../src/services/ports/agy-runner.port.js';
import type { AgentEvent } from '@agy-studio/contracts';

function hashDirectory(dir: string): string {
  const hash = crypto.createHash('sha256');
  function walk(current: string) {
    if (!fs.existsSync(current)) return;
    const entries = fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        hash.update(path.relative(dir, full).replace(/\\/g, '/'));
        hash.update(fs.readFileSync(full));
      }
    }
  }
  walk(dir);
  return hash.digest('hex');
}

const emptyEvents = (): AsyncIterable<AgentEvent> => ({
  [Symbol.asyncIterator]() {
    return {
      next: async () => ({ value: undefined as unknown as AgentEvent, done: true }),
    };
  },
});

describe('CheckpointService', () => {
  let tempDir: string;
  let db: Database.Database;
  let checkpointsRepo: CheckpointsRepository;
  let workspacesRepo: WorkspacesRepository;
  let sessionsRepo: SessionsRepository;
  let runsRepo: RunsRepository;
  let checkpointService: CheckpointService;
  let workspacePath: string;
  let workspaceId: string;
  let sessionId: string;

  function createTestRun(runId: string) {
    runsRepo.create({
      id: runId,
      sessionId,
      status: 'completed',
      model: null,
      accountName: null,
      checkpointId: null,
      pid: null,
      usage: null,
      error: null,
      startedAt: new Date().toISOString(),
      endedAt: null,
    });
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-test-'));
    db = createDatabase(':memory:');
    checkpointsRepo = new CheckpointsRepository(db);
    workspacesRepo = new WorkspacesRepository(db);
    sessionsRepo = new SessionsRepository(db);
    runsRepo = new RunsRepository(db);

    workspacePath = path.join(tempDir, 'workspace');
    fs.mkdirSync(workspacePath, { recursive: true });

    workspaceId = 'ws_test_1';
    workspacesRepo.create({
      id: workspaceId,
      name: 'Test Workspace',
      path: workspacePath,
      isGitRepo: false,
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    });

    sessionId = 'session_test_1';
    sessionsRepo.create({
      id: sessionId,
      workspaceId,
      title: 'Test Session',
      agyConversationId: null,
      status: 'idle',
      model: null,
      effort: null,
      mode: null,
      source: 'studio',
      accountName: null,
      lastRunId: null,
      lastSeq: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    checkpointService = new CheckpointService({
      checkpointsRepo,
      workspacesRepo,
      sessionsRepo,
      dataDir: tempDir,
      defaultTimeoutMs: 15_000,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('diff parser parses created, modified, deleted chunks correctly', () => {
    const rawDiff = `diff --git a/created.txt b/created.txt
new file mode 100644
index 0000000..fa49b07
--- /dev/null
+++ b/created.txt
@@ -0,0 +1 @@
+new content
diff --git a/mod.txt b/mod.txt
index 1111111..2222222 100644
--- a/mod.txt
+++ b/mod.txt
@@ -1 +1 @@
-old
+new
diff --git a/del.txt b/del.txt
deleted file mode 100644
index 3333333..0000000
--- a/del.txt
+++ /dev/null
@@ -1 +0,0 @@
-deleted content`;

    const parsed = parseCheckpointDiff(rawDiff);
    expect(parsed.length).toBe(3);

    expect(parsed[0].path).toBe('created.txt');
    expect(parsed[0].changeType).toBe('created');
    expect(parsed[0].patch).toContain('+new content');

    expect(parsed[1].path).toBe('mod.txt');
    expect(parsed[1].changeType).toBe('modified');
    expect(parsed[1].patch).toContain('-old');

    expect(parsed[2].path).toBe('del.txt');
    expect(parsed[2].changeType).toBe('deleted');
    expect(parsed[2].patch).toContain('-deleted content');
  });

  it('snapshot, diff, and rollback restore modified, deleted, and created files', async () => {
    createTestRun('run_1');

    // Initial workspace files
    fs.writeFileSync(path.join(workspacePath, 'file1.txt'), 'hello');
    fs.writeFileSync(path.join(workspacePath, 'file2.txt'), 'world');

    // Take snapshot
    const cp = await checkpointService.snapshot(workspaceId, sessionId, 'run_1');
    expect(cp).not.toBeNull();
    expect(cp?.id).toBeTruthy();
    expect(cp?.commitSha).toBeTruthy();
    expect(cp?.filesChanged).toBe(2);

    // Verify stored in DB
    const stored = checkpointsRepo.findById(cp!.id);
    expect(stored).toEqual(cp);

    // List by session
    const list = await checkpointService.listBySessionId(sessionId);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(cp!.id);

    // Now modify workspace:
    // 1. modify file1.txt
    fs.writeFileSync(path.join(workspacePath, 'file1.txt'), 'hello modified');
    // 2. delete file2.txt
    fs.unlinkSync(path.join(workspacePath, 'file2.txt'));
    // 3. create file3.txt
    fs.writeFileSync(path.join(workspacePath, 'file3.txt'), 'new file');

    // Inspect diff
    const diff = await checkpointService.diff(cp!.id);
    expect(diff.checkpointId).toBe(cp!.id);
    expect(diff.files.length).toBe(3);

    const paths = diff.files.map((f) => f.path).sort();
    expect(paths).toEqual(['file1.txt', 'file2.txt', 'file3.txt']);

    // Perform rollback
    const rollbackRes = await checkpointService.rollback(cp!.id);
    expect(rollbackRes.ok).toBe(true);
    expect(rollbackRes.restoredFiles).toBe(3);

    // Verify file contents restored to snapshot state
    expect(fs.readFileSync(path.join(workspacePath, 'file1.txt'), 'utf8')).toBe('hello');
    expect(fs.readFileSync(path.join(workspacePath, 'file2.txt'), 'utf8')).toBe('world');
    expect(fs.existsSync(path.join(workspacePath, 'file3.txt'))).toBe(false);

    // Diff after rollback should be empty
    const postDiff = await checkpointService.diff(cp!.id);
    expect(postDiff.files.length).toBe(0);
  }, 15_000);

  it('guarantees user existing .git directory hash is completely untouched throughout snapshots and rollbacks', async () => {
    createTestRun('run_user_git_1');

    // Initialize user's own git repository
    execFileSync('git', ['init', workspacePath], { windowsHide: true });
    execFileSync('git', ['-C', workspacePath, 'config', 'user.name', 'User Name'], { windowsHide: true });
    execFileSync('git', ['-C', workspacePath, 'config', 'user.email', 'user@example.com'], { windowsHide: true });
    fs.writeFileSync(path.join(workspacePath, 'user_tracked.txt'), 'v1');
    execFileSync('git', ['-C', workspacePath, 'add', '.'], { windowsHide: true });
    execFileSync('git', ['-C', workspacePath, 'commit', '-m', 'user initial commit'], { windowsHide: true });

    const userGitDir = path.join(workspacePath, '.git');
    expect(fs.existsSync(userGitDir)).toBe(true);

    const hashBefore = hashDirectory(userGitDir);

    // Checkpoint operations
    const cp = await checkpointService.snapshot(workspaceId, sessionId, 'run_user_git_1');
    expect(cp).not.toBeNull();

    // Verify user .git hash right after snapshot
    const hashAfterSnapshot = hashDirectory(userGitDir);
    expect(hashAfterSnapshot).toBe(hashBefore);

    // Make edits in workspace
    fs.writeFileSync(path.join(workspacePath, 'user_tracked.txt'), 'v2 modified');
    fs.writeFileSync(path.join(workspacePath, 'untracked.txt'), 'temp file');

    // Run diff
    const diff = await checkpointService.diff(cp!.id);
    expect(diff.files.length).toBeGreaterThan(0);

    const hashAfterDiff = hashDirectory(userGitDir);
    expect(hashAfterDiff).toBe(hashBefore);

    // Rollback
    const rollbackRes = await checkpointService.rollback(cp!.id);
    expect(rollbackRes.ok).toBe(true);

    // Verify workspace restored
    expect(fs.readFileSync(path.join(workspacePath, 'user_tracked.txt'), 'utf8')).toBe('v1');
    expect(fs.existsSync(path.join(workspacePath, 'untracked.txt'))).toBe(false);

    // Verify user .git directory hash is 100% identical
    const hashAfterRollback = hashDirectory(userGitDir);
    expect(hashAfterRollback).toBe(hashBefore);
  });

  it('respects exclusion rules: node_modules, .agy-attachments, .gitignore, and files > 20MB', async () => {
    // 1. .gitignore rule
    fs.writeFileSync(path.join(workspacePath, '.gitignore'), '*.log\nbuild/\n');
    fs.writeFileSync(path.join(workspacePath, 'app.log'), 'log entry');

    // 2. node_modules
    const nodeModulesDir = path.join(workspacePath, 'node_modules', 'dep');
    fs.mkdirSync(nodeModulesDir, { recursive: true });
    fs.writeFileSync(path.join(nodeModulesDir, 'index.js'), 'module.exports = {};');

    // 3. .agy-attachments
    const attDir = path.join(workspacePath, '.agy-attachments');
    fs.mkdirSync(attDir, { recursive: true });
    fs.writeFileSync(path.join(attDir, 'att1.png'), 'image-bytes');

    // 4. normal file
    fs.writeFileSync(path.join(workspacePath, 'main.ts'), 'console.log("ok");');

    // 5. Large file > 20MB (21MB)
    const largeFilePath = path.join(workspacePath, 'huge.bin');
    const fd = fs.openSync(largeFilePath, 'w');
    // Write 21MB sparsely or with seek
    fs.writeSync(fd, Buffer.from('start'), 0, 5, 0);
    fs.writeSync(fd, Buffer.from('end'), 0, 3, 21 * 1024 * 1024);
    fs.closeSync(fd);
    expect(fs.statSync(largeFilePath).size).toBeGreaterThan(20 * 1024 * 1024);

    createTestRun('run_exclude_1');
    const cp = await checkpointService.snapshot(workspaceId, sessionId, 'run_exclude_1');
    expect(cp).not.toBeNull();

    // Verify tracked files in bare shadow repo
    const shadowRepo = path.join(tempDir, 'shadow', `${workspaceId}.git`);
    const trackedFiles = execFileSync('git', ['--git-dir=' + shadowRepo, 'ls-tree', '-r', '--name-only', cp!.commitSha], {
      windowsHide: true,
    })
      .toString()
      .split(/\r?\n/)
      .filter(Boolean);

    // Should include .gitignore and main.ts
    expect(trackedFiles).toContain('.gitignore');
    expect(trackedFiles).toContain('main.ts');

    // Should NOT include node_modules, .agy-attachments, app.log, or huge.bin
    expect(trackedFiles).not.toContain('app.log');
    expect(trackedFiles.some((f) => f.startsWith('node_modules'))).toBe(false);
    expect(trackedFiles.some((f) => f.startsWith('.agy-attachments'))).toBe(false);
    expect(trackedFiles).not.toContain('huge.bin');
  });

  it('snapshot times out and returns null without throwing or blocking', async () => {
    const warnLogs: unknown[] = [];
    const timeoutService = new CheckpointService({
      checkpointsRepo,
      workspacesRepo,
      sessionsRepo,
      dataDir: tempDir,
      defaultTimeoutMs: 1, // 1ms timeout will fire immediately
      logger: {
        warn: (obj, msg) => warnLogs.push({ obj, msg }),
      },
    });

    const res = await timeoutService.snapshot(workspaceId, sessionId, 'run_timeout_1');
    expect(res).toBeNull();
    expect(warnLogs.length).toBeGreaterThan(0);
  });

  it('serializes concurrent snapshot requests for the same workspace without corruption', async () => {
    fs.writeFileSync(path.join(workspacePath, 'counter.txt'), '0');

    createTestRun('run_concurrent_1');
    createTestRun('run_concurrent_2');
    createTestRun('run_concurrent_3');

    // Launch 3 snapshot operations simultaneously
    const p1 = checkpointService.snapshot(workspaceId, sessionId, 'run_concurrent_1');
    const p2 = checkpointService.snapshot(workspaceId, sessionId, 'run_concurrent_2');
    const p3 = checkpointService.snapshot(workspaceId, sessionId, 'run_concurrent_3');

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r3).not.toBeNull();

    expect(r1?.commitSha).toBeTruthy();
    expect(r2?.commitSha).toBeTruthy();
    expect(r3?.commitSha).toBeTruthy();

    const list = await checkpointService.listBySessionId(sessionId);
    expect(list.length).toBe(3);
  });

  it('rollback rejects with SESSION_BUSY when workspace has active runs', async () => {
    createTestRun('run_busy_1');
    fs.writeFileSync(path.join(workspacePath, 'foo.txt'), 'init');
    const cp = await checkpointService.snapshot(workspaceId, sessionId, 'run_busy_1');
    expect(cp).not.toBeNull();

    const busySupervisor = {
      hasActiveRunsForWorkspace: (wsId: string) => wsId === workspaceId,
    };

    const busyCheckpointService = new CheckpointService({
      checkpointsRepo,
      workspacesRepo,
      sessionsRepo,
      supervisor: busySupervisor,
      dataDir: tempDir,
    });

    await expect(busyCheckpointService.rollback(cp!.id)).rejects.toThrow(AppError);
    await expect(busyCheckpointService.rollback(cp!.id)).rejects.toMatchObject({
      code: 'SESSION_BUSY',
      status: 409,
    });
  });

  it('rollback takes defensive snapshot before restoring workspace', async () => {
    createTestRun('run_cp1');
    fs.writeFileSync(path.join(workspacePath, 'def.txt'), 'v1');
    const cp1 = await checkpointService.snapshot(workspaceId, sessionId, 'run_cp1');
    expect(cp1).not.toBeNull();

    // Modify file
    fs.writeFileSync(path.join(workspacePath, 'def.txt'), 'v2 modified');

    const listBefore = await checkpointService.listBySessionId(sessionId);
    expect(listBefore.length).toBe(1);

    // Rollback to cp1
    const res = await checkpointService.rollback(cp1!.id);
    expect(res.ok).toBe(true);

    // Defensive snapshot was added to DB
    const listAfter = await checkpointService.listBySessionId(sessionId);
    expect(listAfter.length).toBe(2);
    expect(listAfter.some((c) => c.id !== cp1!.id)).toBe(true);
  });

  it('integrates with RunSupervisor to snapshot before starting runner when enabled', async () => {
    const runsRepo = new RunsRepository(db);
    const prefsRepo = new PrefsRepository(db);

    const emittedEvents: AgentEvent[] = [];

    const mockRunner: AgyRunnerPort = {
      start: vi.fn(async () => {
        const proc: RunnerProcess = {
          pid: 9999,
          events: emptyEvents(),
          exited: Promise.resolve({ exitCode: 0, signal: null }),
          send: vi.fn(),
          closeInput: vi.fn(),
          kill: vi.fn(),
        };
        return proc;
      }),
    };

    const supervisor = new RunSupervisor({
      runsRepo,
      sessionsRepo,
      runner: mockRunner,
      profile: { stream: { multiTurnStdin: true } },
      acquireLease: () => ({ accountName: null, release: vi.fn() }),
      checkpointService,
      prefsRepo,
      onEvent: (_sId, _rId, ev) => {
        emittedEvents.push(ev);
      },
    });

    fs.writeFileSync(path.join(workspacePath, 'run_init.txt'), 'initial');

    const result = await supervisor.start(sessionId, { prompt: 'do work' });
    await result.completion;

    const run = runsRepo.findById(result.runId);
    expect(run?.checkpointId).toBeTruthy();

    const startedEv = emittedEvents.find((e) => e.type === 'run.started') as
      | { type: 'run.started'; checkpointId: string | null }
      | undefined;
    expect(startedEv).toBeDefined();
    expect(startedEv?.checkpointId).toBe(run?.checkpointId);
  });

  it('RunSupervisor skips checkpoint when checkpointsEnabled is false in prefs', async () => {
    const runsRepo = new RunsRepository(db);
    const prefsRepo = new PrefsRepository(db);
    prefsRepo.update({ checkpointsEnabled: false });

    const snapshotSpy = vi.spyOn(checkpointService, 'snapshot');

    const mockRunner: AgyRunnerPort = {
      start: vi.fn(async () => ({
        pid: 9998,
        events: emptyEvents(),
        exited: Promise.resolve({ exitCode: 0, signal: null }),
        send: vi.fn(),
        closeInput: vi.fn(),
        kill: vi.fn(),
      })),
    };

    const supervisor = new RunSupervisor({
      runsRepo,
      sessionsRepo,
      runner: mockRunner,
      profile: { stream: { multiTurnStdin: true } },
      acquireLease: () => ({ accountName: null, release: vi.fn() }),
      checkpointService,
      prefsRepo,
    });

    const result = await supervisor.start(sessionId, { prompt: 'no checkpoint' });
    await result.completion;

    expect(snapshotSpy).not.toHaveBeenCalled();
    const run = runsRepo.findById(result.runId);
    expect(run?.checkpointId).toBeNull();
  });
});
