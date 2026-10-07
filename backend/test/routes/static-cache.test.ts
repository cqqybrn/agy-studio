import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type BuiltApp } from '../../src/app.js';

describe('static frontend caching', () => {
  let tempDir: string;
  let app: BuiltApp;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-static-'));
    const dist = path.join(tempDir, 'dist');
    fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dist, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(dist, 'assets', 'index-AbC123.js'), 'console.log(1)');
    app = buildApp({ config: { dataDir: path.join(tempDir, 'data') }, frontendDistDir: dist });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('never caches index.html, so an update shows up on the next load', async () => {
    for (const url of ['/', '/index.html', '/settings']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(200);
      expect(res.headers['cache-control']).toBe('no-cache');
    }
  });

  it('caches hashed assets for good', async () => {
    const res = await app.inject({ method: 'GET', url: '/assets/index-AbC123.js' });
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  });
});
