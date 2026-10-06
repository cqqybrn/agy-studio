import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { DirectoryEntry, DirectoryListing } from '@agy-studio/contracts';
import { AppError } from '../utils/errors.js';

/** Windows folders that are never useful as a workspace. */
const SKIPPED_NAMES = new Set(['$recycle.bin', 'system volume information', '$windows.~bt', '$winreagent', 'config.msi']);

export interface DirectoryBrowserOptions {
  platform?: NodeJS.Platform;
  /** Overridable for tests. */
  listDrives?: () => string[];
}

function windowsDrives(): string[] {
  const drives: string[] = [];
  for (let code = 'A'.charCodeAt(0); code <= 'Z'.charCodeAt(0); code++) {
    const root = `${String.fromCharCode(code)}:\\`;
    if (existsSync(root)) drives.push(root);
  }
  return drives;
}

/** Lists folders on this machine so the user can pick a workspace instead of typing a path. */
export class DirectoryBrowser {
  private readonly platform: NodeJS.Platform;
  private readonly listDrives: () => string[];

  constructor(options: DirectoryBrowserOptions = {}) {
    this.platform = options.platform ?? process.platform;
    this.listDrives = options.listDrives ?? windowsDrives;
  }

  async list(rawPath?: string | null): Promise<DirectoryListing> {
    const requested = rawPath?.trim();
    if (!requested) {
      if (this.platform === 'win32') {
        return {
          path: null,
          parent: null,
          entries: this.listDrives().map((root) => ({ name: root.slice(0, 2), path: root })),
        };
      }
      return this.list('/');
    }

    const pathApi = this.platform === 'win32' ? path.win32 : path.posix;
    if (!pathApi.isAbsolute(requested)) {
      throw new AppError('BAD_REQUEST', `需要绝对路径：${requested}`);
    }
    const dir = pathApi.resolve(requested);

    let dirents;
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') {
        throw new AppError('NOT_FOUND', `文件夹不存在：${dir}`);
      }
      if (code === 'EPERM' || code === 'EACCES') {
        throw new AppError('BAD_REQUEST', `没有权限打开：${dir}`);
      }
      throw err;
    }

    const entries: DirectoryEntry[] = dirents
      .filter((d) => d.isDirectory() && !d.name.startsWith('.') && !SKIPPED_NAMES.has(d.name.toLowerCase()))
      .map((d) => ({ name: d.name, path: pathApi.join(dir, d.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' }));

    const parentDir = pathApi.dirname(dir);
    // A drive or filesystem root has itself as its dirname; go back to the drive list on Windows.
    const parent = parentDir === dir ? null : parentDir;
    return { path: dir, parent, entries };
  }
}
