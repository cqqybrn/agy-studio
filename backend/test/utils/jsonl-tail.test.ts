import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JsonlTail } from '../../src/utils/jsonl-tail.js';

describe('utils/jsonl-tail', () => {
  let tempDir: string;
  let filePath: string;

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'jsonl-tail-test-'));
    filePath = path.join(tempDir, 'test.jsonl');
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
  });

  it('returns empty lines when file does not exist', async () => {
    const tail = new JsonlTail(filePath, 0);
    const result = await tail.read();
    expect(result.lines).toEqual([]);
    expect(result.newOffset).toBe(0);
    expect(tail.offset).toBe(0);
  });

  it('reads full lines and updates offset incrementally', async () => {
    await fs.promises.writeFile(filePath, 'line 1\nline 2\n', 'utf-8');

    const tail = new JsonlTail(filePath, 0);
    const firstRead = await tail.read();
    expect(firstRead.lines).toEqual(['line 1', 'line 2']);
    expect(firstRead.newOffset).toBeGreaterThan(0);
    expect(tail.offset).toBe(firstRead.newOffset);

    // Reading again when no new content is written returns empty
    const secondRead = await tail.read();
    expect(secondRead.lines).toEqual([]);
    expect(secondRead.newOffset).toBe(firstRead.newOffset);

    // Append more content
    await fs.promises.appendFile(filePath, 'line 3\r\nline 4\n', 'utf-8');
    const thirdRead = await tail.read();
    expect(thirdRead.lines).toEqual(['line 3', 'line 4']);
    expect(thirdRead.newOffset).toBeGreaterThan(secondRead.newOffset);
  });

  it('handles partial / incomplete lines without advancing past them', async () => {
    const tail = new JsonlTail(filePath, 0);

    // Write incomplete line (no trailing newline)
    await fs.promises.writeFile(filePath, 'incomplete line', 'utf-8');
    const firstRead = await tail.read();
    expect(firstRead.lines).toEqual([]);
    expect(firstRead.newOffset).toBe(0);
    expect(tail.offset).toBe(0);

    // Complete the line
    await fs.promises.appendFile(filePath, ' finished!\nnext complete line\n', 'utf-8');
    const secondRead = await tail.read();
    expect(secondRead.lines).toEqual(['incomplete line finished!', 'next complete line']);
    expect(secondRead.newOffset).toBeGreaterThan(0);
  });

  it('detects file truncation and resets offset to 0', async () => {
    await fs.promises.writeFile(filePath, 'line 1\nline 2\nline 3\n', 'utf-8');
    const tail = new JsonlTail(filePath, 0);
    const firstRead = await tail.read();
    expect(firstRead.lines).toHaveLength(3);

    // Truncate file to shorter content
    await fs.promises.writeFile(filePath, 'new content\n', 'utf-8');
    const secondRead = await tail.read();
    expect(secondRead.lines).toEqual(['new content']);
  });
});
