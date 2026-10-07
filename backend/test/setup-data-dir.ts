import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll } from 'vitest';

// Tests must never open the user's real data directory (~/.agy-studio): buildApp() without an
// explicit config reads DATA_DIR from the environment, and opening the database runs migrations.
// Every test file gets a throwaway directory, removed when the file is done.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-studio-test-data-'));
process.env.DATA_DIR = dir;

afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // a database file may still be open on Windows; the OS temp cleanup will get it
  }
});
