import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { RollbackGuard } from './rollback.js';

export interface StatuslineCaptureSummary {
  timestamp: string;
  settingsPath: string;
  streamModeCaptured: boolean;
  interactiveModeCaptured: boolean;
  streamCaptureEntries: unknown[];
  interactiveCaptureEntries: unknown[];
  conclusion: {
    statuslineInHeadless: boolean;
    explanation: string;
  };
}

export function findDefaultSettingsPath(): string {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  const candidate1 = path.join(home, '.antigravity', 'settings.json');
  const candidate2 = path.join(process.env.APPDATA || '', 'antigravity', 'settings.json');

  if (fs.existsSync(candidate1)) return candidate1;
  if (candidate2 && fs.existsSync(candidate2)) return candidate2;
  return candidate1; // 默认路径
}

/**
 * 创建 statusline 接收器可执行脚本
 */
export function createStatuslineSink(outputLogFile: string, targetDir: string): {
  jsPath: string;
  cmdPath: string;
  commandString: string;
} {
  fs.mkdirSync(targetDir, { recursive: true });

  const jsPath = path.join(targetDir, 'statusline-sink.js');
  const cmdPath = path.join(targetDir, 'statusline-sink.cmd');

  const normalizedLog = outputLogFile.replace(/\\/g, '/');

  // 生成 JS 脚本：将 stdin 传入的每行 JSON 原样追加到 log 文件
  const jsContent = `
const fs = require('node:fs');
const readline = require('node:readline');

const logFile = ${JSON.stringify(normalizedLog)};
const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  if (!line || !line.trim()) return;
  const entry = {
    timestamp: new Date().toISOString(),
    raw: line,
    mode: process.env.AGY_CAPTURE_MODE || 'unknown'
  };
  try {
    entry.json = JSON.parse(line);
  } catch {}
  fs.appendFileSync(logFile, JSON.stringify(entry) + '\\n', 'utf-8');
});
`;

  fs.writeFileSync(jsPath, jsContent, 'utf-8');

  // 生成 Windows .cmd 包装，方便作为 CLI 可执行命令调用
  const cmdContent = `@echo off\r\nnode "${jsPath.replace(/\//g, '\\')}"\r\n`;
  fs.writeFileSync(cmdPath, cmdContent, 'utf-8');

  return {
    jsPath,
    cmdPath,
    commandString: process.platform === 'win32' ? `"${cmdPath}"` : `node "${jsPath}"`,
  };
}

/**
 * 将 statusline 配置注入 settings JSON 内容
 */
export function injectStatuslineConfig(rawSettingsJson: string | null, statuslineCmd: string): string {
  let settings: Record<string, unknown> = {};
  if (rawSettingsJson && rawSettingsJson.trim()) {
    try {
      settings = JSON.parse(rawSettingsJson);
    } catch {
      settings = {};
    }
  }

  settings.statusline = statuslineCmd;
  return JSON.stringify(settings, null, 2);
}

function promptWait(message: string): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(message, () => {
      rl.close();
      resolve();
    });
  });
}

function printUsage(): void {
  console.log(`
[statusline-capture] agy 状态栏 (statusline) 捕获与协议探测工具
用于阶段 0 探测清单 V9：
1. 验证无界面/stream-json 模式下 statusline 是否仍会被触发回调；
2. 捕获 stdin 传入的完整 JSON 数据（配额、邮箱、上下文用量等）。

【安全机制】：本工具会自动备份现有的 settings.json，在测试完成后（或按下 Ctrl+C、发生异常时）
【100% 自动回滚】还原所有原始配置，绝不污染系统！

用法说明:
  npx tsx tools/discover/statusline-capture.ts [选项]

选项:
  --settings <path>  指定 settings.json 路径 (默认: ~/.antigravity/settings.json)
  --out <dir>        指定产物保存目录 (默认: fixtures/agy/statusline)
  --mode <type>      运行模式: stream | interactive | both | wait (默认: both)
  -h, --help         查看帮助信息

示例:
  npx tsx tools/discover/statusline-capture.ts
  npx tsx tools/discover/statusline-capture.ts --mode stream
  npx tsx tools/discover/statusline-capture.ts --mode wait
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

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    printUsage();
    return;
  }

  const flags = parseCliArgs(argv);
  const settingsPath = path.resolve(flags.settings || findDefaultSettingsPath());
  const outDir = path.resolve(flags.out || path.join(process.cwd(), 'fixtures', 'agy', 'statusline'));
  const testMode = flags.mode || 'both';

  fs.mkdirSync(outDir, { recursive: true });
  const logFile = path.join(outDir, 'statusline-stream.jsonl');
  // 如果已存在先清空当前日志
  if (fs.existsSync(logFile)) {
    fs.writeFileSync(logFile, '', 'utf-8');
  }

  console.log(`\n======================================================`);
  console.log(`[statusline-capture] 准备临时配置 statusline 捕获...`);
  console.log(`Settings 文件路径: ${settingsPath}`);
  console.log(`数据产物保存目录: ${outDir}`);
  console.log(`======================================================\n`);

  const guard = new RollbackGuard();
  guard.installSignalHooks();

  try {
    // 1. 备份原 settings.json
    console.log('[1/4] 备份原始 settings.json...');
    const backupLocation = guard.backupFile(settingsPath);
    console.log(`原始文件状态: ${backupLocation ? `已备份至 ${backupLocation}` : '原文件不存在（将在退出时自动清理删除）'}`);

    // 2. 生成 sink 捕获命令
    const sink = createStatuslineSink(logFile, path.join(outDir, 'bin'));
    guard.trackNewFile(sink.jsPath);
    guard.trackNewFile(sink.cmdPath);

    // 3. 写入修改后的 settings
    console.log(`[2/4] 临时注入 statusline 命令配置: ${sink.commandString}`);
    const originalContent = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf-8') : null;
    const newSettingsContent = injectStatuslineConfig(originalContent, sink.commandString);
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, newSettingsContent, 'utf-8');

    // 4. 执行探测（是否捕获到回调在第 5 步从日志统一汇总）
    if (testMode === 'wait') {
      console.log(`\n>>> 配置已生效！现在您可以在终端或 IDE 中任意启动 agy 运行交互或 stream 任务 <<<`);
      await promptWait('测试完毕后，请按 [Enter] 回车键立即恢复原配置并汇总结果...');
    } else {
      if (testMode === 'stream' || testMode === 'both') {
        console.log(`\n[3/4] 正在探测无界面 (stream-json) 模式下是否调用 statusline...`);
        const streamProc = spawnSync('agy', ['--input-format', 'stream-json', '--output-format', 'stream-json', '--prompt', 'echo ping', '--print'], {
          shell: true,
          env: { ...process.env, AGY_CAPTURE_MODE: 'stream' },
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 15000,
        });
        console.log(`stream 探测命令退出码: ${streamProc.status}`);
      }

      if (testMode === 'interactive' || testMode === 'both') {
        console.log(`\n[4/4] 正在探测交互模式下是否调用 statusline...`);
        console.log(`提示: 如果需要全面捕获交互模式数据，请手动运行一次常规 agy 对话。`);
      }
    }

    // 5. 汇总日志
    const entries: Array<{ timestamp: string; raw: string; mode: string; json?: unknown }> = [];
    if (fs.existsSync(logFile)) {
      const lines = fs.readFileSync(logFile, 'utf-8').split(/\r?\n/).filter(l => l.trim().length > 0);
      for (const line of lines) {
        try {
          entries.push(JSON.parse(line));
        } catch {
          // ignore
        }
      }
    }

    const streamEntries = entries.filter(e => e.mode === 'stream');
    const otherEntries = entries.filter(e => e.mode !== 'stream');

    const summary: StatuslineCaptureSummary = {
      timestamp: new Date().toISOString(),
      settingsPath,
      streamModeCaptured: streamEntries.length > 0,
      interactiveModeCaptured: otherEntries.length > 0,
      streamCaptureEntries: streamEntries,
      interactiveCaptureEntries: otherEntries,
      conclusion: {
        statuslineInHeadless: streamEntries.length > 0,
        explanation: streamEntries.length > 0
          ? '探测证实：agy 在无界面 stream-json 模式下依然会触发 statusline 回调！可作为零成本被动额度来源。'
          : '未在 stream-json 模式下捕获到 statusline 回调（需在交互模式或依赖 /usage 探针）。',
      },
    };

    console.log(`\n===== Statusline 探测总结 =====`);
    console.log(`捕获总记录条数: ${entries.length}`);
    console.log(`Stream 模式捕获到回调: ${summary.conclusion.statuslineInHeadless ? '【是】' : '【否】'}`);
    console.log(`结论: ${summary.conclusion.explanation}\n`);

    const summaryFile = path.join(outDir, 'statusline-summary.json');
    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), 'utf-8');
    console.log(`详细总结报告已保存至: ${summaryFile}`);
  } finally {
    // 强制自动恢复原配置
    console.log(`\n[安全保护] 正在执行 Rollback 恢复原始 settings.json...`);
    guard.rollbackSync();
    console.log(`[完成] 原始配置已 100% 还原！`);
  }
}

const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('statusline-capture.ts') ||
  process.argv[1].endsWith('statusline-capture.js')
);

if (isDirectRun) {
  runCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
