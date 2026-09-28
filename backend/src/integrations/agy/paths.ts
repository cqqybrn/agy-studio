import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AppError } from '../../utils/errors.js';
import { loadProfile } from './profile/loader.js';
import type { PathsConfig } from './profile/schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONVERSATION_ID_TOKEN = '{{conversationId}}';

export interface PathResolveOptions {
  /** An already expanded data root (one of profile.paths.dataRoots). */
  dataRoot?: string;
  /** Account home used in place of %USERPROFILE% (isolated_home mode). */
  homeDir?: string;
}

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
 * Expands %ENV_VAR% tokens in path strings.
 */
export function expandPathTokens(template: string, envOverrides?: Record<string, string>): string {
  return template.replace(/%([^%]+)%/g, (_, varName) => {
    if (envOverrides && envOverrides[varName] !== undefined) {
      return envOverrides[varName];
    }
    if (process.env[varName] !== undefined) {
      return process.env[varName]!;
    }
    if (varName === 'USERPROFILE' || varName === 'HOME') {
      return process.env.USERPROFILE || process.env.HOME || os.homedir();
    }
    if (varName === 'LOCALAPPDATA') {
      const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
      return process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
    }
    if (varName === 'APPDATA') {
      const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
      return process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    }
    return '';
  });
}

/**
 * Environment overrides that relocate %USERPROFILE%-style tokens to an account home.
 */
export function homeEnvOverrides(homeDir: string): Record<string, string> {
  return {
    USERPROFILE: homeDir,
    HOME: homeDir,
    LOCALAPPDATA: path.join(homeDir, 'AppData', 'Local'),
    APPDATA: path.join(homeDir, 'AppData', 'Roaming'),
  };
}

function joinRel(base: string, relPath: string): string {
  return path.join(base, ...relPath.split(/[\\/]+/).filter((p) => p.length > 0));
}

/**
 * Expands profile.paths.dataRoots, optionally relative to an account home.
 */
export function resolveDataRoots(paths: PathsConfig, homeDir?: string): string[] {
  const overrides = homeDir ? homeEnvOverrides(homeDir) : undefined;
  return paths.dataRoots.map((root) => path.resolve(expandPathTokens(root, overrides)));
}

/**
 * conversationDirPattern relative to dataRoots[0], e.g. "brain/{{conversationId}}".
 */
function conversationDirRelPattern(paths: PathsConfig): string {
  const pattern = paths.conversationDirPattern.replace(/\\/g, '/');
  const root = paths.dataRoots[0].replace(/\\/g, '/').replace(/\/+$/, '');
  if (!pattern.toLowerCase().startsWith(root.toLowerCase() + '/')) {
    throw new AppError(
      'BAD_REQUEST',
      `conversationDirPattern "${paths.conversationDirPattern}" is not located under dataRoots[0] "${paths.dataRoots[0]}"`,
    );
  }
  const rel = pattern.slice(root.length + 1);
  if (path.posix.basename(rel) !== CONVERSATION_ID_TOKEN) {
    throw new AppError(
      'BAD_REQUEST',
      `conversationDirPattern "${paths.conversationDirPattern}" must end with ${CONVERSATION_ID_TOKEN}`,
    );
  }
  return rel;
}

/**
 * Directory, relative to a data root, holding one sub-directory per conversation (e.g. "brain").
 */
export function conversationsParentRel(paths: PathsConfig): string {
  return path.posix.dirname(conversationDirRelPattern(paths));
}

/**
 * Resolves the directory for a specific conversation ID.
 */
export function resolveConversationDir(
  conversationId: string,
  options: PathResolveOptions | undefined,
  paths: PathsConfig,
): string {
  if (options?.homeDir) {
    const expanded = expandPathTokens(paths.conversationDirPattern, homeEnvOverrides(options.homeDir));
    return path.resolve(expanded.replace(CONVERSATION_ID_TOKEN, conversationId));
  }
  if (options?.dataRoot) {
    const rel = conversationDirRelPattern(paths).replace(CONVERSATION_ID_TOKEN, conversationId);
    return joinRel(options.dataRoot, rel);
  }
  return path.resolve(
    expandPathTokens(paths.conversationDirPattern).replace(CONVERSATION_ID_TOKEN, conversationId),
  );
}

/**
 * Resolves the absolute path to a conversation's transcript file.
 */
export function resolveTranscriptPath(
  conversationId: string,
  options: PathResolveOptions | undefined,
  paths: PathsConfig,
): string {
  return joinRel(resolveConversationDir(conversationId, options, paths), paths.transcriptRelPath);
}
