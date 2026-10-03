import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import type {
  EnsureAlwaysProceedOptions,
  EnsureAlwaysProceedResult,
  SettingsPort,
  SettingsScope,
} from '../../services/ports/settings.port.js';
import { AppError } from '../../utils/errors.js';
import { loadProfile } from './profile/loader.js';
import type { AgyProfile } from './profile/schema.js';
import { expandPathTokens, homeEnvOverrides } from './paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function getDefaultProfile(): AgyProfile {
  const candidates = [
    path.resolve(__dirname, '../../../agy-profile.json'),
    path.resolve(process.cwd(), 'backend/agy-profile.json'),
    path.resolve(process.cwd(), 'agy-profile.json'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return loadProfile(candidate);
    }
  }
  throw new AppError('NOT_FOUND', 'Unable to locate agy-profile.json');
}

export interface JsonFormatting {
  indent: string | number;
  newline: '\r\n' | '\n';
  trailingNewline: boolean;
}

/**
 * Detects indentation and newline formatting from a raw JSON string.
 */
export function detectJsonFormatting(raw: string): JsonFormatting {
  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  const trailingNewline = raw.endsWith('\n');

  const lines = raw.split(/\r?\n/);
  let indent: string | number = 2;

  for (const line of lines) {
    if (line.startsWith('\t')) {
      indent = '\t';
      break;
    }
    const match = line.match(/^( +)\S/);
    if (match) {
      const count = match[1].length;
      if (count === 2 || count === 4 || count === 8) {
        indent = count;
        break;
      }
    }
  }

  return { indent, newline, trailingNewline };
}

/**
 * Formats a JavaScript object into a JSON string using detected formatting.
 */
export function formatJson(data: unknown, formatting: JsonFormatting): string {
  let str = JSON.stringify(data, null, formatting.indent);
  if (formatting.newline === '\r\n') {
    str = str.replace(/\r?\n/g, '\r\n');
  }
  if (formatting.trailingNewline && !str.endsWith(formatting.newline)) {
    str += formatting.newline;
  }
  return str;
}

/**
 * Reads a value from an object using a dot-delimited jsonPath (e.g. "security.alwaysProceed").
 */
export function getByPath(obj: Record<string, unknown>, jsonPath: string): unknown {
  const parts = jsonPath.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === undefined || current === null || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Sets a value on an object using a dot-delimited jsonPath, creating intermediate objects as needed.
 * Returns true if the value was added or changed.
 */
export function setByPath(
  obj: Record<string, unknown>,
  jsonPath: string,
  value: unknown,
): boolean {
  const parts = jsonPath.split('.');
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const next = current[part];
    if (next === undefined || next === null || typeof next !== 'object' || Array.isArray(next)) {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }

  const lastPart = parts[parts.length - 1];
  const changed = current[lastPart] !== value;
  current[lastPart] = value;
  return changed;
}

/**
 * Resolves the absolute path for a settings file based on scope and profile settings files.
 */
export function resolveSettingsPath(
  scope: SettingsScope,
  profile: AgyProfile,
  options?: EnsureAlwaysProceedOptions,
): string | null {
  const fileConfig = profile.settings.files.find((f) => {
    if (scope === 'global') {
      return f.scope === 'global' || f.scope === 'user';
    }
    return f.scope === 'workspace';
  });

  if (!fileConfig) {
    return null;
  }

  const envOverrides = options?.homeDir ? homeEnvOverrides(options.homeDir) : undefined;
  let expanded = expandPathTokens(fileConfig.pathTemplate, envOverrides);

  const wsPath = options?.workspacePath || process.cwd();
  expanded = expanded.replaceAll('{{workspacePath}}', wsPath);

  return path.resolve(expanded);
}

/**
 * Atomically writes content to a file via a temp file in the same directory,
 * with one retry on failure.
 */
async function writeAtomicWithRetry(
  filePath: string,
  content: string,
): Promise<{ success: boolean; error?: Error }> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });

  const tempFile = path.join(
    dir,
    `.settings.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );

  const attempt = async () => {
    await fs.promises.writeFile(tempFile, content, 'utf-8');
    await fs.promises.rename(tempFile, filePath);
  };

  try {
    await attempt();
    return { success: true };
  } catch {
    try {
      if (fs.existsSync(tempFile)) {
        await fs.promises.unlink(tempFile);
      }
    } catch {
      // ignore: best-effort temp file cleanup
    }

    // Back off 50ms and retry once
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      await attempt();
      return { success: true };
    } catch (err2: unknown) {
      try {
        if (fs.existsSync(tempFile)) {
          await fs.promises.unlink(tempFile);
        }
      } catch {
        // ignore: best-effort temp file cleanup
      }
      return { success: false, error: err2 instanceof Error ? err2 : new Error(String(err2)) };
    }
  }
}

/**
 * Implementation of SettingsPort managing agy settings files.
 */
export class AgySettings implements SettingsPort {
  readonly profile: AgyProfile;

  constructor(profile?: AgyProfile) {
    this.profile = profile ?? getDefaultProfile();
  }

  /**
   * Ensure the settings for the given scope are configured to always proceed.
   * Reads existing settings -> sets alwaysProceed value -> writes temp file -> renames.
   * Retains all other fields; creates file if absent; retries once on write failure;
   * returns a warning on persistent failure instead of throwing.
   */
  async ensureAlwaysProceed(
    scope: SettingsScope,
    options?: EnsureAlwaysProceedOptions,
  ): Promise<EnsureAlwaysProceedResult> {
    const filePath = resolveSettingsPath(scope, this.profile, options);
    if (!filePath) {
      // The profile deliberately declares no settings file for this scope (e.g. workspace).
      return { updated: false, filePath: '' };
    }

    const jsonPath = this.profile.settings.alwaysProceed.jsonPath;
    const targetValue = this.profile.settings.alwaysProceed.value;

    let data: Record<string, unknown> = {};
    let formatting: JsonFormatting = {
      indent: 2,
      newline: process.platform === 'win32' ? '\r\n' : '\n',
      trailingNewline: true,
    };
    let existed = false;

    if (fs.existsSync(filePath)) {
      existed = true;
      try {
        const raw = await fs.promises.readFile(filePath, 'utf-8');
        formatting = detectJsonFormatting(raw);
        data = JSON.parse(raw);
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
          data = {};
        }
      } catch (err: unknown) {
        return {
          updated: false,
          filePath,
          warning: `Failed to read or parse existing settings file at ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    const changed = setByPath(data, jsonPath, targetValue);

    // If the file already existed and the target value was already set, no write is necessary
    if (existed && !changed) {
      return {
        updated: false,
        filePath,
      };
    }

    const jsonString = formatJson(data, formatting);
    const writeResult = await writeAtomicWithRetry(filePath, jsonString);

    if (!writeResult.success) {
      return {
        updated: false,
        filePath,
        warning: `Failed to write settings file at ${filePath}: ${writeResult.error?.message}`,
      };
    }

    return {
      updated: true,
      filePath,
    };
  }

  /**
   * Install the statusline bridge hook into the settings file.
   */
  async installStatusline(_homeDir?: string): Promise<void> {
    // Placeholder for module 1.16; ensures SettingsPort contract is fulfilled
  }

  /**
   * Uninstall the statusline bridge hook and restore previous settings.
   */
  async uninstallStatusline(_homeDir?: string): Promise<void> {
    // Placeholder for module 1.16; ensures SettingsPort contract is fulfilled
  }
}
