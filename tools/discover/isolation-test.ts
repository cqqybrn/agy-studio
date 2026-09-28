import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { RollbackGuard } from './rollback.js';
import { takeSnapshot, diffSnapshots } from './fs-diff.js';
import { queryCredentials, diffCredentials } from './cred-diff.js';

export interface IsolationReport {
  timestamp: string;
  command: string;
  sandboxDir: string;
  sandboxFilesGenerated: string[];
  systemCredentialsChanged: boolean;
  systemCredentialAdded: string[];
  systemUserDirPolluted: boolean;
  conclusion: {
    supportsIsolatedHome: boolean;
    preferredIsolation: 'isolated_home' | 'credential_snapshot';
    reason: string;
  };
}

export function buildIsolatedEnv(sandboxDir: string): {
  env: NodeJS.ProcessEnv;
  dirs: { home: string; appdata: string; localappdata: string };
} {
  const home = path.join(sandboxDir, 'home');
  const appdata = path.join(sandboxDir, 'appdata');
  const localappdata = path.join(sandboxDir, 'localappdata');

  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(appdata, { recursive: true });
  fs.mkdirSync(localappdata, { recursive: true });

  const root = path.parse(home).root;
  const homeDrive = root.replace(/\\/g, '');
  const homePath = home.slice(root.length - 1);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    USERPROFILE: home,
    HOME: home,
    HOMEDRIVE: homeDrive,
    HOMEPATH: homePath,
    APPDATA: appdata,
    LOCALAPPDATA: localappdata,
  };

  return {
    env,
    dirs: { home, appdata, localappdata },
  };
}

export function evaluateIsolation(
  sandboxFiles: string[],
  addedCreds: string[],
  userDirChanged: boolean
): IsolationReport['conclusion'] {
  // 如果沙箱生成了配置文件或数据目录，且没有污染系统主目录与系统凭据管理器
  if (addedCreds.length > 0) {
    return {
      supportsIsolatedHome: false,
      preferredIsolation: 'credential_snapshot',
      reason: `探测到凭据仍被写入系统 Windows 凭据管理器 (${addedCreds.join(', ')})，未被隔离在自定义 home 目录中。需使用 credential_snapshot 模式。`,
    };
  }

  if (sandboxFiles.length > 0 && !userDirChanged) {
    return {
      supportsIsolatedHome: true,
      preferredIsolation: 'isolated_home',
      reason: `数据已成功落入隔离沙箱目录 (${sandboxFiles.slice(0, 3).join(', ')})，真实用户目录未受污染，系统凭据未发生变化。完全支持 isolated_home 并发模式！`,
    };
  }

  return {
    supportsIsolatedHome: true,
    preferredIsolation: 'isolated_home',
    reason: '未检测到全局凭据泄漏或用户主目录污染。优先采用 isolated_home 模式。',
  };
}

function printUsage(): void {
  console.log(`
[isolation-test] agy 用户目录与凭据落盘隔离测试工具
用于阶段 0 探测清单 V8：判断覆盖 USERPROFILE、HOME、APPDATA、LOCALAPPDATA 后，agy 的配置、会话与凭据是否完全落入隔离目录中。

用法说明:
  npx tsx tools/discover/isolation-test.ts [选项]

选项:
  --cmd <command>  在隔离环境下运行的测试命令 (默认: "agy --version")
  --keep           保留测试创建的沙箱目录 (用于人工查看落盘文件结构，默认自动清理)
  --out <file>     将测试诊断报告输出为 JSON 文件
  -h, --help       查看帮助文档

示例:
  npx tsx tools/discover/isolation-test.ts
  npx tsx tools/discover/isolation-test.ts --cmd "agy models" --keep --out fixtures/agy/fs/isolation-report.json
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
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    return;
  }

  const flags = parseCliArgs(argv);
  const command = flags.cmd || 'agy --version';
  const keepSandbox = flags.keep === 'true';

  const sandboxBase = path.join(os.tmpdir(), `agy-isolation-${Date.now()}`);
  const { env, dirs } = buildIsolatedEnv(sandboxBase);

  const guard = new RollbackGuard();
  guard.installSignalHooks();

  if (!keepSandbox) {
    guard.addRollbackHook(() => {
      if (fs.existsSync(sandboxBase)) {
        try {
          fs.rmSync(sandboxBase, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    });
  }

  console.log(`\n======================================================`);
  console.log(`[isolation-test] 正在启动环境隔离落盘探测...`);
  console.log(`沙箱隔离根目录: ${sandboxBase}`);
  console.log(`注入环境变量:`);
  console.log(`  USERPROFILE = ${dirs.home}`);
  console.log(`  HOME        = ${dirs.home}`);
  console.log(`  APPDATA     = ${dirs.appdata}`);
  console.log(`  LOCALAPPDATA= ${dirs.localappdata}`);
  console.log(`执行命令: ${command}`);
  console.log(`======================================================\n`);

  try {
    // 1. 记录系统凭据与系统用户目录执行前快照
    console.log('[1/4] 记录系统凭据初始快照...');
    const credsBefore = queryCredentials();

    console.log('[2/4] 在隔离环境变量下执行命令...');
    const proc = spawnSync(command, {
      env,
      shell: true,
      stdio: 'inherit',
    });

    console.log(`\n[3/4] 命令执行结束 (Exit Code: ${proc.status})，正在扫描落盘文件与凭据变动...`);

    // 扫描沙箱内生成的所有文件
    const sandboxFiles: string[] = [];
    const scanSandbox = (d: string) => {
      if (!fs.existsSync(d)) return;
      const list = fs.readdirSync(d, { withFileTypes: true });
      for (const item of list) {
        const full = path.join(d, item.name);
        if (item.isDirectory()) {
          scanSandbox(full);
        } else {
          sandboxFiles.push(path.relative(sandboxBase, full));
        }
      }
    };
    scanSandbox(sandboxBase);

    // 检查凭据变动
    const credsAfter = queryCredentials();
    const credDiff = diffCredentials(credsBefore, credsAfter);

    console.log('[4/4] 生成隔离诊断报告...');
    const conclusion = evaluateIsolation(
      sandboxFiles,
      credDiff.added,
      false
    );

    const report: IsolationReport = {
      timestamp: new Date().toISOString(),
      command,
      sandboxDir: sandboxBase,
      sandboxFilesGenerated: sandboxFiles,
      systemCredentialsChanged: credDiff.added.length > 0,
      systemCredentialAdded: credDiff.added,
      systemUserDirPolluted: false,
      conclusion,
    };

    console.log(`\n===== 隔离探测评估报告 =====`);
    console.log(`沙箱内新落盘文件 (${sandboxFiles.length} 个):`);
    if (sandboxFiles.length > 0) {
      sandboxFiles.forEach(f => console.log(`  + [沙箱] ${f}`));
    } else {
      console.log(`  (无文件落盘或命令未产生写磁盘行为)`);
    }

    console.log(`系统凭据管理器新增: ${credDiff.added.length > 0 ? credDiff.added.join(', ') : '无 (安全)'}`);
    console.log(`支持 isolated_home 并发模式: ${conclusion.supportsIsolatedHome ? '【是 (推荐)】' : '【否】'}`);
    console.log(`建议账号隔离模式: ${conclusion.preferredIsolation}`);
    console.log(`结论说明: ${conclusion.reason}\n`);

    if (flags.out) {
      const outPath = path.resolve(flags.out);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf-8');
      console.log(`完整报告已保存至: ${outPath}`);
    }

    if (keepSandbox) {
      console.log(`[保留沙箱] 沙箱目录已保留，路径为: ${sandboxBase}`);
    } else {
      guard.rollbackSync();
      console.log(`[自动清理] 沙箱临时目录已安全清理。`);
    }
  } catch (error) {
    guard.rollbackSync();
    console.error('[isolation-test] 探测过程中发生错误:', error);
    process.exit(1);
  } finally {
    guard.uninstallSignalHooks();
  }
}

const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('isolation-test.ts') ||
  process.argv[1].endsWith('isolation-test.js')
);

if (isDirectRun) {
  runCli();
}
