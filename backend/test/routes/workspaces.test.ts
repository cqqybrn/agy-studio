import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { Workspace } from '@agy-studio/contracts';
import {
  createDatabase,
  SessionsRepository,
  WorkspacesRepository,
} from '../../src/repositories/index.js';
import { WorkspaceService } from '../../src/services/workspace.js';
import { workspacesRoutes } from '../../src/routes/http/workspaces.routes.js';

describe('Workspaces HTTP Routes', () => {
  let app: FastifyInstance;
  let tempDir: string;
  let db: Database.Database;
  let workspacesRepo: WorkspacesRepository;
  let sessionsRepo: SessionsRepository;
  let workspaceService: WorkspaceService;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-route-test-'));
    db = createDatabase(':memory:');
    workspacesRepo = new WorkspacesRepository(db);
    sessionsRepo = new SessionsRepository(db);
    workspaceService = new WorkspaceService({
      workspacesRepo,
      sessionsRepo,
    });

    app = Fastify();
    await app.register(workspacesRoutes, { workspaceService });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('GET /api/workspaces returns empty list initially', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/workspaces',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toEqual([]);
  });

  it('POST /api/workspaces creates workspace with 201', async () => {
    const projectDir = path.join(tempDir, 'demo');
    fs.mkdirSync(projectDir);

    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {
        path: projectDir,
        name: 'Demo Project',
      },
    });

    expect(res.statusCode).toBe(201);
    const body: Workspace = JSON.parse(res.body);
    expect(body.id).toBeTruthy();
    expect(body.name).toBe('Demo Project');
    expect(body.path).toBe(path.resolve(projectDir));
    expect(body.isGitRepo).toBe(false);
  });

  it('POST /api/workspaces validates input schema and returns 400 with ApiErrorResponse', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/workspaces',
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('DELETE /api/workspaces/:workspaceId deletes workspace and returns { ok: true }', async () => {
    const projectDir = path.join(tempDir, 'to-delete');
    fs.mkdirSync(projectDir);
    const ws = await workspaceService.createWorkspace({ path: projectDir });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/workspaces/${ws.id}`,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  });

  it('DELETE /api/workspaces/:workspaceId returns 404 for unknown workspace', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/workspaces/nonexistent-id',
    });

    expect(res.statusCode).toBe(404);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('NOT_FOUND');
  });
});
