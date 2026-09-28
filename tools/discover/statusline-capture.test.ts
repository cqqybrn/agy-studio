import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { injectStatuslineConfig, createStatuslineSink } from './statusline-capture.js';
import { RollbackGuard } from './rollback.js';

describe('statusline-capture 状态栏捕获与安全回滚', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-statusline-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('injectStatuslineConfig 正确注入 statusline 命令且保留原有设置', () => {
    const original = JSON.stringify({
      alwaysProceed: true,
      theme: 'dark',
      customKey: 'keep-me',
    });

    const modified = injectStatuslineConfig(original, 'node C:\\test\\sink.js');
    const parsed = JSON.parse(modified);

    expect(parsed.alwaysProceed).toBe(true);
    expect(parsed.theme).toBe('dark');
    expect(parsed.customKey).toBe('keep-me');
    expect(parsed.statusline).toBe('node C:\\test\\sink.js');
  });

  it('createStatuslineSink 能生成捕获脚本', () => {
    const logPath = path.join(tempDir, 'sink.log');
    const binDir = path.join(tempDir, 'bin');

    const sink = createStatuslineSink(logPath, binDir);

    expect(fs.existsSync(sink.jsPath)).toBe(true);
    expect(fs.existsSync(sink.cmdPath)).toBe(true);

    const jsContent = fs.readFileSync(sink.jsPath, 'utf-8');
    expect(jsContent).toContain('readline');
    expect(jsContent).toContain('appendFileSync');
  });

  it('验证整个 statusline 修改过程可被完整回滚还原', () => {
    const settingsFile = path.join(tempDir, 'settings.json');
    const initialConfig = { autoApprove: false, user: 'dev' };
    fs.writeFileSync(settingsFile, JSON.stringify(initialConfig), 'utf-8');

    const guard = new RollbackGuard(path.join(tempDir, 'backups'));
    guard.backupFile(settingsFile);

    // 修改并注入 statusline
    const updated = injectStatuslineConfig(
      fs.readFileSync(settingsFile, 'utf-8'),
      'node /tmp/fake-sink.js'
    );
    fs.writeFileSync(settingsFile, updated, 'utf-8');

    // 检查修改已写入
    const inBetween = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    expect(inBetween.statusline).toBe('node /tmp/fake-sink.js');

    // 触发回滚
    guard.rollbackSync();

    // 验证恢复回初始配置
    const restored = JSON.parse(fs.readFileSync(settingsFile, 'utf-8'));
    expect(restored).toEqual(initialConfig);
    expect(restored.statusline).toBeUndefined();
  });
});
