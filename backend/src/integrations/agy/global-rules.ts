import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expandPathTokens, homeEnvOverrides } from './paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Repo-root bundled rule (shared with antigravity-pojia layout). */
function resolveBundledGlobalRulePath(): string {
  const candidates = [
    path.resolve(__dirname, '../../../../rules/global/AGENTS.md'),
    path.resolve(__dirname, '../../../bundled/global-rules/AGENTS.md'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return candidates[0];
}

export const BUNDLED_GLOBAL_RULE = resolveBundledGlobalRulePath();

const GLOBAL_RULE_TEMPLATE = '%USERPROFILE%\\.gemini\\config\\AGENTS.md';

export interface EnsureGlobalRulesResult {
  ok: boolean;
  path: string;
  updated: boolean;
  error?: string;
  warning?: string;
}

function resolveGlobalRulePath(homeDir?: string): string {
  const overrides = homeDir ? homeEnvOverrides(homeDir) : undefined;
  return path.resolve(expandPathTokens(GLOBAL_RULE_TEMPLATE, overrides));
}

async function writeAtomic(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });
  const tempFile = path.join(
    dir,
    `.agents.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
  );
  await fs.promises.writeFile(tempFile, content, 'utf-8');
  await fs.promises.rename(tempFile, filePath);
}

/**
 * Install / refresh the bundled global AGENTS.md into ~/.gemini/config/ so every
 * agy session (Studio, CLI, IDE) inherits the same always-on rules.
 */
export async function ensureGlobalRules(homeDir?: string): Promise<EnsureGlobalRulesResult> {
  const dest = resolveGlobalRulePath(homeDir);

  if (!fs.existsSync(BUNDLED_GLOBAL_RULE)) {
    return {
      ok: false,
      path: dest,
      updated: false,
      error: `missing bundled global rule: ${BUNDLED_GLOBAL_RULE}`,
    };
  }

  const src = await fs.promises.readFile(BUNDLED_GLOBAL_RULE, 'utf-8');
  if (src.length > 24_000) {
    return {
      ok: false,
      path: dest,
      updated: false,
      warning: `bundled global rule exceeds Antigravity 24KB per-file cap (${src.length} bytes)`,
    };
  }

  let prev: string | null = null;
  try {
    prev = await fs.promises.readFile(dest, 'utf-8');
  } catch {
    prev = null;
  }

  if (prev === src) {
    return { ok: true, path: dest, updated: false };
  }

  try {
    await writeAtomic(dest, src);
    return { ok: true, path: dest, updated: true };
  } catch (err: unknown) {
    return {
      ok: false,
      path: dest,
      updated: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** Default user profile global rule path (no isolated home). */
export function defaultGlobalRulePath(): string {
  return resolveGlobalRulePath(os.homedir());
}
