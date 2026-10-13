import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BUNDLED_GLOBAL_RULE,
  ensureGlobalRules,
} from '../../src/integrations/agy/global-rules.js';

describe('ensureGlobalRules', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-global-rules-'));
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('installs bundled AGENTS.md under isolated home', async () => {
    const dest = path.join(tmpHome, '.gemini', 'config', 'AGENTS.md');
    expect(fs.existsSync(dest)).toBe(false);

    const r = await ensureGlobalRules(tmpHome);
    expect(r.ok).toBe(true);
    expect(r.updated).toBe(true);
    expect(r.path).toBe(dest);
    expect(fs.readFileSync(dest, 'utf-8')).toBe(fs.readFileSync(BUNDLED_GLOBAL_RULE, 'utf-8'));
    expect(fs.readFileSync(dest, 'utf-8')).toContain('HANSHUANG-AGY-INJECT');

    const again = await ensureGlobalRules(tmpHome);
    expect(again.ok).toBe(true);
    expect(again.updated).toBe(false);
  });
});
