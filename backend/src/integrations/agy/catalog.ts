import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFile, spawnSync } from 'node:child_process';
import type { AgentMode, Model, ModelGroup } from '@agy-studio/contracts';
import type { ModelCatalogPort } from '../../services/ports/model-catalog.port.js';
import type { AgyProfile } from './profile/schema.js';
import { AppError } from '../../utils/errors.js';
import { getDefaultProfile } from './settings.js';

export type CommandExecutor = (
  bin: string,
  argv: string[],
) => Promise<{ stdout: string; stderr: string }>;

const defaultCommandExecutor: CommandExecutor = (bin: string, argv: string[]) => {
  // Only .cmd/.bat shims need a shell on Windows. With a shell the command line is joined
  // unescaped, so an unquoted path such as C:\Users\John Smith\...\agy.exe would be split at
  // the space.
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
  return new Promise((resolve, reject) => {
    execFile(
      needsShell ? `"${bin}"` : bin,
      argv,
      {
        encoding: 'utf-8',
        windowsHide: true,
        shell: needsShell,
        timeout: 20_000,
      },
      (err, stdout, stderr) => {
        if (err) {
          const execErr = err as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
          execErr.stdout = stdout ?? execErr.stdout;
          execErr.stderr = stderr ?? execErr.stderr;
          reject(execErr);
        } else {
          resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
        }
      },
    );
  });
};

function catalogCommandError(err: unknown, action: string): AppError {
  const e = err as { message?: string; stdout?: string; stderr?: string };
  const text = [e.message, e.stdout, e.stderr].filter(Boolean).join('\n');
  if (/please sign in/i.test(text) || /sign in to view/i.test(text)) {
    return new AppError(
      'AGY_NOT_AUTHENTICATED',
      'Agy CLI is not signed in; open Accounts and log in, or launch agy to sign in',
      { cause: err },
    );
  }
  return new AppError('AGY_NOT_INSTALLED', `Failed to execute ${action}: ${text}`, { cause: err });
}

/**
 * Searches for a usable agy binary from candidate paths, AGY_BIN, or PATH.
 */
export function findAgyBinary(profile: AgyProfile, explicitBin?: string): string | null {
  if (explicitBin) {
    if (fs.existsSync(explicitBin)) {
      return path.resolve(explicitBin);
    }
    // Check if explicitBin is resolvable via PATH
    try {
      const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [explicitBin], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
        shell: true,
      });
      if (probe.status === 0 && probe.stdout) {
        const firstLine = probe.stdout.split(/\r?\n/)[0]?.trim();
        if (firstLine && fs.existsSync(firstLine)) {
          return path.resolve(firstLine);
        }
      }
    } catch {}
    return null;
  }

  if (process.env.AGY_BIN) {
    if (fs.existsSync(process.env.AGY_BIN)) {
      return path.resolve(process.env.AGY_BIN);
    }
  }

  for (const candidate of profile.binary.candidates) {
    let expanded = candidate;
    if (process.platform === 'win32') {
      expanded = candidate.replace(/%([^%]+)%/g, (_, name) => process.env[name] ?? '');
    }

    if (path.isAbsolute(expanded) || expanded.includes('/') || expanded.includes('\\')) {
      if (fs.existsSync(expanded)) {
        return path.resolve(expanded);
      }
    } else {
      try {
        const probe = spawnSync(process.platform === 'win32' ? 'where' : 'which', [expanded], {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'ignore'],
          shell: true,
        });
        if (probe.status === 0 && probe.stdout) {
          const firstLine = probe.stdout.split(/\r?\n/)[0]?.trim();
          if (firstLine && fs.existsSync(firstLine)) {
            return path.resolve(firstLine);
          }
        }
      } catch {}
    }
  }

  return null;
}

/**
 * Parses version string from raw `agy --version` output.
 */
export function parseVersionOutput(rawOutput: string): string | null {
  const match = rawOutput.match(/\b(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.]+)?)\b/);
  return match ? match[1] : null;
}

/**
 * Parses model list output according to parser format (e.g. text-v1).
 * Group rule: ID starting with 'gemini' -> 'gemini', otherwise 'third_party'.
 * isDefault defaults to false.
 */
export function parseModelsOutput(rawOutput: string, parser: string = 'text-v1'): Model[] {
  if (parser !== 'text-v1') {
    throw new AppError('BAD_REQUEST', `Unsupported modelsParser: "${parser}"`);
  }

  const lines = rawOutput.split(/\r?\n/);
  const models: Model[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const lower = trimmed.toLowerCase();
    if (
      lower.startsWith('fetching') ||
      lower.startsWith('listing') ||
      lower.includes('available models') ||
      lower.startsWith('usage:') ||
      lower.startsWith('available subcommands:')
    ) {
      continue;
    }

    const match = trimmed.match(/^(\S+)(?:[\t\s]+(.+))?$/);
    if (!match) continue;

    const id = match[1];
    const label = match[2]?.trim() || id;
    const group: ModelGroup = id.startsWith('gemini') ? 'gemini' : 'third_party';

    models.push({
      id,
      label,
      group,
      isDefault: false,
    });
  }

  return models;
}

export interface AgyCatalogOptions {
  profile?: AgyProfile;
  defaultBin?: string;
  executor?: CommandExecutor;
}

/**
 * Implements ModelCatalogPort by interfacing with the agy CLI.
 */
export class AgyCatalog implements ModelCatalogPort {
  readonly profile: AgyProfile;
  readonly defaultBin?: string;
  private readonly executor: CommandExecutor;

  constructor(options?: AgyCatalogOptions | AgyProfile, defaultBin?: string) {
    if (options && 'catalog' in options) {
      this.profile = options as AgyProfile;
      this.defaultBin = defaultBin;
      this.executor = defaultCommandExecutor;
    } else {
      const opts = options as AgyCatalogOptions | undefined;
      this.profile = opts?.profile ?? getDefaultProfile();
      this.defaultBin = opts?.defaultBin ?? defaultBin;
      this.executor = opts?.executor ?? defaultCommandExecutor;
    }
  }

  async listModels(bin?: string): Promise<Model[]> {
    const targetBin = findAgyBinary(this.profile, bin ?? this.defaultBin);
    if (!targetBin) {
      throw new AppError('AGY_NOT_INSTALLED', 'Agy CLI is not installed or executable not found');
    }

    const argv = this.profile.catalog?.modelsArgv ?? ['models'];
    let stdout: string;
    try {
      const res = await this.executor(targetBin, argv);
      stdout = res.stdout;
    } catch (err: any) {
      throw catalogCommandError(err, 'agy models');
    }

    return parseModelsOutput(stdout, this.profile.catalog?.modelsParser ?? 'text-v1');
  }

  async getVersion(bin?: string): Promise<string | null> {
    const targetBin = findAgyBinary(this.profile, bin ?? this.defaultBin);
    if (!targetBin) {
      return null;
    }

    const argv = this.profile.catalog?.versionArgv ?? ['--version'];
    try {
      const res = await this.executor(targetBin, argv);
      const raw = (res.stdout || res.stderr || '').trim();
      return parseVersionOutput(raw);
    } catch {
      return null;
    }
  }

  async listModes(): Promise<AgentMode[]> {
    return [...(this.profile.catalog?.modes ?? [])];
  }
}
