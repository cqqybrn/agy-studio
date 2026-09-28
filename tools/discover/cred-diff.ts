import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import readline from 'node:readline';

export interface CredentialSnapshot {
  timestamp: string;
  targets: string[];
}

export interface CredentialDiff {
  added: string[];
  removed: string[];
  persisted: string[];
  summary: {
    addedCount: number;
    removedCount: number;
    totalBefore: number;
    totalAfter: number;
  };
}

/**
 * 从 cmdkey /list 输出中解析凭据 Target 名称。
 * 严格只提取 Target 名称，绝不捕获任何用户名、密码或凭据内容！
 */
export function parseCmdkeyOutput(output: string): string[] {
  const lines = output.split(/\r?\n/);
  const targets: string[] = [];

  for (const line of lines) {
    // 匹配 "    目标: TargetName" 或 "    Target: TargetName"
    const match = line.match(/^\s*(?:目标|Target):\s*(.+)$/i);
    if (match && match[1]) {
      const targetName = match[1].trim();
      if (targetName && !targets.includes(targetName)) {
        targets.push(targetName);
      }
    }
  }

  return targets.sort();
}

/**
 * 实际调用 Windows cmdkey /list 命令获取系统当前所有的凭据 Target 列表
 */
export function queryCredentials(): string[] {
  if (process.platform !== 'win32') {
    console.warn('[cred-diff] 警告: 当前不是 Windows 平台，cmdkey 仅在 Windows 上可用。');
    return [];
  }

  try {
    const raw = execSync('cmdkey /list', { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] });
    return parseCmdkeyOutput(raw);
  } catch (error) {
    console.error('[cred-diff] 调用 cmdkey /list 失败:', error);
    return [];
  }
}

/**
 * 对比两批 Target 列表
 */
export function diffCredentials(before: string[], after: string[]): CredentialDiff {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);

  const added = after.filter(t => !beforeSet.has(t));
  const removed = before.filter(t => !afterSet.has(t));
  const persisted = after.filter(t => beforeSet.has(t));

  return {
    added,
    removed,
    persisted,
    summary: {
      addedCount: added.length,
      removedCount: removed.length,
      totalBefore: before.length,
      totalAfter: after.length,
    },
  };
}

function printUsage(): void {
  console.log(`
[cred-diff] Windows 凭据管理器变更加密安全探测工具
用于阶段 0 探测清单 V7：判断 agy 登录凭据是否保存在 Windows 凭据管理器中，并提取对应条目 Target 名称。
【安全红线】：本工具仅且仅记录凭据条目的 Target 标识，绝不触碰、记录或打印任何密码与凭据内容！

用法说明:
  1. 记录凭据条目快照 (snapshot):
     npx tsx tools/discover/cred-diff.ts snapshot --out <cred-snap.json>

  2. 对比两份凭据条目快照 (diff):
     npx tsx tools/discover/cred-diff.ts diff --before <snap1.json> --after <snap2.json> [--out <diff.json>]

  3. 执行命令前后自动对比凭据变动 (run):
     npx tsx tools/discover/cred-diff.ts run --cmd "<command>" [--out <diff.json>]

  4. 交互式对比模式 (interactive):
     npx tsx tools/discover/cred-diff.ts run --interactive [--out <diff.json>]
     (先记录快照，提示用户在另一个终端完成登录操作，按回车后记录后置快照并输出新增条目)

参数:
  --before     前置快照文件
  --after      后置快照文件
  --out        输出 JSON 路径
  --cmd        要运行的探测命令
  --interactive 交互模式，等待用户手动操作后按回车对比
  -h, --help   显示帮助信息
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

async function promptWait(message: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const subCommand = argv[0];

  if (!subCommand || subCommand === '--help' || subCommand === '-h') {
    printUsage();
    return;
  }

  const flags = parseCliArgs(argv.slice(1));

  if (subCommand === 'snapshot') {
    if (!flags.out) {
      console.error('错误: 请通过 --out 参数指定快照输出路径！');
      printUsage();
      process.exit(1);
    }
    const targets = queryCredentials();
    const data: CredentialSnapshot = {
      timestamp: new Date().toISOString(),
      targets,
    };
    const outPath = path.resolve(flags.out);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[成功] 已捕获 ${targets.length} 个凭据条目名称，安全保存至: ${outPath}`);
    console.log(`条目名称列表:\n` + targets.map(t => `  - ${t}`).join('\n'));
  } else if (subCommand === 'diff') {
    if (!flags.before || !flags.after) {
      console.error('错误: 请通过 --before 和 --after 指定要对比的快照文件！');
      printUsage();
      process.exit(1);
    }
    const beforeData: CredentialSnapshot = JSON.parse(fs.readFileSync(flags.before, 'utf-8'));
    const afterData: CredentialSnapshot = JSON.parse(fs.readFileSync(flags.after, 'utf-8'));
    const diff = diffCredentials(beforeData.targets, afterData.targets);

    console.log(`\n===== 凭据管理器变更条目 =====`);
    console.log(`新增凭据条目 (${diff.summary.addedCount}):`);
    diff.added.forEach(t => console.log(`  + [新增] ${t}`));
    console.log(`移除凭据条目 (${diff.summary.removedCount}):`);
    diff.removed.forEach(t => console.log(`  - [移除] ${t}`));

    if (flags.out) {
      const outPath = path.resolve(flags.out);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(diff, null, 2), 'utf-8');
      console.log(`差异结果已保存至: ${outPath}`);
    }
  } else if (subCommand === 'run') {
    console.log(`[1/3] 正在记录初始凭据条目快照...`);
    const beforeTargets = queryCredentials();
    console.log(`当前共有 ${beforeTargets.length} 个凭据条目。`);

    if (flags.interactive === 'true' || !flags.cmd) {
      console.log(`\n>>> 交互模式：请在其他终端执行 agy 登录流程 (例如 agy login 或在 IDE 中登录) <<<`);
      await promptWait('操作完成后，请按 [Enter] 回车键继续记录后置凭据状态...');
    } else {
      console.log(`[2/3] 执行命令: ${flags.cmd}`);
      spawnSync(flags.cmd, { shell: true, stdio: 'inherit' });
    }

    console.log(`[3/3] 正在记录后置凭据条目快照并计算差异...`);
    const afterTargets = queryCredentials();
    const diff = diffCredentials(beforeTargets, afterTargets);

    console.log(`\n===== 凭据变更探测结果 =====`);
    if (diff.added.length > 0) {
      console.log(`【发现新增凭据条目 (${diff.added.length})】：`);
      diff.added.forEach(t => console.log(`  + [新增 Target] ${t}`));
      console.log(`\n提示: 请将上述 Target 模式配置到 backend/agy-profile.draft.json 中的 credentials.wincredTargetPatterns！`);
    } else {
      console.log(`未检测到任何新增凭据条目（凭据可能保存在磁盘文件中或未发生变动）。`);
    }

    if (diff.removed.length > 0) {
      console.log(`移除凭据条目 (${diff.removed.length}):`);
      diff.removed.forEach(t => console.log(`  - [移除 Target] ${t}`));
    }

    if (flags.out) {
      const outPath = path.resolve(flags.out);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(diff, null, 2), 'utf-8');
      console.log(`凭据差异已保存至: ${outPath}`);
    }
  } else {
    console.error(`未知子命令: ${subCommand}`);
    printUsage();
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('cred-diff.ts') ||
  process.argv[1].endsWith('cred-diff.js')
);

if (isDirectRun) {
  runCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
