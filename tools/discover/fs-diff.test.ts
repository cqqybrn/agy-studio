import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isIgnoredPath, diffSnapshots, takeSnapshot, type SnapshotData } from './fs-diff.js';

describe('fs-diff 文件系统差异探测与噪音过滤', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-fs-diff-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('能精准过滤浏览器缓存、临时目录与编辑器噪音', () => {
    // 应该被忽略的噪音
    expect(isIgnoredPath('C:\\Users\\Admin\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Cache\\data_0')).toBe(true);
    expect(isIgnoredPath('C:/Users/Admin/AppData/Local/Microsoft/Edge/User Data/Default/Code Cache/js/abc')).toBe(true);
    expect(isIgnoredPath('C:\\Users\\Admin\\AppData\\Local\\Temp\\tmp123.tmp')).toBe(true);
    expect(isIgnoredPath('C:\\Users\\Admin\\AppData\\Local\\Microsoft\\Windows\\INetCache\\IE\\xyz')).toBe(true);
    expect(isIgnoredPath('C:\\project\\node_modules\\react\\index.js')).toBe(true);
    expect(isIgnoredPath('C:\\Users\\Admin\\.cursor\\projects\\g-new\\terminals\\1.txt')).toBe(true);

    // 应该被保留的 agy 关键路径与普通配置
    expect(isIgnoredPath('C:\\Users\\Admin\\.antigravity\\settings.json')).toBe(false);
    expect(isIgnoredPath('C:\\Users\\Admin\\AppData\\Roaming\\antigravity\\config.json')).toBe(false);
    expect(isIgnoredPath('C:\\Users\\Admin\\.agy\\conversations\\conv-123.json')).toBe(false);
  });

  it('diffSnapshots 能准确统计 added, modified, deleted', () => {
    const before: SnapshotData = {
      timestamp: '2026-09-28T00:00:00.000Z',
      roots: ['/home/test'],
      files: {
        '/home/test/file-a.txt': { path: '/home/test/file-a.txt', size: 100, mtimeMs: 1000 },
        '/home/test/file-b.txt': { path: '/home/test/file-b.txt', size: 200, mtimeMs: 2000 },
      },
    };

    const after: SnapshotData = {
      timestamp: '2026-09-28T00:01:00.000Z',
      roots: ['/home/test'],
      files: {
        // file-a 保持不变
        '/home/test/file-a.txt': { path: '/home/test/file-a.txt', size: 100, mtimeMs: 1000 },
        // file-b 大小被修改
        '/home/test/file-b.txt': { path: '/home/test/file-b.txt', size: 250, mtimeMs: 3000 },
        // file-c 为新创建
        '/home/test/file-c.txt': { path: '/home/test/file-c.txt', size: 50, mtimeMs: 3100 },
      },
    };

    const diff = diffSnapshots(before, after);

    expect(diff.summary.addedCount).toBe(1);
    expect(diff.summary.modifiedCount).toBe(1);
    expect(diff.summary.deletedCount).toBe(0);
    expect(diff.summary.totalChanges).toBe(2);

    expect(diff.added[0].path).toBe('/home/test/file-c.txt');
    expect(diff.modified[0].path).toBe('/home/test/file-b.txt');
    expect(diff.modified[0].before.size).toBe(200);
    expect(diff.modified[0].after.size).toBe(250);
  });

  it('takeSnapshot 能扫描指定目录', () => {
    const file1 = path.join(tempDir, 'agy.config.json');
    fs.writeFileSync(file1, '{"version":"1.0"}', 'utf-8');

    const subDir = path.join(tempDir, 'sub');
    fs.mkdirSync(subDir);
    const file2 = path.join(subDir, 'state.json');
    fs.writeFileSync(file2, '{"active":true}', 'utf-8');

    const snap = takeSnapshot([tempDir], [], false);
    const keys = Object.keys(snap.files);

    expect(keys.length).toBe(2);
    expect(snap.files[file1.toLowerCase()]).toBeDefined();
    expect(snap.files[file2.toLowerCase()]).toBeDefined();
  });
});
