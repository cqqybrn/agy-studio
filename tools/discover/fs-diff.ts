import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export interface FileSnapshotEntry {
  path: string;
  size: number;
  mtimeMs: number;
}

export interface SnapshotData {
  timestamp: string;
  roots: string[];
  files: Record<string, FileSnapshotEntry>;
}

export interface DiffResult {
  added: FileSnapshotEntry[];
  modified: Array<{
    path: string;
    before: { size: number; mtimeMs: number };
    after: { size: number; mtimeMs: number };
  }>;
  deleted: FileSnapshotEntry[];
  summary: {
    addedCount: number;
    modifiedCount: number;
    deletedCount: number;
    totalChanges: number;
  };
}

export const DEFAULT_IGNORE_PATTERNS: RegExp[] = [
  // 浏览器缓存
  /[\\/](?:Google[\\/]Chrome|Microsoft[\\/]Edge|Brave-Browser)[\\/]User Data[\\/][^\\/]+[\\/](?:Cache|Code Cache|GPUCache|DawnCache|Service Worker)/i,
  /[\\/]Mozilla[\\/]Firefox[\\/]Profiles[\\/][^\\/]+[\\/](?:cache2|startupCache)/i,
  // 系统临时目录与缓存
  /[\\/]AppData[\\/]Local[\\/]Microsoft[\\/]Windows[\\/](?:INetCache|WebCache|History|Explorer)/i,
  /[\\/]AppData[\\/]Local[\\/]Packages(?=[\\/]|$)/i,
  /[\\/]AppData[\\/]Local[\\/]CrashDumps(?=[\\/]|$)/i,
  /[\\/]AppData[\\/]Local[\\/]Application Data(?=[\\/]|$)/i, // Windows junction 循环
  // 系统与锁定文件
  /[\\/](?:ntuser\.dat|NTUSER\.DAT)[^\\/]*$/i,
  /[\\/]usrclass\.dat[^\\/]*$/i,
  // 编辑器与项目缓存
  /[\\/]node_modules(?=[\\/]|$)/i,
  /[\\/]\.git(?=[\\/]|$)/i,
  /[\\/]\.cursor[\\/]projects[\\/][^\\/]+[\\/]terminals/i,
  /[\\/]AppData[\\/]Roaming[\\/]Cursor[\\/](?:logs|CachedData|Code Cache)/i,
  /[\\/]AppData[\\/]Local[\\/]Programs[\\/]cursor[\\/]resources/i,
];

export const SYSTEM_TEMP_PATTERN = /[\\/]AppData[\\/]Local[\\/]Temp(?=[\\/]|$)/i;

export function isIgnoredPath(
  targetPath: string,
  extraPatterns: RegExp[] = [],
  ignoreSystemTemp = true
): boolean {
  const norm = targetPath.replace(/\\/g, '/');

  if (ignoreSystemTemp && (SYSTEM_TEMP_PATTERN.test(targetPath) || SYSTEM_TEMP_PATTERN.test(norm))) {
    return true;
  }

  for (const pattern of DEFAULT_IGNORE_PATTERNS) {
    if (pattern.test(targetPath) || pattern.test(norm)) {
      return true;
    }
  }
  for (const pattern of extraPatterns) {
    if (pattern.test(targetPath) || pattern.test(norm)) {
      return true;
    }
  }
  return false;
}

export function getDefaultRoots(): string[] {
  const roots: string[] = [];
  if (process.env.USERPROFILE) roots.push(process.env.USERPROFILE);
  if (process.env.APPDATA) roots.push(process.env.APPDATA);
  if (process.env.LOCALAPPDATA) roots.push(process.env.LOCALAPPDATA);

  // 去重并规范化
  const unique = Array.from(new Set(roots.map(r => path.resolve(r))));
  return unique.filter(r => fs.existsSync(r));
}

export function scanDirectory(
  dir: string,
  result: Record<string, FileSnapshotEntry>,
  extraIgnore: RegExp[] = [],
  maxDepth = 15,
  currentDepth = 0,
  isRoot = false,
  ignoreSystemTemp = true
): void {
  if (currentDepth > maxDepth) return;
  if (!isRoot && isIgnoredPath(dir, extraIgnore, ignoreSystemTemp)) return;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    // 权限受限或系统保护目录，安全跳过
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (isIgnoredPath(fullPath, extraIgnore, ignoreSystemTemp)) continue;

    try {
      if (entry.isDirectory()) {
        // 跳过符号链接目录以防止递归循环
        if (entry.isSymbolicLink()) continue;
        scanDirectory(fullPath, result, extraIgnore, maxDepth, currentDepth + 1, false, ignoreSystemTemp);
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        result[fullPath.toLowerCase()] = {
          path: fullPath,
          size: stat.size,
          mtimeMs: stat.mtimeMs,
        };
      }
    } catch {
      // 文件访问中途可能被锁定或删除，忽略单个文件错误
    }
  }
}

export function takeSnapshot(
  roots?: string[],
  extraIgnore: RegExp[] = [],
  ignoreSystemTemp = true
): SnapshotData {
  const targetRoots = roots && roots.length > 0 ? roots : getDefaultRoots();
  const files: Record<string, FileSnapshotEntry> = {};

  for (const root of targetRoots) {
    scanDirectory(root, files, extraIgnore, 15, 0, true, ignoreSystemTemp);
  }

  return {
    timestamp: new Date().toISOString(),
    roots: targetRoots,
    files,
  };
}

export function diffSnapshots(before: SnapshotData, after: SnapshotData): DiffResult {
  const added: FileSnapshotEntry[] = [];
  const modified: DiffResult['modified'] = [];
  const deleted: FileSnapshotEntry[] = [];

  const beforeKeys = new Set(Object.keys(before.files));
  const afterKeys = new Set(Object.keys(after.files));

  for (const key of afterKeys) {
    const afterEntry = after.files[key];
    if (!beforeKeys.has(key)) {
      added.push(afterEntry);
    } else {
      const beforeEntry = before.files[key];
      if (beforeEntry.size !== afterEntry.size || Math.abs(beforeEntry.mtimeMs - afterEntry.mtimeMs) > 1000) {
        modified.push({
          path: afterEntry.path,
          before: { size: beforeEntry.size, mtimeMs: beforeEntry.mtimeMs },
          after: { size: afterEntry.size, mtimeMs: afterEntry.mtimeMs },
        });
      }
    }
  }

  for (const key of beforeKeys) {
    if (!afterKeys.has(key)) {
      deleted.push(before.files[key]);
    }
  }

  return {
    added,
    modified,
    deleted,
    summary: {
      addedCount: added.length,
      modifiedCount: modified.length,
      deletedCount: deleted.length,
      totalChanges: added.length + modified.length + deleted.length,
    },
  };
}

function printUsage(): void {
  console.log(`
[fs-diff] 文件系统快照与变更对比工具 (排除噪音目录)
用于阶段 0 探测清单 V5、V6：探明 agy 在磁盘上的目录布局、settings 与数据落盘位置。

用法说明:
  1. 生成快照 (snapshot):
     npx tsx tools/discover/fs-diff.ts snapshot --out <snapshot.json> [--roots <path1,path2>]

  2. 对比两份快照 (diff):
     npx tsx tools/discover/fs-diff.ts diff --before <snap1.json> --after <snap2.json> [--out <diff.json>]

  3. 执行命令前后自动快照对比 (run):
     npx tsx tools/discover/fs-diff.ts run --cmd "<command>" [--out <diff.json>] [--roots <path1,path2>]

参数:
  --roots      扫描的根目录列表，默认 [%USERPROFILE%, %APPDATA%, %LOCALAPPDATA%]
  --before     前置快照文件路径
  --after      后置快照文件路径
  --out        输出 JSON 文件路径
  --cmd        需要执行的目标命令
  -h, --help   查看帮助文档

示例:
  npx tsx tools/discover/fs-diff.ts snapshot --out fixtures/agy/fs/snap-before.json
  npx tsx tools/discover/fs-diff.ts diff --before fixtures/agy/fs/snap-before.json --after fixtures/agy/fs/snap-after.json --out fixtures/agy/fs/diff.json
  npx tsx tools/discover/fs-diff.ts run --cmd "agy --version" --out fixtures/agy/fs/run-diff.json
`);
}

function parseCliArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        result[key] = next;
        i++;
      } else {
        result[key] = 'true';
      }
    }
  }
  return result;
}

export function runCli(argv: string[] = process.argv.slice(2)): void {
  const subCommand = argv[0];

  if (!subCommand || subCommand === '--help' || subCommand === '-h') {
    printUsage();
    return;
  }

  const flags = parseCliArgs(argv.slice(1));
  const roots = flags.roots ? flags.roots.split(',').map(r => r.trim()) : undefined;

  if (subCommand === 'snapshot') {
    if (!flags.out) {
      console.error('错误: 请通过 --out 参数指定快照输出路径！');
      printUsage();
      process.exit(1);
    }
    console.log(`正在扫描目录快照 (排除缓存噪音)...`);
    const snapshot = takeSnapshot(roots);
    const count = Object.keys(snapshot.files).length;
    const outPath = path.resolve(flags.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(snapshot, null, 2), 'utf-8');
    console.log(`[成功] 快照已记录 ${count} 个有效文件，保存至: ${outPath}`);
  } else if (subCommand === 'diff') {
    if (!flags.before || !flags.after) {
      console.error('错误: 请通过 --before 和 --after 指定要对比的两份快照！');
      printUsage();
      process.exit(1);
    }
    const beforeData: SnapshotData = JSON.parse(fs.readFileSync(flags.before, 'utf-8'));
    const afterData: SnapshotData = JSON.parse(fs.readFileSync(flags.after, 'utf-8'));
    const diff = diffSnapshots(beforeData, afterData);

    console.log(`\n===== 快照差异对比结果 =====`);
    console.log(`新增文件 (${diff.summary.addedCount}):`);
    diff.added.forEach(a => console.log(`  + [新增] ${a.path} (${a.size} 字节)`));
    console.log(`修改文件 (${diff.summary.modifiedCount}):`);
    diff.modified.forEach(m => console.log(`  * [修改] ${m.path} (${m.before.size} -> ${m.after.size} 字节)`));
    console.log(`删除文件 (${diff.summary.deletedCount}):`);
    diff.deleted.forEach(d => console.log(`  - [删除] ${d.path}`));
    console.log(`总计变更: ${diff.summary.totalChanges}\n`);

    if (flags.out) {
      const outPath = path.resolve(flags.out);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(diff, null, 2), 'utf-8');
      console.log(`差异详情已写入: ${outPath}`);
    }
  } else if (subCommand === 'run') {
    if (!flags.cmd) {
      console.error('错误: 请通过 --cmd 指定要运行的命令！');
      printUsage();
      process.exit(1);
    }
    console.log(`[1/3] 正在记录执行前快照...`);
    const before = takeSnapshot(roots);
    console.log(`[2/3] 执行命令: ${flags.cmd}`);
    const res = spawnSync(flags.cmd, { shell: true, stdio: 'inherit' });
    console.log(`[3/3] 正在记录执行后快照并计算差异...`);
    const after = takeSnapshot(roots);
    const diff = diffSnapshots(before, after);

    console.log(`\n===== 执行后文件变更摘要 =====`);
    console.log(`状态码: ${res.status}`);
    console.log(`新增文件: ${diff.summary.addedCount}`);
    console.log(`修改文件: ${diff.summary.modifiedCount}`);
    console.log(`删除文件: ${diff.summary.deletedCount}`);

    if (diff.summary.totalChanges > 0) {
      console.log(`\n变更列表:`);
      diff.added.forEach(a => console.log(`  + ${a.path}`));
      diff.modified.forEach(m => console.log(`  * ${m.path}`));
      diff.deleted.forEach(d => console.log(`  - ${d.path}`));
    } else {
      console.log('未检测到任何文件系统变更。');
    }

    if (flags.out) {
      const outPath = path.resolve(flags.out);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(diff, null, 2), 'utf-8');
      console.log(`差异结果已保存至: ${outPath}`);
    }
  } else {
    console.error(`未知子命令: ${subCommand}`);
    printUsage();
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('fs-diff.ts') ||
  process.argv[1].endsWith('fs-diff.js')
);

if (isDirectRun) {
  runCli();
}
