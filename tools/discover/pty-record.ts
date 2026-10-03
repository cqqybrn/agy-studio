import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export interface PtyRecordResult {
  mode: string;
  rawText: string;
  cleanText: string;
  timestamp: string;
  commandList: string[];
  rawPath?: string;
  cleanPath?: string;
}

/**
 * 完整 ANSI 转义序列剥离正则
 */
// eslint-disable-next-line no-control-regex -- matching the ESC control character is the point
export const ANSI_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '');
}

/**
 * 脱敏终端输出中的个人敏感信息（邮箱、OAuth 令牌、Bearer Token、Code 参数）
 */
export function sanitizeTerminalOutput(text: string): string {
  let result = text;
  // 脱敏邮箱
  result = result.replace(/[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+/g, '<REDACTED_EMAIL>');
  // 脱敏 OAuth code 与 token
  result = result.replace(/(code=)[a-zA-Z0-9_./-]+/gi, '$1<REDACTED_CODE>');
  result = result.replace(/(token=)[a-zA-Z0-9_./-]+/gi, '$1<REDACTED_TOKEN>');
  result = result.replace(/(Bearer\s+)[a-zA-Z0-9_./-]+/gi, '$1<REDACTED_BEARER>');
  return result;
}

interface PtyProcess {
  onData(cb: (data: string) => void): void;
  write(data: string): void;
  kill(signal?: string): void;
  onExit(cb: (res: { exitCode: number }) => void): void;
}

async function loadPty(): Promise<unknown | null> {
  try {
    const mod = await import('node-pty');
    return (mod as { default?: unknown }).default || mod;
  } catch {
    return null;
  }
}

/**
 * 统一抽象 PTY 进程启动器：若 node-pty 可用则启动真实伪终端，否则使用 child_process 管道仿真
 */
export async function spawnTerminalSession(options: {
  command: string;
  args: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}): Promise<PtyProcess> {
  const ptyModule = await loadPty();

  if (ptyModule && typeof (ptyModule as { spawn: unknown }).spawn === 'function') {
    const ptySpawn = (ptyModule as { spawn: (...args: unknown[]) => PtyProcess }).spawn;
    const proc = ptySpawn(options.command, options.args, {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: options.cwd || process.cwd(),
      env: (options.env || process.env) as Record<string, string>,
    });
    return proc;
  } else {
    // 降级使用 child_process 仿真
    const child = spawn(options.command, options.args, {
      cwd: options.cwd || process.cwd(),
      env: options.env || process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });

    let exitCb: ((res: { exitCode: number }) => void) | null = null;
    child.on('close', (code) => {
      if (exitCb) exitCb({ exitCode: code ?? 0 });
    });

    return {
      onData: (cb: (data: string) => void) => {
        child.stdout?.on('data', (d: Buffer) => cb(d.toString('utf-8')));
        child.stderr?.on('data', (d: Buffer) => cb(d.toString('utf-8')));
      },
      write: (data: string) => {
        child.stdin?.write(data);
      },
      kill: () => {
        child.kill();
      },
      onExit: (cb) => {
        exitCb = cb;
      },
    };
  }
}

/**
 * 执行伪终端录制会话
 */
export async function recordPtySession(options: {
  binPath?: string;
  mode: 'usage' | 'login' | 'script';
  commands?: string[];
  timeoutMs?: number;
  outputDir?: string;
  filePrefix?: string;
}): Promise<PtyRecordResult> {
  const bin = options.binPath || (process.env.AGY_BIN || 'agy');
  const timeoutMs = options.timeoutMs || 25000;
  const commandList = options.commands || (
    options.mode === 'usage' ? ['/usage', '/credits'] :
    options.mode === 'login' ? ['login'] :
    ['--help']
  );

  let rawBuffer = '';
  const proc = await spawnTerminalSession({
    command: bin,
    args: options.mode === 'login' ? ['login'] : [],
  });

  proc.onData((chunk) => {
    rawBuffer += chunk;
  });

  const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

  // 控制台命令调度逻辑
  const scheduleCommands = async () => {
    // 等待终端初次启动稳定
    await sleep(2000);

    if (options.mode === 'usage' || options.mode === 'script') {
      for (const cmd of commandList) {
        proc.write(`${cmd}\r`);
        await sleep(3500); // 等待命令回显
      }
      proc.write('\x03'); // 发送 Ctrl+C 退出
      await sleep(1000);
    } else if (options.mode === 'login') {
      // 登录模式通常需要显示 OAuth 链接，等待输出出现
      await sleep(6000);
      proc.write('\x03'); // 捕获到链接后发送 Ctrl+C 中止
    }
  };

  await Promise.race([
    scheduleCommands(),
    sleep(timeoutMs),
  ]);

  try {
    proc.kill();
  } catch {
    // ignore
  }

  const cleanText = sanitizeTerminalOutput(stripAnsi(rawBuffer));

  const result: PtyRecordResult = {
    mode: options.mode,
    rawText: rawBuffer,
    cleanText,
    timestamp: new Date().toISOString(),
    commandList,
  };

  if (options.outputDir) {
    const dir = path.resolve(options.outputDir);
    fs.mkdirSync(dir, { recursive: true });
    const prefix = options.filePrefix || `${options.mode}-${Date.now()}`;
    const rawPath = path.join(dir, `${prefix}.raw.txt`);
    const cleanPath = path.join(dir, `${prefix}.clean.txt`);
    const metaPath = path.join(dir, `${prefix}.meta.json`);

    fs.writeFileSync(rawPath, rawBuffer, 'utf-8');
    fs.writeFileSync(cleanPath, cleanText, 'utf-8');
    fs.writeFileSync(metaPath, JSON.stringify({
      mode: options.mode,
      timestamp: result.timestamp,
      commands: commandList,
      rawLength: rawBuffer.length,
      cleanLength: cleanText.length,
    }, null, 2), 'utf-8');

    result.rawPath = rawPath;
    result.cleanPath = cleanPath;
  }

  return result;
}

function printUsage(): void {
  console.log(`
[pty-record] agy 控制台交互/登录流录制工具 (基于 node-pty 与管道仿真)
用于阶段 0 探测清单 V10：探明交互模式下 /usage、/credits 输出格式，以及登录命令的 OAuth 流程与提示符。

用法说明:
  npx tsx tools/discover/pty-record.ts [子命令/模式] [选项]

模式:
  usage   启动 agy 交互环境，依次发送 /usage 和 /credits 命令并录制输出
  login   启动 agy 登录流程，录制授权链接输出并脱敏
  script  根据参数中的自定义命令列表录制

选项:
  --bin <path>         agy 可执行文件路径 (默认优先使用 PATH 或 AGY_BIN)
  --out <dir>          产物保存目录 (默认: fixtures/agy/pty)
  --prefix <name>      输出文件命名前缀 (默认使用模式名称)
  --commands <cmd1,..> 自定义发送的命令序列 (英文逗号分隔)
  --timeout <ms>       最大录制超时毫秒数 (默认: 25000)
  -h, --help           显示此帮助信息

产出文件:
  <prefix>.raw.txt    包含原始 ANSI 转义码的录屏文本 (用于 fake-agy 伪终端回放)
  <prefix>.clean.txt  去除 ANSI 控制符并经过隐私脱敏的纯文本 (用于解析器研发)
  <prefix>.meta.json  录制元数据记录

示例:
  npx tsx tools/discover/pty-record.ts usage --out fixtures/agy/pty
  npx tsx tools/discover/pty-record.ts login --out fixtures/agy/pty
  npx tsx tools/discover/pty-record.ts script --commands "/usage,/credits,/help"
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
  const subCommand = argv[0];

  if (!subCommand || subCommand === '--help' || subCommand === '-h') {
    printUsage();
    return;
  }

  const flags = parseCliArgs(argv.slice(1));
  let mode: 'usage' | 'login' | 'script';

  if (subCommand === 'usage' || subCommand === 'login' || subCommand === 'script') {
    mode = subCommand;
  } else {
    console.error(`未知子命令: ${subCommand}`);
    printUsage();
    process.exit(1);
  }

  const outDir = flags.out || path.join(process.cwd(), 'fixtures', 'agy', 'pty');
  const commands = flags.commands ? flags.commands.split(',').map(c => c.trim()) : undefined;
  const timeoutMs = flags.timeout ? parseInt(flags.timeout, 10) : undefined;

  console.log(`\n======================================================`);
  console.log(`[pty-record] 开始在伪终端中录制 agy 会话...`);
  console.log(`录制模式: ${mode}`);
  console.log(`目标保存目录: ${path.resolve(outDir)}`);
  console.log(`======================================================\n`);

  try {
    const result = await recordPtySession({
      binPath: flags.bin,
      mode,
      commands,
      timeoutMs,
      outputDir: outDir,
      filePrefix: flags.prefix || `${mode}-recording`,
    });

    console.log(`\n[完成] 伪终端会话录制结束！`);
    console.log(`原始 ANSI 产物: ${result.rawPath}`);
    console.log(`脱敏无 ANSI 纯文本: ${result.cleanPath}`);
    console.log(`\n录制内容截览 (前 10 行):\n----------------------------------------`);
    const lines = result.cleanText.split(/\r?\n/).slice(0, 10);
    lines.forEach(l => console.log(l));
    console.log(`----------------------------------------\n`);
  } catch (err) {
    console.error('[pty-record] 录制过程中失败:', err);
    process.exit(1);
  }
}

const isDirectRun = process.argv[1] && (
  process.argv[1].endsWith('pty-record.ts') ||
  process.argv[1].endsWith('pty-record.js')
);

if (isDirectRun) {
  runCli();
}
