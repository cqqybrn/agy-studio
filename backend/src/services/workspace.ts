import fs from 'node:fs';
import path from 'node:path';
import type { CreateWorkspaceBody, Workspace } from '@agy-studio/contracts';
import type { WorkspacesRepository } from '../repositories/workspaces.js';
import type { RunSupervisor } from './run-supervisor.js';
import type { SessionsRepository } from '../repositories/sessions.js';
import { AppError } from '../utils/errors.js';
import { createId } from '../utils/ids.js';

export interface WorkspaceServiceOptions {
  workspacesRepo: WorkspacesRepository;
  sessionsRepo?: SessionsRepository;
  supervisor?: RunSupervisor;
}

export class WorkspaceService {
  private readonly workspacesRepo: WorkspacesRepository;
  private readonly sessionsRepo?: SessionsRepository;
  private readonly supervisor?: RunSupervisor;

  constructor(options: WorkspaceServiceOptions) {
    this.workspacesRepo = options.workspacesRepo;
    this.sessionsRepo = options.sessionsRepo;
    this.supervisor = options.supervisor;
  }

  async listWorkspaces(): Promise<Workspace[]> {
    return this.workspacesRepo.list();
  }

  async getWorkspace(id: string): Promise<Workspace> {
    const ws = this.workspacesRepo.findById(id);
    if (!ws) {
      throw new AppError('NOT_FOUND', `Workspace ${id} not found`);
    }
    return ws;
  }

  async createWorkspace(input: CreateWorkspaceBody): Promise<Workspace> {
    const rawPath = input.path?.trim();
    if (!rawPath) {
      throw new AppError('BAD_REQUEST', 'Workspace path is required');
    }

    const resolvedPath = path.resolve(rawPath);

    // 校验路径存在且为目录
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolvedPath);
    } catch {
      throw new AppError('BAD_REQUEST', `Workspace path does not exist: ${resolvedPath}`);
    }

    if (!stat.isDirectory()) {
      throw new AppError('NOT_A_WORKSPACE', `Workspace path is not a directory: ${resolvedPath}`);
    }

    // 检查 path 是否已存在（若已存在抛出 CONFLICT）
    const existing = this.workspacesRepo.findByPath(resolvedPath);
    if (existing) {
      throw new AppError('CONFLICT', `Workspace already exists for path: ${resolvedPath}`);
    }

    // 判断 isGitRepo（检查该目录下是否存在 .git 目录或文件）
    const gitPath = path.join(resolvedPath, '.git');
    let isGitRepo = false;
    try {
      isGitRepo = fs.existsSync(gitPath);
    } catch {
      isGitRepo = false;
    }

    const now = new Date().toISOString();
    const name = input.name?.trim() || path.basename(resolvedPath) || 'workspace';

    const workspace: Workspace = {
      id: createId('ws'),
      name,
      path: resolvedPath,
      isGitRepo,
      createdAt: now,
      lastOpenedAt: now,
    };

    return this.workspacesRepo.create(workspace);
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const ws = this.workspacesRepo.findById(workspaceId);
    if (!ws) {
      throw new AppError('NOT_FOUND', `Workspace ${workspaceId} not found`);
    }

    // 删除前检查是否存在该工作区的活跃运行，若有拒绝 SESSION_BUSY
    if (this.supervisor && this.sessionsRepo) {
      const page = this.sessionsRepo.list({ workspaceId, limit: 1000 });
      for (const s of page.items) {
        if (this.supervisor.getActiveRunBySessionId(s.id)) {
          throw new AppError('SESSION_BUSY', `Cannot delete workspace with active run in session ${s.id}`);
        }
      }
    }

    this.workspacesRepo.delete(workspaceId);
  }
}
