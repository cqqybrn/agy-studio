import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RollbackGuard, withRollbackGuard } from './rollback.js';

describe('RollbackGuard 安全备份与恢复机制', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-rollback-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('能够备份并恢复已有文件的修改', () => {
    const testFile = path.join(tempDir, 'settings.json');
    fs.writeFileSync(testFile, JSON.stringify({ autoApprove: false, theme: 'dark' }), 'utf-8');

    const guard = new RollbackGuard(path.join(tempDir, 'backups'));
    guard.backupFile(testFile);

    // 修改文件
    fs.writeFileSync(testFile, JSON.stringify({ autoApprove: true, injected: true }), 'utf-8');
    expect(JSON.parse(fs.readFileSync(testFile, 'utf-8'))).toEqual({ autoApprove: true, injected: true });

    // 执行回滚
    guard.rollbackSync();

    // 验证文件恢复原样
    expect(JSON.parse(fs.readFileSync(testFile, 'utf-8'))).toEqual({ autoApprove: false, theme: 'dark' });
  });

  it('对于原本不存在的文件，回滚时安全删除新创建的文件', () => {
    const newFile = path.join(tempDir, 'new-config.json');
    expect(fs.existsSync(newFile)).toBe(false);

    const guard = new RollbackGuard(path.join(tempDir, 'backups'));
    guard.backupFile(newFile);

    // 模拟脚本创建了新配置文件
    fs.writeFileSync(newFile, '{"created": true}', 'utf-8');
    expect(fs.existsSync(newFile)).toBe(true);

    // 执行回滚
    guard.rollbackSync();

    // 验证新文件已被清除
    expect(fs.existsSync(newFile)).toBe(false);
  });

  it('能够备份与还原环境变量', () => {
    const testEnvKey = 'AGY_TEST_VAR_' + Date.now();
    process.env[testEnvKey] = 'initial-value';

    const guard = new RollbackGuard(path.join(tempDir, 'backups'));
    guard.backupEnv(testEnvKey);

    // 修改环境变量
    process.env[testEnvKey] = 'modified-value';
    expect(process.env[testEnvKey]).toBe('modified-value');

    // 执行回滚
    guard.rollbackSync();
    expect(process.env[testEnvKey]).toBe('initial-value');

    // 测试原本不存在的环境变量
    const unsetEnvKey = 'AGY_UNSET_VAR_' + Date.now();
    delete process.env[unsetEnvKey];
    const guard2 = new RollbackGuard(path.join(tempDir, 'backups'));
    guard2.backupEnv(unsetEnvKey);
    process.env[unsetEnvKey] = 'was-unset';
    guard2.rollbackSync();
    expect(process.env[unsetEnvKey]).toBeUndefined();

    delete process.env[testEnvKey];
  });

  it('withRollbackGuard 在抛出异常时自动执行回滚', async () => {
    const testFile = path.join(tempDir, 'critical.json');
    fs.writeFileSync(testFile, 'original-content', 'utf-8');

    await expect(
      withRollbackGuard(
        async (guard) => {
          guard.backupFile(testFile);
          fs.writeFileSync(testFile, 'tampered-content', 'utf-8');
          throw new Error('模拟执行中途中断或崩溃');
        },
        { backupBaseDir: path.join(tempDir, 'backups') }
      )
    ).rejects.toThrow('模拟执行中途中断或崩溃');

    // 验证异常后原内容已自动恢复
    expect(fs.readFileSync(testFile, 'utf-8')).toBe('original-content');
  });

  it('支持注册自定义回滚钩子且多次回滚具备幂等性', () => {
    let hookExecutedCount = 0;
    const guard = new RollbackGuard(path.join(tempDir, 'backups'));
    guard.addRollbackHook(() => {
      hookExecutedCount++;
    });

    guard.rollbackSync();
    guard.rollbackSync(); // 第二次回滚应该被防重阻断

    expect(hookExecutedCount).toBe(1);
  });
});
