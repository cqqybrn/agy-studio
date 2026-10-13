import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveLocalMediaPath } from '../../src/routes/http/local-media.routes.js';

describe('resolveLocalMediaPath', () => {
  const gemini = path.join(os.homedir(), '.gemini');
  const tmpDir = path.join(gemini, `.agy-studio-media-test-${Date.now()}`);
  const img = path.join(tmpDir, 'wing.jpg');

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('accepts file:// URLs under ~/.gemini', () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(img, Buffer.from([0xff, 0xd8, 0xff]));
    const url = `file:///${img.replace(/\\/g, '/')}`;
    expect(resolveLocalMediaPath(url)).toBe(path.resolve(img));
  });

  it('rejects paths outside ~/.gemini', () => {
    expect(() => resolveLocalMediaPath('C:\\Windows\\System32\\drivers\\etc\\hosts')).toThrow(
      /outside/i,
    );
  });
});
