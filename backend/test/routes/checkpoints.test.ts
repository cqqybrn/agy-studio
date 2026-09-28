import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { Checkpoint, CheckpointDiff } from '@agy-studio/contracts';
import {
  createDatabase,
  CheckpointsRepository,
  WorkspacesRepository,
  SessionsRepository,
  RunsRepository,
} from '../../src/repositories/index.js';
import { CheckpointService } from '../../src/services/checkpoint.js';
import { checkpointsRoutes } from '../../src/routes/http/checkpoints.routes.js';

describe('Checkpoints HTTP Routes', () => {
  let app: FastifyInstance;
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
  let isWorkspaceBusy = false;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'checkpoint-route-test-'));
    db = createDatabase(':memory:');
    checkpointsRepo = new CheckpointsRepository(db);
    workspacesRepo = new WorkspacesRepository(db);
    sessionsRepo = new SessionsRepository(db);
    runsRepo = new RunsRepository(db);

    workspacePath = path.join(tempDir, 'ws');
    fs.mkdirSync(workspacePath, { recursive: true });

    workspaceId = 'ws_route_1';
    workspacesRepo.create({
      id: workspaceId,
      name: 'Route Test Workspace',
      path: workspacePath,
      isGitRepo: false,
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    });

    sessionId = 'session_route_1';
    sessionsRepo.create({
      id: sessionId,
      workspaceId,
      title: 'Route Test Session',
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

    isWorkspaceBusy = false;

    checkpointService = new CheckpointService({
      checkpointsRepo,
      workspacesRepo,
      sessionsRepo,
      supervisor: {
        hasActiveRunsForWorkspace: (wsId: string) => isWorkspaceBusy && wsId === workspaceId,
      },
      dataDir: tempDir,
    });

    app = Fastify();
    await app.register(checkpointsRoutes, { checkpointService });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

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

  it('GET /api/sessions/:sessionId/checkpoints returns checkpoints list', async () => {
    // Initially empty
    const res1 = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/checkpoints`,
    });
    expect(res1.statusCode).toBe(200);
    expect(JSON.parse(res1.body)).toEqual([]);

    // Create a file and snapshot
    createTestRun('run_r_1');
    fs.writeFileSync(path.join(workspacePath, 'foo.txt'), 'bar');
    const cp = await checkpointService.snapshot(workspaceId, sessionId, 'run_r_1');
    expect(cp).not.toBeNull();

    const res2 = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/checkpoints`,
    });
    expect(res2.statusCode).toBe(200);
    const body: Checkpoint[] = JSON.parse(res2.body);
    expect(body.length).toBe(1);
    expect(body[0].id).toBe(cp!.id);
    expect(body[0].commitSha).toBe(cp!.commitSha);
  });

  it('GET /api/sessions/:sessionId/checkpoints returns 404 when session not found', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions/non_existent_session/checkpoints',
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('GET /api/checkpoints/:checkpointId/diff returns CheckpointDiff', async () => {
    createTestRun('run_r_2');
    fs.writeFileSync(path.join(workspacePath, 'file1.txt'), 'version1');
    const cp = await checkpointService.snapshot(workspaceId, sessionId, 'run_r_2');
    expect(cp).not.toBeNull();

    // Modify file1.txt and add file2.txt
    fs.writeFileSync(path.join(workspacePath, 'file1.txt'), 'version2');
    fs.writeFileSync(path.join(workspacePath, 'file2.txt'), 'version2_new');

    const res = await app.inject({
      method: 'GET',
      url: `/api/checkpoints/${cp!.id}/diff`,
    });

    expect(res.statusCode).toBe(200);
    const diff: CheckpointDiff = JSON.parse(res.body);
    expect(diff.checkpointId).toBe(cp!.id);
    expect(diff.files.length).toBe(2);

    const paths = diff.files.map((f) => f.path).sort();
    expect(paths).toEqual(['file1.txt', 'file2.txt']);
  });

  it('GET /api/checkpoints/:checkpointId/diff returns 404 for unknown checkpoint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/checkpoints/chk_unknown/diff',
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error?.code).toBe('NOT_FOUND');
  });

  it('POST /api/checkpoints/:checkpointId/rollback returns ok and restoredFiles count', async () => {
    createTestRun('run_r_3');
    fs.writeFileSync(path.join(workspacePath, 'doc.txt'), 'doc v1');
    const cp = await checkpointService.snapshot(workspaceId, sessionId, 'run_r_3');
    expect(cp).not.toBeNull();

    // Modify doc.txt and add extra.txt
    fs.writeFileSync(path.join(workspacePath, 'doc.txt'), 'doc v2');
    fs.writeFileSync(path.join(workspacePath, 'extra.txt'), 'extra');

    const res = await app.inject({
      method: 'POST',
      url: `/api/checkpoints/${cp!.id}/rollback`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(body.restoredFiles).toBe(2);

    // Verify workspace files were restored
    expect(fs.readFileSync(path.join(workspacePath, 'doc.txt'), 'utf8')).toBe('doc v1');
    expect(fs.existsSync(path.join(workspacePath, 'extra.txt'))).toBe(false);
  });

  it('POST /api/checkpoints/:checkpointId/rollback returns 409 SESSION_BUSY when workspace has active runs', async () => {
    createTestRun('run_r_4');
    fs.writeFileSync(path.join(workspacePath, 'test.txt'), 'content');
    const cp = await checkpointService.snapshot(workspaceId, sessionId, 'run_r_4');
    expect(cp).not.toBeNull();

    // Mark workspace as busy
    isWorkspaceBusy = true;

    const res = await app.inject({
      method: 'POST',
      url: `/api/checkpoints/${cp!.id}/rollback`,
    });

    expect(res.statusCode).toBe(409);
    const body = JSON.parse(res.body);
    expect(body.error?.code).toBe('SESSION_BUSY');
  });

  it('POST /api/checkpoints/:checkpointId/rollback returns 404 for unknown checkpoint', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/checkpoints/chk_does_not_exist/rollback',
    });
    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error?.code).toBe('NOT_FOUND');
  });
});
