import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { buildIsolatedEnv, evaluateIsolation } from './isolation-test.js';

describe('isolation-test 账号隔离与沙箱落盘探测', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-isolation-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('buildIsolatedEnv 能建立完备的沙箱目录并重定向环境变量', () => {
    const { env, dirs } = buildIsolatedEnv(tempDir);

    expect(fs.existsSync(dirs.home)).toBe(true);
    expect(fs.existsSync(dirs.appdata)).toBe(true);
    expect(fs.existsSync(dirs.localappdata)).toBe(true);

    expect(env.USERPROFILE).toBe(dirs.home);
    expect(env.HOME).toBe(dirs.home);
    expect(env.APPDATA).toBe(dirs.appdata);
    expect(env.LOCALAPPDATA).toBe(dirs.localappdata);
  });

  it('evaluateIsolation 当凭据泄漏至全局 wincred 时降级为 credential_snapshot', () => {
    const conclusion = evaluateIsolation(
      ['home/.antigravity/settings.json'],
      ['LegacyGeneric:target=gemini:antigravity'], // 全局凭据新增
      false
    );

    expect(conclusion.supportsIsolatedHome).toBe(false);
    expect(conclusion.preferredIsolation).toBe('credential_snapshot');
    expect(conclusion.reason).toContain('Windows 凭据管理器');
  });

  it('evaluateIsolation 当沙箱内部产出文件且无全局泄漏时推荐 isolated_home', () => {
    const conclusion = evaluateIsolation(
      ['home/.antigravity/settings.json', 'localappdata/agy/data.db'],
      [], // 无系统凭据污染
      false
    );

    expect(conclusion.supportsIsolatedHome).toBe(true);
    expect(conclusion.preferredIsolation).toBe('isolated_home');
  });
});
