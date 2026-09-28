import type {
  Artifact,
  ArtifactKind,
  TranscriptStep,
} from '@agy-studio/contracts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ArtifactWatchHandle,
  BrainPort,
  DiskConversationSummary,
  TranscriptTailHandle,
  TranscriptTailOptions,
} from '../../services/ports/brain.port.js';
import { AppError } from '../../utils/errors.js';
import { isUuid } from '../../utils/ids.js';
import { loadProfile } from './profile/loader.js';
import type { AgyProfile, PathsConfig } from './profile/schema.js';
import { expandPathTokens, parseLine, tail } from './transcript.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getDefaultPaths(): PathsConfig {
  const candidates = [
    path.resolve(__dirname, '../../../agy-profile.json'),
    path.resolve(process.cwd(), 'backend/agy-profile.json'),
    path.resolve(process.cwd(), 'agy-profile.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return loadProfile(candidate).paths;
    }
  }
  throw new AppError('NOT_FOUND', 'Unable to locate agy-profile.json');
}

/**
 * Replaces environment variables in path templates (%VAR%).
 */
export function expandPathEnvVars(template: string, envOverrides?: Record<string, string>): string {
  return expandPathTokens(template, envOverrides);
}

/**
 * Converts a glob pattern (with *, **, ?, {a,b}) to a regular expression.
 */
export function globToRegExp(pattern: string): RegExp {
  let p = pattern.replace(/\\/g, '/');
  // Handle brace expansion {a,b,c}
  p = p.replace(/\{([^{}]+)\}/g, (_, group) => {
    const choices = group.split(',').map((c: string) => c.trim()).join('|');
    return `(${choices})`;
  });

  let reStr = '';
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === '*' && p[i + 1] === '*') {
      // **
      if (p[i + 2] === '/') {
        reStr += '(?:.+/)?';
        i += 3;
      } else {
        reStr += '.*';
        i += 2;
      }
    } else if (c === '*') {
      reStr += '[^/]*';
      i++;
    } else if (c === '?') {
      reStr += '[^/]';
      i++;
    } else if ('()+{}[]^$|.\\'.includes(c)) {
      if (c === '(' || c === ')' || c === '|') {
        reStr += c;
      } else {
        reStr += '\\' + c;
      }
      i++;
    } else {
      reStr += c;
      i++;
    }
  }
  return new RegExp(`^${reStr}$`, 'i');
}

/**
 * Resolves the directory for a specific conversation ID.
 */
export function resolveConversationDir(
  conversationId: string,
  options?: { dataRoot?: string; homeDir?: string },
  pathsConfig?: PathsConfig,
): string {
  const paths = pathsConfig || getDefaultPaths();
  const rawPattern = paths.conversationDirPattern;

  if (options?.homeDir) {
    const envOverrides = {
      USERPROFILE: options.homeDir,
      HOME: options.homeDir,
      LOCALAPPDATA: path.join(options.homeDir, 'AppData', 'Local'),
      APPDATA: path.join(options.homeDir, 'AppData', 'Roaming'),
    };
    return expandPathTokens(rawPattern, envOverrides).replace('{{conversationId}}', conversationId);
  }

  if (options?.dataRoot) {
    const dataRoot = options.dataRoot;

    // Check if dataRoot is an account home (has .antigravity inside it)
    if (
      fs.existsSync(path.join(dataRoot, '.antigravity', 'conversations')) ||
      (fs.existsSync(path.join(dataRoot, '.antigravity')) && !fs.existsSync(path.join(dataRoot, 'conversations')))
    ) {
      const envOverrides = {
        USERPROFILE: dataRoot,
        HOME: dataRoot,
        LOCALAPPDATA: path.join(dataRoot, 'AppData', 'Local'),
        APPDATA: path.join(dataRoot, 'AppData', 'Roaming'),
      };
      return expandPathTokens(rawPattern, envOverrides).replace('{{conversationId}}', conversationId);
    }

    // Check if rawPattern starts with paths.dataRoots[0]
    const rootPattern = paths.dataRoots[0];
    const normalizedRaw = rawPattern.replace(/\\/g, '/');
    const normalizedRoot = rootPattern.replace(/\\/g, '/');

    if (normalizedRaw.startsWith(normalizedRoot)) {
      const relToRoot = normalizedRaw.slice(normalizedRoot.length).replace(/^\/+/, '');
      const substitutedRel = relToRoot.replace('{{conversationId}}', conversationId);
      return path.join(dataRoot, substitutedRel);
    }

    // If rawPattern does not start with dataRoots[0], expand it directly
    return expandPathTokens(rawPattern).replace('{{conversationId}}', conversationId);
  }

  return expandPathTokens(rawPattern).replace('{{conversationId}}', conversationId);
}

/**
 * Recursively walk all files in a directory.
 */
async function walkFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) {
          results.push(...(await walkFiles(fullPath)));
        }
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  } catch {
    // Ignore read errors
  }
  return results;
}

/**
 * Deduce mime type from extension.
 */
function guessMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.json':
      return 'application/json';
    case '.md':
    case '.markdown':
      return 'text/markdown';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.mp4':
      return 'video/mp4';
    case '.webm':
      return 'video/webm';
    case '.txt':
      return 'text/plain';
    case '.svg':
      return 'image/svg+xml';
    case '.pdf':
      return 'application/pdf';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Safely purge a conversation directory.
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
  const targetDir = resolveConversationDir(conversationId, { dataRoot }, paths);

  // 2. Existence check
  let targetLstat: fs.Stats;
  try {
    targetLstat = await fs.promises.lstat(targetDir);
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return; // Safe idempotent return when directory does not exist
    }
    throw err;
  }

  // 3. Reject symbolic link target
  if (targetLstat.isSymbolicLink()) {
    throw new AppError(
      'PATH_OUTSIDE_WORKSPACE',
      `Refusing to delete conversation directory: target is a symbolic link "${targetDir}".`,
      { details: { conversationId, targetDir } },
    );
  }

  // 4. Realpath boundary check
  let boundaryRoot = dataRoot;
  if (!boundaryRoot) {
    boundaryRoot = expandPathTokens(paths.dataRoots[0]);
  }

  const realTarget = await fs.promises.realpath(targetDir);
  let realRoot: string;
  try {
    realRoot = await fs.promises.realpath(boundaryRoot);
  } catch {
    realRoot = path.resolve(boundaryRoot);
  }

  const relative = path.relative(realRoot, realTarget);
  if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new AppError(
      'PATH_OUTSIDE_WORKSPACE',
      `Target directory "${realTarget}" is not contained within data root "${realRoot}".`,
      { details: { conversationId, targetDir: realTarget, dataRoot: realRoot } },
    );
  }

  // 5. Safe deletion
  await fs.promises.rm(targetDir, { recursive: true, force: true });
}

export class BrainFs implements BrainPort {
  readonly paths: PathsConfig;

  constructor(profileOrPaths?: AgyProfile | PathsConfig) {
    if (profileOrPaths) {
      if ('paths' in profileOrPaths) {
        this.paths = profileOrPaths.paths;
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
   * List conversations recorded on disk under data root(s).
   * In isolated_home mode, dataRoot may be specific to an account's home.
   */
  async listConversations(dataRoot?: string): Promise<DiskConversationSummary[]> {
    const dirsToScan: string[] = [];

    if (dataRoot) {
      if (fs.existsSync(path.join(dataRoot, 'conversations'))) {
        dirsToScan.push(path.join(dataRoot, 'conversations'));
      }
      if (fs.existsSync(path.join(dataRoot, '.antigravity', 'conversations'))) {
        dirsToScan.push(path.join(dataRoot, '.antigravity', 'conversations'));
      }
      if (dirsToScan.length === 0 && fs.existsSync(dataRoot)) {
        try {
          const entries = await fs.promises.readdir(dataRoot, { withFileTypes: true });
          if (entries.some((e) => (e.isDirectory() || e.isSymbolicLink()) && isUuid(e.name))) {
            dirsToScan.push(dataRoot);
          }
        } catch {}
      }
    } else {
      for (const root of this.paths.dataRoots) {
        const expanded = expandPathTokens(root);
        const convDir = path.join(expanded, 'conversations');
        if (fs.existsSync(convDir)) {
          dirsToScan.push(convDir);
        }
      }
    }

    const summaryMap = new Map<string, DiskConversationSummary>();

    for (const convParentDir of dirsToScan) {
      let entries: fs.Dirent[];
      try {
        entries = await fs.promises.readdir(convParentDir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
        const convId = entry.name;
        if (!isUuid(convId)) continue;

        const convFullPath = path.join(convParentDir, convId);
        const transcriptFile = path.join(
          convFullPath,
          this.paths.transcriptRelPath || 'transcript.jsonl',
        );

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
                  (step.type === 'user' ||
                    step.type === 'user_input' ||
                    step.type === 'user_message') &&
                  step.content
                ) {
                  const singleLine = step.content.replace(/[\r\n]+/g, ' ').trim();
                  title = singleLine.slice(0, 50);
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

        const existing = summaryMap.get(convId);
        if (!existing || new Date(updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
          summaryMap.set(convId, {
            id: convId,
            title,
            createdAt,
            updatedAt,
          });
        }
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
   * List artifacts for a specific conversation / session directory.
   */
  async listArtifacts(
    conversationId: string,
    sessionId: string,
    dataRoot?: string,
  ): Promise<Artifact[]> {
    const convDir = this.resolveConversationDir(conversationId, { dataRoot });
    if (!fs.existsSync(convDir)) {
      return [];
    }

    const files = await walkFiles(convDir);
    const artifacts: Artifact[] = [];
    const transcriptRel = (this.paths.transcriptRelPath || 'transcript.jsonl').replace(/\\/g, '/');

    for (const file of files) {
      const relPath = path.relative(convDir, file).replace(/\\/g, '/');
      if (relPath === transcriptRel || relPath.endsWith('/' + transcriptRel)) {
        continue;
      }
      if (relPath.startsWith('.') || relPath.includes('/.')) {
        continue;
      }

      let kind: ArtifactKind | null = null;
      let mimeType: string | undefined;

      for (const rule of this.paths.artifactRules) {
        const regex = globToRegExp(rule.glob);
        if (regex.test(relPath)) {
          kind = rule.kind as ArtifactKind;
          mimeType = rule.mimeType;
          break;
        }
      }

      if (!kind) {
        if (relPath.startsWith('artifacts/')) {
          kind = 'other';
        } else {
          continue;
        }
      }

      const stat = await fs.promises.stat(file);
      const finalMime = mimeType || guessMimeType(relPath);
      const id = Buffer.from(`${conversationId}/${relPath}`).toString('base64url');
      const name = path.basename(file);

      artifacts.push({
        id,
        sessionId,
        conversationId,
        kind,
        name,
        relativePath: relPath,
        mimeType: finalMime,
        size: stat.size,
        version: 1,
        updatedAt: stat.mtime.toISOString(),
      });
    }

    artifacts.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
    return artifacts;
  }

  /**
   * Watch artifacts within a conversation directory, invoking onChange when updated.
   */
  async watchArtifacts(
    conversationId: string,
    sessionId: string,
    onChange: (artifact: Artifact) => void,
    dataRoot?: string,
  ): Promise<ArtifactWatchHandle> {
    let stopped = false;
    let timer: NodeJS.Timeout | null = null;
    const versionMap = new Map<string, number>();
    const statMap = new Map<string, { mtimeMs: number; size: number }>();

    const check = async () => {
      if (stopped) return;
      try {
        const artifacts = await this.listArtifacts(conversationId, sessionId, dataRoot);
        for (const artifact of artifacts) {
          if (stopped) break;
          const currentMtime = new Date(artifact.updatedAt).getTime();
          const prev = statMap.get(artifact.id);

          if (!prev) {
            versionMap.set(artifact.id, 1);
            statMap.set(artifact.id, { mtimeMs: currentMtime, size: artifact.size });
            artifact.version = 1;
            onChange(artifact);
          } else if (prev.mtimeMs !== currentMtime || prev.size !== artifact.size) {
            const nextVer = (versionMap.get(artifact.id) ?? 1) + 1;
            versionMap.set(artifact.id, nextVer);
            statMap.set(artifact.id, { mtimeMs: currentMtime, size: artifact.size });
            artifact.version = nextVer;
            onChange(artifact);
          }
        }
      } catch {
        // Ignore transient reading errors during watch
      }
    };

    // Immediate scan
    await check();

    const intervalMs = 300;
    const scheduleNext = () => {
      if (stopped) return;
      timer = setTimeout(async () => {
        timer = null;
        await check();
        if (!stopped) {
          scheduleNext();
        }
      }, intervalMs);
    };

    scheduleNext();

    return {
      stop() {
        if (stopped) return;
        stopped = true;
        if (timer !== null) {
          clearTimeout(timer);
          timer = null;
        }
      },
    };
  }

  /**
   * Purge conversation directory from disk.
   * Enforces strict UUID and directory boundary checks.
   */
  async purgeConversation(conversationId: string, dataRoot?: string): Promise<void> {
    return purgeConversation(conversationId, dataRoot, this.paths);
  }
}
