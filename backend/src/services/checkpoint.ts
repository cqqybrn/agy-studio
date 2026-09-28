import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import type { Checkpoint, CheckpointDiff, CheckpointFileDiff } from '@agy-studio/contracts';
import type { CheckpointsRepository } from '../repositories/checkpoints.js';
import type { WorkspacesRepository } from '../repositories/workspaces.js';
import type { SessionsRepository } from '../repositories/sessions.js';
import type { RunSupervisor } from './run-supervisor.js';
import { getConfig } from '../utils/config.js';
import { AppError } from '../utils/errors.js';
import { createId } from '../utils/ids.js';

export interface CheckpointServiceLogger {
  warn?(obj: unknown, msg?: string): void;
  error?(obj: unknown, msg?: string): void;
  info?(obj: unknown, msg?: string): void;
  debug?(obj: unknown, msg?: string): void;
}

export interface CheckpointServiceOptions {
  checkpointsRepo: CheckpointsRepository;
  workspacesRepo: WorkspacesRepository;
  sessionsRepo?: SessionsRepository;
  supervisor?: RunSupervisor | { hasActiveRunsForWorkspace(workspaceId: string): boolean };
  dataDir?: string;
  defaultTimeoutMs?: number;
  logger?: CheckpointServiceLogger;
}

export interface ExecGitOptions {
  cwd?: string;
  signal?: AbortSignal;
  timeout?: number;
}

/**
 * Parses unified git diff into individual file diff structures.
 */
export function parseCheckpointDiff(diffOutput: string): CheckpointFileDiff[] {
  if (!diffOutput || !diffOutput.trim()) {
    return [];
  }

  const rawChunks = diffOutput.split(/^diff --git /m);
  const result: CheckpointFileDiff[] = [];

  for (const rawChunk of rawChunks) {
    if (!rawChunk.trim()) continue;
    const patch = `diff --git ${rawChunk.trimEnd()}`;
    const lines = patch.split(/\r?\n/);
    const headerLine = lines[0];

    let changeType: 'created' | 'modified' | 'deleted' = 'modified';
    if (lines.some((l) => l.startsWith('new file mode '))) {
      changeType = 'created';
    } else if (lines.some((l) => l.startsWith('deleted file mode '))) {
      changeType = 'deleted';
    }

    let filePath = '';
    const bLine = lines.find((l) => l.startsWith('+++ b/'));
    const aLine = lines.find((l) => l.startsWith('--- a/'));

    if (changeType === 'created') {
      if (bLine) filePath = bLine.slice(6);
    } else if (changeType === 'deleted') {
      if (aLine) filePath = aLine.slice(6);
    } else {
      if (bLine) filePath = bLine.slice(6);
      else if (aLine) filePath = aLine.slice(6);
    }

    if (!filePath) {
      const match = headerLine.match(
        /^diff --git (?:a\/|"(?:a\/)?)(.+?)(?:"?)\s+(?:b\/|"(?:b\/)?)(.+?)"?$/,
      );
      if (match) {
        filePath = changeType === 'created' ? match[2] : match[1];
      }
    }

    filePath = filePath.replace(/^"(.*)"$/, '$1').replace(/\\/g, '/');

    result.push({
      path: filePath,
      changeType,
      patch,
    });
  }

  return result;
}

/**
 * Serializes async operations on a per-workspace basis to avoid concurrent corruption.
 */
export class WorkspaceMutex {
  private tails = new Map<string, Promise<void>>();

  async runExclusive<T>(workspaceId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(workspaceId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(workspaceId, next);

    try {
      await prev;
    } catch {
      // Ignore errors from previous operation in queue
    }

    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(workspaceId) === next) {
        this.tails.delete(workspaceId);
      }
    }
  }
}

export class CheckpointService {
  private readonly checkpointsRepo: CheckpointsRepository;
  private readonly workspacesRepo: WorkspacesRepository;
  private readonly sessionsRepo?: SessionsRepository;
  private readonly supervisor?: RunSupervisor | { hasActiveRunsForWorkspace(workspaceId: string): boolean };
  private readonly dataDir: string;
  private readonly defaultTimeoutMs: number;
  private readonly logger?: CheckpointServiceLogger;
  private readonly mutex = new WorkspaceMutex();

  constructor(options: CheckpointServiceOptions) {
    this.checkpointsRepo = options.checkpointsRepo;
    this.workspacesRepo = options.workspacesRepo;
    this.sessionsRepo = options.sessionsRepo;
    this.supervisor = options.supervisor;
    this.dataDir = options.dataDir ?? getConfig().dataDir;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 15_000;
    this.logger = options.logger;
  }

  /**
   * Invokes git subprocess directly via execFile (never via shell).
   */
  private async execGit(
    args: string[],
    options?: ExecGitOptions,
  ): Promise<{ stdout: string; stderr: string }> {
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        args,
        {
          cwd: options?.cwd,
          signal: options?.signal,
          timeout: options?.timeout,
          windowsHide: true,
          maxBuffer: 50 * 1024 * 1024,
        },
        (error, stdout, stderr) => {
          if (error) {
            reject(error);
          } else {
            resolve({
              stdout: stdout ? stdout.toString() : '',
              stderr: stderr ? stderr.toString() : '',
            });
          }
        },
      );
    });
  }

  /**
   * Path to shadow bare repository for workspace: DATA_DIR/shadow/<workspaceId>.git
   */
  private getShadowRepoPath(workspaceId: string): string {
    return path.join(this.dataDir, 'shadow', `${workspaceId}.git`);
  }

  /**
   * Ensures bare shadow repository is initialized with default author info.
   */
  private async ensureRepoInitialized(
    shadowRepo: string,
    signal?: AbortSignal,
  ): Promise<void> {
    if (!fs.existsSync(shadowRepo)) {
      fs.mkdirSync(shadowRepo, { recursive: true });
    }
    const headPath = path.join(shadowRepo, 'HEAD');
    if (!fs.existsSync(headPath)) {
      await this.execGit(['init', '--bare', shadowRepo], { signal });
      await this.execGit(
        ['--git-dir=' + shadowRepo, 'config', 'user.name', 'Agy Studio'],
        { signal },
      );
      await this.execGit(
        ['--git-dir=' + shadowRepo, 'config', 'user.email', 'studio@local'],
        { signal },
      );
    }
  }

  /**
   * Dynamically populates shadow repo info/exclude:
   * .git/ + node_modules/ + .agy-attachments/ + user's .gitignore (if any) + files > 20MB
   */
  private async updateExcludeRules(
    shadowRepo: string,
    workspacePath: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const infoDir = path.join(shadowRepo, 'info');
    if (!fs.existsSync(infoDir)) {
      fs.mkdirSync(infoDir, { recursive: true });
    }
    const excludePath = path.join(infoDir, 'exclude');

    const baseRules = [
      '.git',
      '.git/',
      'node_modules',
      'node_modules/',
      '.agy-attachments',
      '.agy-attachments/',
    ];

    const userGitignorePath = path.join(workspacePath, '.gitignore');
    let userGitignore = '';
    if (fs.existsSync(userGitignorePath)) {
      try {
        userGitignore = fs.readFileSync(userGitignorePath, 'utf8');
      } catch {
        // ignore read error
      }
    }

    const initialContent =
      [...baseRules, ...(userGitignore ? [userGitignore] : [])].join('\n') + '\n';
    fs.writeFileSync(excludePath, initialContent, 'utf8');

    // Detect files > 20MB
    try {
      const { stdout } = await this.execGit(
        [
          '--git-dir=' + shadowRepo,
          '--work-tree=' + workspacePath,
          'ls-files',
          '-o',
          '-m',
          '--exclude-standard',
        ],
        { signal },
      );
      const files = stdout.split(/\r?\n/).filter(Boolean);
      const maxBytes = 20 * 1024 * 1024;
      const largeFiles: string[] = [];

      for (const relFile of files) {
        try {
          const absPath = path.join(workspacePath, relFile);
          const stat = fs.statSync(absPath);
          if (stat.isFile() && stat.size > maxBytes) {
            largeFiles.push('/' + relFile.replace(/\\/g, '/'));
          }
        } catch {
          // File may have been removed or inaccessible
        }
      }

      if (largeFiles.length > 0) {
        fs.appendFileSync(excludePath, largeFiles.join('\n') + '\n', 'utf8');

        // Unstage any large file that might have been previously tracked
        for (const lf of largeFiles) {
          try {
            await this.execGit([
              '--git-dir=' + shadowRepo,
              '--work-tree=' + workspacePath,
              'rm',
              '--cached',
              '--ignore-unmatch',
              lf.slice(1),
            ], { signal });
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // Base rules are already active
    }
  }

  private parseFilesChanged(shortstatOutput: string): number {
    const match = shortstatOutput.match(/(\d+)\s+files?\s+changed/i);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Lists checkpoints for a given session.
   */
  async listBySessionId(sessionId: string): Promise<Checkpoint[]> {
    if (this.sessionsRepo) {
      const session = this.sessionsRepo.findById(sessionId);
      if (!session) {
        throw new AppError('NOT_FOUND', `Session ${sessionId} not found`);
      }
    }
    return this.checkpointsRepo.listBySessionId(sessionId);
  }

  /**
   * Captures a snapshot of the workspace into the shadow bare git repo.
   * Times out after timeoutMs (defaults to 15,000ms), returning null on timeout/failure without blocking.
   */
  async snapshot(
    workspaceId: string,
    sessionId: string,
    runId: string,
    options?: { timeoutMs?: number },
  ): Promise<Checkpoint | null> {
    return this.mutex.runExclusive(workspaceId, async () => {
      const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;
      const controller = new AbortController();
      let timer: NodeJS.Timeout | null = null;
      let isTimedOut = false;

      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          isTimedOut = true;
          controller.abort(new Error(`Checkpoint snapshot timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      try {
        const workspace = this.workspacesRepo.findById(workspaceId);
        if (!workspace) {
          throw new AppError('NOT_FOUND', `Workspace ${workspaceId} not found`);
        }

        const shadowRepo = this.getShadowRepoPath(workspaceId);
        await this.ensureRepoInitialized(shadowRepo, controller.signal);
        await this.updateExcludeRules(shadowRepo, workspace.path, controller.signal);

        await this.execGit(
          ['--git-dir=' + shadowRepo, '--work-tree=' + workspace.path, 'add', '-A'],
          { signal: controller.signal },
        );

        await this.execGit(
          [
            '--git-dir=' + shadowRepo,
            '--work-tree=' + workspace.path,
            'commit',
            '-m',
            `checkpoint:${runId}`,
            '--allow-empty',
          ],
          { signal: controller.signal },
        );

        const { stdout: commitShaOut } = await this.execGit(
          ['--git-dir=' + shadowRepo, 'rev-parse', 'HEAD'],
          { signal: controller.signal },
        );
        const commitSha = commitShaOut.trim();

        const { stdout: statOut } = await this.execGit(
          ['--git-dir=' + shadowRepo, 'show', '--shortstat', '--format=', 'HEAD'],
          { signal: controller.signal },
        );
        const filesChanged = this.parseFilesChanged(statOut);

        const checkpoint: Checkpoint = {
          id: createId('chk'),
          workspaceId,
          sessionId,
          runId,
          commitSha,
          filesChanged,
          createdAt: new Date().toISOString(),
        };

        return this.checkpointsRepo.create(checkpoint);
      } catch (err) {
        if (isTimedOut || (err instanceof Error && err.name === 'AbortError')) {
          this.logger?.warn?.(
            { workspaceId, sessionId, runId, timeoutMs },
            'Checkpoint snapshot timed out; continuing without checkpoint',
          );
          return null;
        }

        if (err instanceof AppError && err.code === 'NOT_FOUND') {
          throw err;
        }

        this.logger?.error?.(
          { err, workspaceId, sessionId, runId },
          'Checkpoint snapshot failed; continuing without checkpoint',
        );
        return null;
      } finally {
        if (timer) {
          clearTimeout(timer);
        }
      }
    });
  }

  /**
   * Returns unified diff between the target checkpoint and the current workspace state.
   */
  async diff(
    checkpointId: string,
    options?: { timeoutMs?: number },
  ): Promise<CheckpointDiff> {
    const checkpoint = this.checkpointsRepo.findById(checkpointId);
    if (!checkpoint) {
      throw new AppError('NOT_FOUND', `Checkpoint ${checkpointId} not found`);
    }

    const workspace = this.workspacesRepo.findById(checkpoint.workspaceId);
    if (!workspace) {
      throw new AppError('NOT_FOUND', `Workspace ${checkpoint.workspaceId} not found`);
    }

    const timeoutMs = options?.timeoutMs ?? 30_000;
    const controller = new AbortController();
    let timer: NodeJS.Timeout | null = null;
    let isTimedOut = false;

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        isTimedOut = true;
        controller.abort(new Error(`Checkpoint diff timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    try {
      return await this.mutex.runExclusive(checkpoint.workspaceId, async () => {
        const shadowRepo = this.getShadowRepoPath(checkpoint.workspaceId);
        await this.ensureRepoInitialized(shadowRepo, controller.signal);
        await this.updateExcludeRules(shadowRepo, workspace.path, controller.signal);

        // Stage intent-to-add so untracked files are visible in git diff
        await this.execGit(
          [
            '--git-dir=' + shadowRepo,
            '--work-tree=' + workspace.path,
            'add',
            '-N',
            '-A',
          ],
          { signal: controller.signal },
        );

        let diffOutput = '';
        try {
          const { stdout } = await this.execGit(
            [
              '--git-dir=' + shadowRepo,
              '--work-tree=' + workspace.path,
              'diff',
              checkpoint.commitSha,
              '--',
            ],
            { signal: controller.signal },
          );
          diffOutput = stdout;
        } finally {
          // Clear intent-to-add from shadow index without affecting working tree
          try {
            await this.execGit(['--git-dir=' + shadowRepo, 'reset', 'HEAD'], {
              signal: controller.signal,
            });
          } catch {
            // ignore reset error
          }
        }

        const files = parseCheckpointDiff(diffOutput);
        return {
          checkpointId,
          files,
        };
      });
    } catch (err) {
      if (isTimedOut || (err instanceof Error && err.name === 'AbortError')) {
        throw new AppError('CHECKPOINT_FAILED', `Checkpoint diff timed out after ${timeoutMs}ms`, {
          cause: err,
        });
      }
      throw err;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * Rolls back the workspace to the state of the target checkpoint.
   * Performs defensive snapshot before restoring, and rejects with SESSION_BUSY if active runs exist.
   */
  async rollback(
    checkpointId: string,
    options?: { timeoutMs?: number },
  ): Promise<{ ok: true; restoredFiles: number }> {
    const checkpoint = this.checkpointsRepo.findById(checkpointId);
    if (!checkpoint) {
      throw new AppError('NOT_FOUND', `Checkpoint ${checkpointId} not found`);
    }

    const workspace = this.workspacesRepo.findById(checkpoint.workspaceId);
    if (!workspace) {
      throw new AppError('NOT_FOUND', `Workspace ${checkpoint.workspaceId} not found`);
    }

    // Check whether workspace currently has active runs
    if (this.supervisor?.hasActiveRunsForWorkspace(checkpoint.workspaceId)) {
      throw new AppError(
        'SESSION_BUSY',
        `Cannot rollback: workspace ${checkpoint.workspaceId} currently has active runs`,
      );
    }

    const timeoutMs = options?.timeoutMs ?? 30_000;
    const controller = new AbortController();
    let timer: NodeJS.Timeout | null = null;
    let isTimedOut = false;

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        isTimedOut = true;
        controller.abort(new Error(`Checkpoint rollback timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    }

    try {
      return await this.mutex.runExclusive(checkpoint.workspaceId, async () => {
        if (this.supervisor?.hasActiveRunsForWorkspace(checkpoint.workspaceId)) {
          throw new AppError(
            'SESSION_BUSY',
            `Cannot rollback: workspace ${checkpoint.workspaceId} currently has active runs`,
          );
        }

        const shadowRepo = this.getShadowRepoPath(checkpoint.workspaceId);
        await this.ensureRepoInitialized(shadowRepo, controller.signal);
        await this.updateExcludeRules(shadowRepo, workspace.path, controller.signal);

        // 1. Defensive snapshot before rollback
        await this.execGit(
          [
            '--git-dir=' + shadowRepo,
            '--work-tree=' + workspace.path,
            'add',
            '-A',
          ],
          { signal: controller.signal },
        );
        await this.execGit(
          [
            '--git-dir=' + shadowRepo,
            '--work-tree=' + workspace.path,
            'commit',
            '-m',
            `checkpoint:defensive-before-rollback:${checkpointId}`,
            '--allow-empty',
          ],
          { signal: controller.signal },
        );

        const { stdout: defShaOut } = await this.execGit(
          [
            '--git-dir=' + shadowRepo,
            'rev-parse',
            'HEAD',
          ],
          { signal: controller.signal },
        );
        const defSha = defShaOut.trim();

        const defensiveCheckpoint: Checkpoint = {
          id: createId('chk'),
          workspaceId: checkpoint.workspaceId,
          sessionId: checkpoint.sessionId,
          runId: checkpoint.runId,
          commitSha: defSha,
          filesChanged: null,
          createdAt: new Date().toISOString(),
        };
        this.checkpointsRepo.create(defensiveCheckpoint);

        // 2. Count restored files (diff between target commit and defensive snapshot commit)
        const { stdout: diffNamesOut } = await this.execGit(
          [
            '--git-dir=' + shadowRepo,
            'diff',
            '--name-only',
            checkpoint.commitSha,
            defSha,
          ],
          { signal: controller.signal },
        );
        const changedFiles = diffNamesOut.trim().split(/\r?\n/).filter(Boolean);
        const restoredFiles = changedFiles.length;

        // 3. Restore workspace to target snapshot state and clean untracked additions
        await this.execGit(
          [
            '--git-dir=' + shadowRepo,
            '--work-tree=' + workspace.path,
            'read-tree',
            checkpoint.commitSha,
          ],
          { signal: controller.signal },
        );
        await this.execGit(
          [
            '--git-dir=' + shadowRepo,
            '--work-tree=' + workspace.path,
            'checkout-index',
            '-a',
            '-f',
          ],
          { signal: controller.signal },
        );
        await this.execGit(
          [
            '--git-dir=' + shadowRepo,
            '--work-tree=' + workspace.path,
            'clean',
            '-fd',
          ],
          { signal: controller.signal },
        );
        await this.execGit(
          [
            '--git-dir=' + shadowRepo,
            'update-ref',
            'HEAD',
            checkpoint.commitSha,
          ],
          { signal: controller.signal },
        );

        return {
          ok: true,
          restoredFiles,
        };
      });
    } catch (err) {
      if (isTimedOut || (err instanceof Error && err.name === 'AbortError')) {
        throw new AppError('CHECKPOINT_FAILED', `Checkpoint rollback timed out after ${timeoutMs}ms`, {
          cause: err,
        });
      }
      throw err;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}
