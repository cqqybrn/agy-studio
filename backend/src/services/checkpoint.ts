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

  /** Resolves when the queue for the workspace (or every workspace) has drained. */
  async whenIdle(workspaceId?: string): Promise<void> {
    for (;;) {
      const pending = workspaceId
        ? [this.tails.get(workspaceId)].filter((p): p is Promise<void> => !!p)
        : [...this.tails.values()];
      if (pending.length === 0) return;
      await Promise.allSettled(pending);
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
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 3_000;
    this.logger = options.logger;
  }

  /**
   * Invokes git subprocess directly via execFile (never via shell).
   *
   * An aborted `signal` only prevents the *next* git step from starting; a running git is never
   * killed. Killing git mid-write leaves `index.lock` behind (breaking every later operation) and,
   * during rollback, would leave the user's workspace half-restored.
   */
  private async execGit(
    args: string[],
    options?: ExecGitOptions,
  ): Promise<{ stdout: string; stderr: string }> {
    if (options?.signal?.aborted) {
      const err = new Error(String(options.signal.reason ?? 'Operation aborted'));
      err.name = 'AbortError';
      throw err;
    }
    return new Promise((resolve, reject) => {
      execFile(
        'git',
        args,
        {
          cwd: options?.cwd,
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

    // Callers hold the workspace mutex and every git step runs to completion, so no git can be
    // using this repo right now: a leftover lock comes from a crash or an older build that killed
    // git, and would otherwise make every later snapshot fail.
    const indexLock = path.join(shadowRepo, 'index.lock');
    if (fs.existsSync(indexLock)) {
      fs.rmSync(indexLock, { force: true });
      this.logger?.warn?.({ shadowRepo }, 'Removed stale index.lock from checkpoint shadow repo');
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
   * Resolves once every queued checkpoint operation (including a snapshot that timed out but is
   * still finishing in the background) has completed for the workspace, or for all workspaces.
   */
  whenIdle(workspaceId?: string): Promise<void> {
    return this.mutex.whenIdle(workspaceId);
  }

  /**
   * Captures a snapshot of the workspace into the shadow bare git repo.
   *
   * Resolves with null after timeoutMs (defaults to 3,000ms) so a run is never held up. The git
   * step already in progress keeps running under the workspace mutex: the first snapshot of a real
   * project can take tens of seconds on Windows, and letting it finish warms the shadow index so
   * later snapshots are fast. A snapshot that completes after its timeout is not recorded, because
   * the run may already have modified the workspace by then.
   */
  snapshot(
    workspaceId: string,
    sessionId: string,
    runId: string,
    options?: { timeoutMs?: number },
  ): Promise<Checkpoint | null> {
    const timeoutMs = options?.timeoutMs ?? this.defaultTimeoutMs;

    return new Promise<Checkpoint | null>((resolve, reject) => {
      let settled = false;
      const settle = (fn: () => void) => {
        if (!settled) {
          settled = true;
          fn();
        }
      };

      // The clock includes waiting for the workspace mutex: a previous snapshot still warming the
      // shadow index in the background must not hold up the next run either.
      const controller = new AbortController();
      let timer: NodeJS.Timeout | null = null;
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          controller.abort(new Error(`Checkpoint snapshot timed out after ${timeoutMs}ms`));
          this.logger?.warn?.(
            { workspaceId, sessionId, runId, timeoutMs },
            'Checkpoint snapshot timed out; continuing without checkpoint',
          );
          settle(() => resolve(null));
        }, timeoutMs);
      }

      this.mutex
        .runExclusive(workspaceId, async () => {
          // The caller already gave up while queued; the run has started, so this snapshot would
          // no longer reflect the pre-run state.
          if (controller.signal.aborted) return;

          try {
            const checkpoint = await this.captureSnapshot(
              workspaceId,
              sessionId,
              runId,
              controller.signal,
            );
            settle(() => resolve(checkpoint));
          } catch (err) {
            if (controller.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
              settle(() => resolve(null));
            } else if (err instanceof AppError && err.code === 'NOT_FOUND') {
              settle(() => reject(err));
            } else {
              this.logger?.error?.(
                { err, workspaceId, sessionId, runId },
                'Checkpoint snapshot failed; continuing without checkpoint',
              );
              settle(() => resolve(null));
            }
          } finally {
            if (timer) {
              clearTimeout(timer);
            }
          }
        })
        .catch((err) => settle(() => reject(err)));
    });
  }

  private async captureSnapshot(
    workspaceId: string,
    sessionId: string,
    runId: string,
    signal: AbortSignal,
  ): Promise<Checkpoint> {
    const workspace = this.workspacesRepo.findById(workspaceId);
    if (!workspace) {
      throw new AppError('NOT_FOUND', `Workspace ${workspaceId} not found`);
    }

    const shadowRepo = this.getShadowRepoPath(workspaceId);
    // Staging always runs to completion, even past the timeout: it only touches the shadow repo,
    // and it is what makes the next snapshot fast. Gating it would let a large workspace time out
    // at the same step forever.
    await this.ensureRepoInitialized(shadowRepo);
    await this.updateExcludeRules(shadowRepo, workspace.path);
    await this.execGit(['--git-dir=' + shadowRepo, '--work-tree=' + workspace.path, 'add', '-A']);

    await this.execGit(
      [
        '--git-dir=' + shadowRepo,
        '--work-tree=' + workspace.path,
        'commit',
        '-m',
        `checkpoint:${runId}`,
        '--allow-empty',
      ],
      { signal },
    );

    const { stdout: commitShaOut } = await this.execGit(
      ['--git-dir=' + shadowRepo, 'rev-parse', 'HEAD'],
      { signal },
    );
    const commitSha = commitShaOut.trim();

    const { stdout: statOut } = await this.execGit(
      ['--git-dir=' + shadowRepo, 'show', '--shortstat', '--format=', 'HEAD'],
      { signal },
    );
    const filesChanged = this.parseFilesChanged(statOut);

    // Finished after the caller gave up: the workspace may no longer be in its pre-run state.
    if (signal.aborted) {
      const err = new Error('Checkpoint snapshot finished after its timeout');
      err.name = 'AbortError';
      throw err;
    }

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
          // Clear intent-to-add from shadow index without affecting working tree (always, even
          // after a timeout, so the shadow index is left clean)
          try {
            await this.execGit(['--git-dir=' + shadowRepo, 'reset', 'HEAD']);
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

        // 3. Restore workspace to target snapshot state and clean untracked additions.
        // Last point at which a timeout may stop the rollback: the steps below rewrite the user's
        // files and must all run, otherwise the workspace is left half-restored.
        if (controller.signal.aborted) {
          const err = new Error(String(controller.signal.reason ?? 'Rollback aborted'));
          err.name = 'AbortError';
          throw err;
        }
        await this.execGit([
          '--git-dir=' + shadowRepo,
          '--work-tree=' + workspace.path,
          'read-tree',
          checkpoint.commitSha,
        ]);
        await this.execGit([
          '--git-dir=' + shadowRepo,
          '--work-tree=' + workspace.path,
          'checkout-index',
          '-a',
          '-f',
        ]);
        await this.execGit([
          '--git-dir=' + shadowRepo,
          '--work-tree=' + workspace.path,
          'clean',
          '-fd',
        ]);
        await this.execGit(['--git-dir=' + shadowRepo, 'update-ref', 'HEAD', checkpoint.commitSha]);

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
