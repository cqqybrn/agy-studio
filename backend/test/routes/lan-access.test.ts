import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { buildApp, type BuiltApp } from '../../src/app.js';

/** A loopback alias stands in for the LAN: the LAN listener binds it instead of 0.0.0.0. */
const LAN_HOST = '127.0.0.2';

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
  });
}

function wsOpens(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.once('open', () => {
      ws.close();
      resolve(true);
    });
    ws.once('error', () => resolve(false));
    ws.once('unexpected-response', () => resolve(false));
  });
}

describe('LAN access over HTTP', () => {
  let tempDir: string;
  let port: number;
  let app: BuiltApp;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-lan-route-'));
    port = await freePort();
    app = buildApp({ config: { dataDir: tempDir, port, host: '127.0.0.1' }, lanListenerHost: LAN_HOST });
    await app.listen({ host: '127.0.0.1', port });
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const local = (p: string, init?: RequestInit) => fetch(`http://127.0.0.1:${port}${p}`, init);
  const lan = (p: string, init?: RequestInit) => fetch(`http://${LAN_HOST}:${port}${p}`, init);

  it('is off by default; turning it on opens the LAN side, which needs the access code', async () => {
    await expect(lan('/api/health')).rejects.toThrow();

    const on = await local('/api/lan-access', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(on.status).toBe(200);
    const status = await on.json();
    expect(status.listening).toBe(true);
    const token = new URL(status.addresses[0].url).searchParams.get('token') as string;

    expect((await lan('/api/health')).status).toBe(401);
    expect((await lan('/api/health', { headers: { authorization: 'Bearer nope' } })).status).toBe(401);
    expect((await lan('/api/health', { headers: { authorization: `Bearer ${token}` } })).status).toBe(200);
    // this computer never needs the code
    expect((await local('/api/health')).status).toBe(200);

    // WebSocket: code in the query string
    expect(await wsOpens(`ws://${LAN_HOST}:${port}/ws`)).toBe(false);
    expect(await wsOpens(`ws://${LAN_HOST}:${port}/ws?token=${token}`)).toBe(true);

    // a LAN device can read the status (without the code) but not change anything
    const remoteStatus = await (await lan('/api/lan-access', { headers: { authorization: `Bearer ${token}` } })).json();
    expect(remoteStatus.canManage).toBe(false);
    expect(remoteStatus.addresses[0].url).not.toContain('token=');
    const remoteOff = await lan('/api/lan-access', {
      method: 'PUT',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    expect(remoteOff.status).toBe(401);

    // a new code locks out links handed out before
    const regenerated = await (await local('/api/lan-access/regenerate', { method: 'POST' })).json();
    const newToken = new URL(regenerated.addresses[0].url).searchParams.get('token') as string;
    expect((await lan('/api/health', { headers: { authorization: `Bearer ${token}` } })).status).toBe(401);
    expect((await lan('/api/health', { headers: { authorization: `Bearer ${newToken}` } })).status).toBe(200);

    // turning it off closes the LAN side
    await local('/api/lan-access', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });
    await expect(lan('/api/health', { headers: { authorization: `Bearer ${newToken}` } })).rejects.toThrow();
  });
});
