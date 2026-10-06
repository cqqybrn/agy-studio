import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export function isProcessAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    if (typeof err === 'object' && err !== null && 'code' in err) {
      const code = (err as { code: string }).code;
      if (code === 'ESRCH') {
        return false;
      }
      if (code === 'EPERM') {
        return true;
      }
    }
    return false;
  }
}

export async function waitForProcessExit(
  pid: number,
  timeoutMs = 5000,
  pollIntervalMs = 50,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

export async function killTree(pid: number): Promise<void> {
  if (pid <= 0 || !isProcessAlive(pid)) {
    return;
  }

  const isWindows = process.platform === 'win32';

  if (isWindows) {
    try {
      await execFileAsync('taskkill', ['/T', '/F', '/PID', String(pid)], { windowsHide: true });
    } catch {
      // If taskkill fails because process was already terminated or not found, ignore
    }
    await waitForProcessExit(pid);
    return;
  }

  // Non-Windows: SIGTERM then SIGKILL after 2 seconds
  try {
    process.kill(pid, 'SIGTERM');
  } catch (err: unknown) {
    if (
      typeof err === 'object' &&
      err !== null &&
      'code' in err &&
      (err as { code: string }).code === 'ESRCH'
    ) {
      return;
    }
  }

  // Wait up to 2 seconds for graceful exit
  const start = Date.now();
  while (Date.now() - start < 2000) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // Still alive after 2 seconds -> SIGKILL
  if (isProcessAlive(pid)) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (err: unknown) {
      if (
        typeof err === 'object' &&
        err !== null &&
        'code' in err &&
        (err as { code: string }).code === 'ESRCH'
      ) {
        return;
      }
    }
    await waitForProcessExit(pid);
  }
}
