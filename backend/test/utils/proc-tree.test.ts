import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { isProcessAlive, killTree, waitForProcessExit } from '../../src/utils/proc-tree.js';

describe('utils/proc-tree', () => {
  it('correctly detects if a process is alive', async () => {
    // Current process is alive
    expect(isProcessAlive(process.pid)).toBe(true);

    // Negative or 0 pid is false
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(0)).toBe(false);

    // Huge unlikely PID
    expect(isProcessAlive(99999999)).toBe(false);
  });

  it('kills a spawned process and ensures it exits', async () => {
    // Spawn a long-running node process
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000);'], {
      windowsHide: true,
    });

    const pid = child.pid;
    expect(pid).toBeDefined();
    expect(typeof pid).toBe('number');

    if (!pid) return;

    expect(isProcessAlive(pid)).toBe(true);

    await killTree(pid);

    await waitForProcessExit(pid, 3000);
    expect(isProcessAlive(pid)).toBe(false);
  });

  it('handles already dead PID gracefully', async () => {
    await expect(killTree(99999999)).resolves.not.toThrow();
  });
});
