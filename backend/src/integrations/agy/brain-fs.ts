import type {
  AgentEvent,
  TranscriptStep,
} from '@agy-studio/contracts';
import fs from 'node:fs';
import path from 'node:path';
import type {
  BrainPort,
  DiskConversationSummary,
  RunTranscriptHandle,
  RunTranscriptOptions,
  TranscriptTailHandle,
  TranscriptTailOptions,
} from '../../services/ports/brain.port.js';
import { AppError } from '../../utils/errors.js';
import { isUuid } from '../../utils/ids.js';
import {
  conversationsParentRel,
  expandPathTokens,
  getDefaultPaths,
  resolveConversationDbPaths,
  resolveConversationDir as resolveConversationDirFromProfile,
  resolveDataRoots,
  resolveTranscriptPath,
  type PathResolveOptions,
} from './paths.js';
import type { AgyProfile, PathsConfig } from './profile/schema.js';
import {
  extractSubagentConversationIds,
  parseLine,
  RunTranscriptMapper,
  tail,
} from './transcript.js';

export { getDefaultPaths, resolveDataRoots } from './paths.js';

/**
 * Replaces environment variables in path templates (%VAR%).
 */
export function expandPathEnvVars(template: string, envOverrides?: Record<string, string>): string {
  return expandPathTokens(template, envOverrides);
}

/**
 * Resolves the directory for a specific conversation ID.
 */
export function resolveConversationDir(
  conversationId: string,
  options?: PathResolveOptions,
  pathsConfig?: PathsConfig,
): string {
  return resolveConversationDirFromProfile(conversationId, options, pathsConfig || getDefaultPaths());
}

/**
 * Extracts a conversation title from a user-input transcript step.
 * Real agy wraps the prompt in <USER_REQUEST>…</USER_REQUEST> followed by metadata blocks.
 */
function titleFromUserStep(content: string): string {
  const match = content.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
  const text = match ? match[1] : content;
  return text.replace(/[\r\n]+/g, ' ').trim().slice(0, 50);
}

const USER_STEP_TYPES = new Set(['user', 'user_input', 'user_message']);

/**
 * Safely purge a conversation and its subagent conversations: brain\<id>\ and
 * conversations\<id>.db / .db-shm / .db-wal under every data root (or only the given one).
 * Enforces strict UUID format, directory boundary inside dataRoot, and rejects symlinks.
 * Supports both purgeConversation(conversationId, dataRoot) and purgeConversation(dataRoot, id).
 */
export async function purgeConversation(
  arg1: string,
  arg2?: string,
  pathsConfig?: PathsConfig,
): Promise<void> {
  let conversationId: string;
  let dataRoot: string | undefined;

  if (isUuid(arg1)) {
    conversationId = arg1;
    dataRoot = arg2;
  } else if (arg2 && isUuid(arg2)) {
    dataRoot = arg1;
    conversationId = arg2;
  } else {
    conversationId = arg1;
    dataRoot = arg2;
  }

  // 1. Only UUID format allowed
  if (!conversationId || !isUuid(conversationId)) {
    throw new AppError(
      'BAD_REQUEST',
      `Invalid conversation id "${conversationId}". Only valid UUIDs are permitted.`,
      { details: { conversationId } },
    );
  }

  // Extra safety: reject any path separator characters in id
  if (path.basename(conversationId) !== conversationId) {
    throw new AppError(
      'BAD_REQUEST',
      `Invalid conversation id "${conversationId}". Path separators are not allowed.`,
      { details: { conversationId } },
    );
  }

  const paths = pathsConfig || getDefaultPaths();
  const roots = dataRoot ? [dataRoot] : resolveDataRoots(paths);

  // 2. Collect the conversation plus its subagent conversations (recursively, cycle-safe)
  const ids = await collectConversationTree(conversationId, roots, paths);

  // 3. Delete brain\<id>\ and conversations\<id>.db* under every data root
  for (const id of ids) {
    for (const root of roots) {
      const targetDir = resolveConversationDir(id, { dataRoot: root }, paths);
      await removeInsideRoot(targetDir, root, id, 'dir');
      for (const dbFile of resolveConversationDbPaths(id, root)) {
        await removeInsideRoot(dbFile, root, id, 'file');
      }
    }
  }
}

async function collectConversationTree(
  rootId: string,
  roots: string[],
  paths: PathsConfig,
): Promise<string[]> {
  const seen = new Set<string>([rootId.toLowerCase()]);
  const ordered = [rootId];
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const root of roots) {
      const transcriptFile = resolveTranscriptPath(id, { dataRoot: root }, paths);
      let text: string;
      try {
        const st = await fs.promises.lstat(resolveConversationDir(id, { dataRoot: root }, paths));
        if (st.isSymbolicLink()) continue;
        text = await fs.promises.readFile(transcriptFile, 'utf-8');
      } catch {
        continue;
      }
      for (const subId of extractSubagentConversationIds(text)) {
        const key = subId.toLowerCase();
        if (!isUuid(subId) || seen.has(key)) continue;
        seen.add(key);
        ordered.push(subId);
        queue.push(subId);
      }
    }
  }
  return ordered;
}

/**
 * Removes a conversation directory or db file, rejecting symlinks and anything resolving
 * outside the data root. Missing targets are ignored.
 */
async function removeInsideRoot(
  target: string,
  dataRoot: string,
  conversationId: string,
  kind: 'dir' | 'file',
): Promise<void> {
  let targetLstat: fs.Stats;
  try {
    targetLstat = await fs.promises.lstat(target);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return;
    }
    throw err;
  }

  if (targetLstat.isSymbolicLink()) {
    throw new AppError(
      'PATH_OUTSIDE_WORKSPACE',
      `Refusing to delete conversation data: target is a symbolic link "${target}".`,
      { details: { conversationId, target } },
    );
  }
  if (kind === 'dir' ? !targetLstat.isDirectory() : !targetLstat.isFile()) {
    return;
  }

  const realTarget = await fs.promises.realpath(target);
  let realRoot: string;
  try {
    realRoot = await fs.promises.realpath(dataRoot);
  } catch {
    realRoot = path.resolve(dataRoot);
  }

  const relative = path.relative(realRoot, realTarget);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError(
      'PATH_OUTSIDE_WORKSPACE',
      `Target "${realTarget}" is not contained within data root "${realRoot}".`,
      { details: { conversationId, target: realTarget, dataRoot: realRoot } },
    );
  }

  await fs.promises.rm(target, { recursive: kind === 'dir', force: true });
}

export class BrainFs implements BrainPort {
  readonly paths: PathsConfig;
  private readonly profile?: AgyProfile;

  constructor(profileOrPaths?: AgyProfile | PathsConfig) {
    if (profileOrPaths) {
      if ('paths' in profileOrPaths) {
        this.paths = profileOrPaths.paths;
        this.profile = profileOrPaths;
      } else {
        this.paths = profileOrPaths;
      }
    } else {
      this.paths = getDefaultPaths();
    }
  }

  resolveConversationDir(
    conversationId: string,
    options?: { dataRoot?: string; homeDir?: string },
  ): string {
    return resolveConversationDir(conversationId, options, this.paths);
  }

  /**
   * List conversations recorded on disk under data root(s): brain\<uuid> of every profile data root
   * (agy CLI, then the IDE), or only the given dataRoot. The same id is reported once.
   * In isolated_home mode, dataRoot may be specific to an account's home.
   */
  async listConversations(dataRoot?: string): Promise<DiskConversationSummary[]> {
    const roots = dataRoot ? [dataRoot] : resolveDataRoots(this.paths);
    const parentRel = conversationsParentRel(this.paths);
    const summaryMap = new Map<string, DiskConversationSummary>();

    for (const root of roots) {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(path.join(root, parentRel), { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const convId = entry.name;
        if (!isUuid(convId)) continue;
        // Roots are scanned in profile order (agy CLI first); the first occurrence of an id wins
        if (summaryMap.has(convId)) continue;

        const convFullPath = this.resolveConversationDir(convId, { dataRoot: root });
        const transcriptFile = resolveTranscriptPath(convId, { dataRoot: root }, this.paths);

        let title = 'Untitled';
        let createdAt: string;
        let updatedAt: string;

        if (fs.existsSync(transcriptFile)) {
          try {
            const stat = await fs.promises.stat(transcriptFile);
            const raw = await fs.promises.readFile(transcriptFile, 'utf-8');
            const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

            let firstStep: TranscriptStep | null = null;
            let lastStep: TranscriptStep | null = null;

            for (const line of lines) {
              const step = parseLine(line);
              if (step) {
                if (!firstStep) firstStep = step;
                lastStep = step;
                if (
                  title === 'Untitled' &&
                  USER_STEP_TYPES.has(step.type.toLowerCase()) &&
                  step.content
                ) {
                  title = titleFromUserStep(step.content) || 'Untitled';
                }
              }
            }

            const birthtimeIso =
              stat.birthtimeMs > 0 ? stat.birthtime.toISOString() : stat.mtime.toISOString();
            createdAt = firstStep?.createdAt || birthtimeIso;
            updatedAt = lastStep?.createdAt || stat.mtime.toISOString();
          } catch {
            const dirStat = await fs.promises.stat(convFullPath);
            const birthtimeIso =
              dirStat.birthtimeMs > 0 ? dirStat.birthtime.toISOString() : dirStat.mtime.toISOString();
            createdAt = birthtimeIso;
            updatedAt = dirStat.mtime.toISOString();
          }
        } else {
          const dirStat = await fs.promises.stat(convFullPath);
          const birthtimeIso =
            dirStat.birthtimeMs > 0 ? dirStat.birthtime.toISOString() : dirStat.mtime.toISOString();
          createdAt = birthtimeIso;
          updatedAt = dirStat.mtime.toISOString();
        }

        summaryMap.set(convId, {
          id: convId,
          title,
          createdAt,
          updatedAt,
        });
      }
    }

    const summaries = Array.from(summaryMap.values());
    summaries.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    return summaries;
  }

  /**
   * Tail a conversation's transcript incrementally from disk.
   */
  async tailTranscript(
    conversationId: string,
    options?: TranscriptTailOptions,
    dataRoot?: string,
  ): Promise<TranscriptTailHandle> {
    return tail(
      conversationId,
      {
        fromStep: options?.fromStep,
        dataRoot,
      },
      this.paths,
    );
  }

  /**
   * Follow the main conversation's transcript for one run, mapped to timeline events.
   */
  async followRunTranscript(
    conversationId: string,
    options: RunTranscriptOptions,
    dataRoot?: string,
  ): Promise<RunTranscriptHandle> {
    const handle = tail(conversationId, { dataRoot }, this.paths);
    const mapper = new RunTranscriptMapper({ ...options, profile: this.profile });

    async function* batches(): AsyncGenerator<AgentEvent[], void, unknown> {
      for await (const step of handle.steps) {
        yield mapper.push(step);
      }
    }

    return { batches: batches(), stop: () => handle.stop() };
  }

  /**
   * Purge a conversation (brain dir, conversations\<id>.db*, subagent conversations) from disk.
   * Enforces strict UUID and directory boundary checks.
   */
  async purgeConversation(conversationId: string, dataRoot?: string): Promise<void> {
    return purgeConversation(conversationId, dataRoot, this.paths);
  }
}
