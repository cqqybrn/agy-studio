import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AgyCatalog } from '../../src/integrations/agy/catalog.js';
import { buildWindowsStartArgs } from '../../src/integrations/agy/login-terminal.js';
import { resolveBinary, resolveRunnerBinary } from '../../src/integrations/agy/process.js';
import { loadProfile } from '../../src/integrations/agy/profile/loader.js';
import type { AgyProfile } from '../../src/integrations/agy/profile/schema.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const baseProfile = loadProfile(path.resolve(__dirname, '../../agy-profile.json'));

function withCandidates(candidates: string[]): AgyProfile {
  return { ...baseProfile, binary: { ...baseProfile.binary, candidates } };
}

// Customers' Windows user names often contain spaces, e.g. C:\Users\John Smith\AppData\...
describe('agy binary paths', () => {
  let tempDir: string;
  let spacedDir: string;

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-paths-'));
    spacedDir = path.join(tempDir, 'John Smith', 'agy', 'bin');
    fs.mkdirSync(spacedDir, { recursive: true });
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('login terminal command line', () => {
    it('always quotes the command so a space in the path does not split it', () => {
      expect(buildWindowsStartArgs('C:\\Users\\John Smith\\agy.exe', [])).toEqual([
        '/c',
        'start',
        '""',
        '"C:\\Users\\John Smith\\agy.exe"',
      ]);
    });

    it('quotes only arguments that need it', () => {
      expect(buildWindowsStartArgs('agy.exe', ['--flag', 'two words'])).toEqual([
        '/c',
        'start',
        '""',
        '"agy.exe"',
        '--flag',
        '"two words"',
      ]);
    });
  });

  describe('runner binary resolution', () => {
    it('uses an existing candidate instead of a bare name that is not on PATH', () => {
      const installed = path.join(spacedDir, 'agy.exe');
      fs.writeFileSync(installed, '');
      const profile = withCandidates(['agy-not-on-path-7f3c', installed]);

      // Old behaviour: the first candidate, which spawn() cannot find -> ENOENT for every run
      expect(resolveBinary(profile)).toBe('agy-not-on-path-7f3c');
      expect(resolveRunnerBinary(profile)).toBe(path.resolve(installed));
    });

    it('keeps an explicit binary', () => {
      const explicit = path.join(spacedDir, 'explicit-agy.exe');
      fs.writeFileSync(explicit, '');
      expect(resolveRunnerBinary(withCandidates(['agy']), explicit)).toBe(path.resolve(explicit));
    });

    it('falls back to the profile candidate when nothing is found', () => {
      expect(resolveRunnerBinary(withCandidates(['agy-not-on-path-7f3c']))).toBe('agy-not-on-path-7f3c');
    });
  });

  describe.runIf(process.platform === 'win32')('catalog execution on Windows', () => {
    it('runs an .exe whose path contains a space', async (ctx) => {
      const exe = path.join(spacedDir, 'agy-node.exe');
      try {
        fs.linkSync(process.execPath, exe);
      } catch {
        ctx.skip(); // hard links need the temp dir on the same volume as node.exe
      }
      // Make the linked node print a bare version, like `agy --version` does
      const profile = withCandidates([exe]);
      profile.catalog = { ...profile.catalog, versionArgv: ['-p', "'1.2.3'"] };
      const catalog = new AgyCatalog({ profile, defaultBin: exe });
      expect(await catalog.getVersion()).toBe('1.2.3');
    });

    it('runs a .cmd shim whose path contains a space', async () => {
      const shim = path.join(spacedDir, 'agy shim.cmd');
      fs.writeFileSync(shim, '@echo 9.9.9\r\n');
      const catalog = new AgyCatalog({ profile: withCandidates([shim]), defaultBin: shim });
      expect(await catalog.getVersion()).toBe('9.9.9');
    });
  });
});
