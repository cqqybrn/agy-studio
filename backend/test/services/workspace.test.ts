import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import {
  createDatabase,
  SessionsRepository,
  WorkspacesRepository,
} from '../../src/repositories/index.js';
import { WorkspaceService } from '../../src/services/workspace.js';
import { AppError } from '../../src/utils/errors.js';

describe('WorkspaceService', () => {
  let tempDir: string;
  let db: Database.Database;
  let workspacesRepo: WorkspacesRepository;
  let sessionsRepo: SessionsRepository;
  let workspaceService: WorkspaceService;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-service-test-'));
    db = createDatabase(':memory:');
    workspacesRepo = new WorkspacesRepository(db);
    sessionsRepo = new SessionsRepository(db);
    workspaceService = new WorkspaceService({
      workspacesRepo,
      sessionsRepo,
    });
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('lists workspaces successfully', async () => {
    const list = await workspaceService.listWorkspaces();
    expect(list).toEqual([]);
  });

  it('creates workspace with valid path and detects git repository', async () => {
    const wsDir = path.join(tempDir, 'project-a');
    fs.mkdirSync(wsDir);
    fs.mkdirSync(path.join(wsDir, '.git'));

    const ws = await workspaceService.createWorkspace({
      path: wsDir,
      name: 'Project A',
    });

    expect(ws.id).toBeTruthy();
    expect(ws.name).toBe('Project A');
    expect(ws.path).toBe(path.resolve(wsDir));
    expect(ws.isGitRepo).toBe(true);

    const list = await workspaceService.listWorkspaces();
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(ws.id);
  });

  it('creates workspace and defaults name to folder name if omitted', async () => {
    const wsDir = path.join(tempDir, 'my-folder');
    fs.mkdirSync(wsDir);

    const ws = await workspaceService.createWorkspace({
      path: wsDir,
    });

    expect(ws.name).toBe('my-folder');
    expect(ws.isGitRepo).toBe(false);
  });

  it('rejects nonexistent directory with BAD_REQUEST', async () => {
    const nonexistent = path.join(tempDir, 'not-exists');
    await expect(
      workspaceService.createWorkspace({ path: nonexistent }),
    ).rejects.toThrowError(AppError);

    try {
      await workspaceService.createWorkspace({ path: nonexistent });
    } catch (err) {
      expect((err as AppError).code).toBe('BAD_REQUEST');
    }
  });

  it('rejects file path with NOT_A_WORKSPACE', async () => {
    const filePath = path.join(tempDir, 'some-file.txt');
    fs.writeFileSync(filePath, 'hello');

    await expect(
      workspaceService.createWorkspace({ path: filePath }),
    ).rejects.toThrowError(AppError);

    try {
      await workspaceService.createWorkspace({ path: filePath });
    } catch (err) {
      expect((err as AppError).code).toBe('NOT_A_WORKSPACE');
    }
  });

  it('rejects duplicate path with CONFLICT', async () => {
    const wsDir = path.join(tempDir, 'dup-dir');
    fs.mkdirSync(wsDir);

    await workspaceService.createWorkspace({ path: wsDir });

    await expect(
      workspaceService.createWorkspace({ path: wsDir }),
    ).rejects.toThrowError(AppError);

    try {
      await workspaceService.createWorkspace({ path: wsDir });
    } catch (err) {
      expect((err as AppError).code).toBe('CONFLICT');
    }
  });

  it('deletes an existing workspace', async () => {
    const wsDir = path.join(tempDir, 'del-ws');
    fs.mkdirSync(wsDir);
    const ws = await workspaceService.createWorkspace({ path: wsDir });

    await workspaceService.deleteWorkspace(ws.id);

    const list = await workspaceService.listWorkspaces();
    expect(list.find((w) => w.id === ws.id)).toBeUndefined();
  });

  it('throws NOT_FOUND when deleting nonexistent workspace', async () => {
    await expect(workspaceService.deleteWorkspace('nonexistent-id')).rejects.toThrowError(
      AppError,
    );
  });

  it('rejects deletion when workspace has an active session run', async () => {
    const wsDir = path.join(tempDir, 'busy-ws');
    fs.mkdirSync(wsDir);
    const ws = await workspaceService.createWorkspace({ path: wsDir });

    const session = sessionsRepo.create({
      id: 'sess-active',
      workspaceId: ws.id,
      title: 'Active Session',
      agyConversationId: null,
      status: 'running',
      model: null,
      effort: null,
      mode: null,
      source: 'studio',
      accountName: null,
      lastRunId: 'run-1',
      lastSeq: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const mockSupervisor: any = {
      getActiveRunBySessionId: (sId: string) => (sId === session.id ? { id: 'run-1' } : null),
    };

    const wsServiceWithSupervisor = new WorkspaceService({
      workspacesRepo,
      sessionsRepo,
      supervisor: mockSupervisor,
    });

    await expect(wsServiceWithSupervisor.deleteWorkspace(ws.id)).rejects.toThrowError(
      AppError,
    );

    try {
      await wsServiceWithSupervisor.deleteWorkspace(ws.id);
    } catch (err) {
      expect((err as AppError).code).toBe('SESSION_BUSY');
    }
  });
});
