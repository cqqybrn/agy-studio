import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanAccessService, type LanListenerPort } from '../../src/services/lan-access.js';

class FakeListener implements LanListenerPort {
  running = false;
  fail: Error | null = null;
  start = vi.fn(async () => {
    if (this.fail) throw this.fail;
    this.running = true;
  });
  stop = vi.fn(async () => {
    this.running = false;
  });
}

describe('LanAccessService', () => {
  let dataDir: string;
  let listener: FakeListener;
  const make = (extra: Partial<ConstructorParameters<typeof LanAccessService>[0]> = {}) =>
    new LanAccessService({
      dataDir,
      port: 8790,
      listener,
      addresses: () => [{ name: 'WLAN', address: '192.168.1.20' }],
      ...extra,
    });

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-lan-'));
    listener = new FakeListener();
  });
  afterEach(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  it('is off by default and shows the link with the access code only to this computer', () => {
    const service = make();
    const local = service.status(true);
    expect(local).toMatchObject({ available: true, enabled: false, listening: false, canManage: true });
    expect(local.addresses[0].url).toMatch(/^http:\/\/192\.168\.1\.20:8790\/\?token=[\w-]{20,}$/);

    const remote = service.status(false);
    expect(remote.addresses[0].url).toBe('http://192.168.1.20:8790/');
    expect(remote.canManage).toBe(false);
  });

  it('turns on, persists across restarts and checks the code', async () => {
    const service = make();
    await service.setEnabled(true);
    expect(listener.start).toHaveBeenCalledWith(8790);
    const token = new URL(service.status(true).addresses[0].url).searchParams.get('token');
    expect(service.verifyToken(token)).toBe(true);
    expect(service.verifyToken('wrong')).toBe(false);
    expect(service.verifyToken(undefined)).toBe(false);

    // a new process restores the same state and code
    const restarted = make();
    await restarted.restore();
    expect(listener.start).toHaveBeenCalledTimes(2);
    expect(restarted.verifyToken(token)).toBe(true);
  });

  it('a new code invalidates the old one and reconnects the listener', async () => {
    const service = make();
    await service.setEnabled(true);
    const old = new URL(service.status(true).addresses[0].url).searchParams.get('token');
    await service.regenerateToken();
    expect(service.verifyToken(old)).toBe(false);
    expect(listener.stop).toHaveBeenCalled();
    expect(listener.running).toBe(true);
  });

  it('reports why the listener could not open', async () => {
    listener.fail = new Error('EADDRINUSE');
    const service = make();
    await service.setEnabled(true);
    expect(service.status(true)).toMatchObject({ enabled: true, listening: false });
    expect(service.status(true).error).toContain('EADDRINUSE');
  });

  it('stays out of the way when HOST already exposes the server', async () => {
    fs.writeFileSync(path.join(dataDir, 'lan-access.json'), JSON.stringify({ enabled: true, token: 'x'.repeat(24) }));
    const service = make({ managedByEnv: true });
    await service.restore();
    expect(listener.start).not.toHaveBeenCalled();
    expect(service.status(true)).toMatchObject({ available: false, canManage: false });
  });
});
