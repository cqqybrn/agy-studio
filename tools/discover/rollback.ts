import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface BackupRecord {
  targetPath: string;
  backupPath?: string;
  originalExists: boolean;
  originalContent?: Buffer;
}

export interface EnvRecord {
  name: string;
  originalValue: string | undefined;
}

export class RollbackGuard {
  private fileBackups: BackupRecord[] = [];
  private envBackups: EnvRecord[] = [];
  private customRollbacks: Array<() => void | Promise<void>> = [];
  private backupDir: string;
  private isRolledBack = false;
  private cleanupHooksInstalled = false;
  private signalListeners: Array<{ event: NodeJS.Signals | 'exit' | 'uncaughtException'; listener: (...args: unknown[]) => void }> = [];

  constructor(backupBaseDir?: string) {
    const base = backupBaseDir || path.join(os.tmpdir(), 'agy-rollback');
    const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.backupDir = path.join(base, nonce);
  }

  getBackupDir(): string {
    return this.backupDir;
  }

  /**
   * 备份指定文件：若存在则复制原文件内容；若不存在则标记为“原本不存在”。
   * 回滚时：若原文件存在则恢复内容；若原文件不存在但现在存在了则删除。
   */
  backupFile(targetPath: string): string | null {
    const resolved = path.resolve(targetPath);
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }

    if (fs.existsSync(resolved)) {
      const fileName = `${this.fileBackups.length}-${path.basename(resolved)}.bak`;
      const backupPath = path.join(this.backupDir, fileName);
      const originalContent = fs.readFileSync(resolved);
      fs.writeFileSync(backupPath, originalContent);

      this.fileBackups.push({
        targetPath: resolved,
        backupPath,
        originalExists: true,
        originalContent,
      });
      return backupPath;
    } else {
      this.fileBackups.push({
        targetPath: resolved,
        originalExists: false,
      });
      return null;
    }
  }

  /**
   * 标记某个即将创建的新文件，回滚时如果存在则删除该文件。
   */
  trackNewFile(filePath: string): void {
    const resolved = path.resolve(filePath);
    const existing = this.fileBackups.find(b => b.targetPath === resolved);
    if (!existing) {
      this.fileBackups.push({
        targetPath: resolved,
        originalExists: false,
      });
    }
  }

  /**
   * 备份指定的环境变量值
   */
  backupEnv(varName: string): void {
    const existing = this.envBackups.find(e => e.name === varName);
    if (!existing) {
      this.envBackups.push({
        name: varName,
        originalValue: process.env[varName],
      });
    }
  }

  /**
   * 注册自定义回滚回调
   */
  addRollbackHook(fn: () => void | Promise<void>): void {
    this.customRollbacks.push(fn);
  }

  /**
   * 注册进程异常或中断自动回滚守卫
   */
  installSignalHooks(): void {
    if (this.cleanupHooksInstalled) return;
    this.cleanupHooksInstalled = true;

    const handleExit = () => {
      this.rollbackSync();
    };

    const handleSignal = (sig: NodeJS.Signals) => {
      this.rollbackSync();
      process.exit(128 + (sig === 'SIGINT' ? 2 : 15));
    };

    const handleUncaught = (err: unknown) => {
      console.error('[RollbackGuard] 捕获未处理异常，正在回滚配置...', err);
      this.rollbackSync();
      process.exit(1);
    };

    process.once('exit', handleExit);
    this.signalListeners.push({ event: 'exit', listener: handleExit });

    const sigintListener = () => handleSignal('SIGINT');
    process.once('SIGINT', sigintListener);
    this.signalListeners.push({ event: 'SIGINT', listener: sigintListener });

    const sigtermListener = () => handleSignal('SIGTERM');
    process.once('SIGTERM', sigtermListener);
    this.signalListeners.push({ event: 'SIGTERM', listener: sigtermListener });

    const uncaughtListener = (err: unknown) => handleUncaught(err);
    process.once('uncaughtException', uncaughtListener);
    this.signalListeners.push({ event: 'uncaughtException', listener: uncaughtListener });
  }

  uninstallSignalHooks(): void {
    if (!this.cleanupHooksInstalled) return;
    for (const item of this.signalListeners) {
      process.removeListener(item.event, item.listener as NodeJS.BeforeExitListener);
    }
    this.signalListeners = [];
    this.cleanupHooksInstalled = false;
  }

  /**
   * 同步回滚（用于 exit / 信号处理 / finally）
   */
  rollbackSync(): void {
    if (this.isRolledBack) return;
    this.isRolledBack = true;

    // 1. 还原环境变量（逆序）
    for (let i = this.envBackups.length - 1; i >= 0; i--) {
      const item = this.envBackups[i];
      if (item.originalValue === undefined) {
        delete process.env[item.name];
      } else {
        process.env[item.name] = item.originalValue;
      }
    }

    // 2. 还原文件修改（逆序）
    for (let i = this.fileBackups.length - 1; i >= 0; i--) {
      const record = this.fileBackups[i];
      try {
        if (record.originalExists) {
          if (record.backupPath && fs.existsSync(record.backupPath)) {
            const dir = path.dirname(record.targetPath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.copyFileSync(record.backupPath, record.targetPath);
          } else if (record.originalContent) {
            fs.writeFileSync(record.targetPath, record.originalContent);
          }
        } else {
          // 原本不存在，若当前存在则移除
          if (fs.existsSync(record.targetPath)) {
            fs.rmSync(record.targetPath, { recursive: true, force: true });
          }
        }
      } catch (err) {
        console.error(`[RollbackGuard] 恢复文件失败: ${record.targetPath}`, err);
      }
    }

    // 3. 执行同步自定义 hook
    for (let i = this.customRollbacks.length - 1; i >= 0; i--) {
      try {
        const res = this.customRollbacks[i]();
        if (res && typeof (res as Promise<void>).then === 'function') {
          // promise in sync context, ignore or warn
        }
      } catch (err) {
        console.error('[RollbackGuard] 自定义回滚 hook 失败', err);
      }
    }

    // 4. 清理备份目录
    try {
      if (fs.existsSync(this.backupDir)) {
        fs.rmSync(this.backupDir, { recursive: true, force: true });
      }
    } catch {
      // 忽略清理临时目录失败
    }

    this.uninstallSignalHooks();
  }

  /**
   * 异步回滚
   */
  async rollback(): Promise<void> {
    if (this.isRolledBack) return;
    this.rollbackSync();
  }
}

/**
 * 包装执行安全函数，无论发生任何异常或正常完成都安全执行回滚（或手动 commit）
 */
export async function withRollbackGuard<T>(
  fn: (guard: RollbackGuard) => Promise<T>,
  options?: { backupBaseDir?: string; autoRollbackOnSuccess?: boolean }
): Promise<T> {
  const guard = new RollbackGuard(options?.backupBaseDir);
  guard.installSignalHooks();
  try {
    const result = await fn(guard);
    if (options?.autoRollbackOnSuccess !== false) {
      await guard.rollback();
    }
    return result;
  } catch (error) {
    await guard.rollback();
    throw error;
  } finally {
    guard.uninstallSignalHooks();
  }
}
