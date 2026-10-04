import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import type { CliParsedArgs, FakeAgyOptions } from './types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 命令行参数解析
 */
export function parseCliArgs(argv: string[]): CliParsedArgs {
  const result: CliParsedArgs = {
    isStream: false,
    isVersion: false,
    isModels: false,
    isLogin: false,
    isHelp: false,
    extraArgs: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--version' || arg === '-v') {
      result.isVersion = true;
    } else if (arg === 'models') {
      result.isModels = true;
    } else if (arg === 'login') {
      result.isLogin = true;
    } else if (arg === '--help' || arg === '-h') {
      result.isHelp = true;
    } else if (arg === '--stream-json') {
      result.isStream = true;
    } else if (arg === '--output-format') {
      const val = argv[++i];
      if (val === 'stream-json') result.isStream = true;
    } else if (arg.startsWith('--output-format=')) {
      if (arg.slice('--output-format='.length) === 'stream-json') result.isStream = true;
    } else if (arg === '--input-format') {
      const val = argv[++i];
      if (val === 'stream-json') result.isStream = true;
    } else if (arg.startsWith('--input-format=')) {
      if (arg.slice('--input-format='.length) === 'stream-json') result.isStream = true;
    } else if (arg === '--prompt' || arg === '-p') {
      result.prompt = argv[++i];
    } else if (arg.startsWith('--prompt=')) {
      result.prompt = arg.slice('--prompt='.length);
    } else if (arg === '--model') {
      result.model = argv[++i];
    } else if (arg.startsWith('--model=')) {
      result.model = arg.slice('--model='.length);
    } else if (arg === '--effort') {
      result.effort = argv[++i];
    } else if (arg.startsWith('--effort=')) {
      result.effort = arg.slice('--effort='.length);
    } else if (arg === '--mode') {
      result.mode = argv[++i];
    } else if (arg.startsWith('--mode=')) {
      result.mode = arg.slice('--mode='.length);
    } else if (arg === '--dangerously-skip-permissions') {
      result.dangerouslySkipPermissions = true;
    } else {
      result.extraArgs.push(arg);
    }
  }

  // 环境变量中也支持强制指定 STREAM 模式
  if (process.env.FAKE_AGY_STREAM === '1' || process.env.FAKE_AGY_STREAM === 'true') {
    result.isStream = true;
  }

  return result;
}

/**
 * 寻找 fixtures/agy 根目录
 */
export function findFixturesDir(customDir?: string): string {
  if (customDir && fs.existsSync(customDir)) {
    return customDir;
  }

  if (process.env.FAKE_AGY_FIXTURES_DIR && fs.existsSync(process.env.FAKE_AGY_FIXTURES_DIR)) {
    return process.env.FAKE_AGY_FIXTURES_DIR;
  }

  // 1. 从 process.cwd() 向上查找
  let current = process.cwd();
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(current, 'fixtures', 'agy');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  // 2. 从当前文件所在目录向上查找
  current = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = path.join(current, 'fixtures', 'agy');
    if (fs.existsSync(candidate)) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return path.resolve(process.cwd(), 'fixtures', 'agy');
}

/**
 * 异步延迟（支持通过 AbortSignal 中断）
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      resolve();
    }, ms);

    if (signal) {
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    }
  });
}

/**
 * 在 FAKE_AGY_HOME 下模拟生成 transcript.jsonl
 */
export function simulateTranscript(
  homeDir: string,
  conversationId: string,
  scenario: string,
  fixturesDir: string
): void {
  try {
    const convDir = path.join(homeDir, 'conversations', conversationId);
    fs.mkdirSync(convDir, { recursive: true });

    const targetTranscript = path.join(convDir, 'transcript.jsonl');
    const sourceTranscript = path.join(fixturesDir, 'stream', scenario, 'transcript.jsonl');

    if (fs.existsSync(sourceTranscript)) {
      fs.copyFileSync(sourceTranscript, targetTranscript);
    } else if (!fs.existsSync(targetTranscript)) {
      // 自动生成一份标准的模拟 transcript steps
      const now = new Date().toISOString();
      const defaultSteps = [
        {
          step_index: 0,
          kind: 'user',
          content: 'Hello Antigravity',
          timestamp: now,
        },
        {
          step_index: 1,
          kind: 'thought',
          content: 'Processing request with internal reasoning...',
          timestamp: now,
        },
        {
          step_index: 2,
          kind: 'assistant',
          content: '我是 Antigravity 智能代码助手，很高兴为你提供帮助。',
          timestamp: now,
        },
      ];
      fs.writeFileSync(
        targetTranscript,
        defaultSteps.map(s => JSON.stringify(s)).join('\n') + '\n',
        'utf-8'
      );
    }
  } catch {
    // 忽略生成过程中的非致命错误
  }
}

/**
 * 尝试调用 statusline 桥接命令（如果已配置）
 */
export function tryInvokeStatusline(homeDir: string, fixturesDir: string): void {
  try {
    let statuslineCmd = process.env.AGY_STATUSLINE_CMD;

    if (!statuslineCmd && homeDir) {
      const settingsPaths = [
        path.join(homeDir, 'settings.json'),
        path.join(homeDir, '.antigravity', 'settings.json'),
      ];
      for (const p of settingsPaths) {
        if (fs.existsSync(p)) {
          const content = JSON.parse(fs.readFileSync(p, 'utf-8'));
          if (content.statusline) {
            statuslineCmd = content.statusline;
            break;
          }
        }
      }
    }

    if (!statuslineCmd) return;

    let payload = JSON.stringify({
      email: 'user@example.com',
      tier: 'pro',
      quotas: {
        'gemini-pro': {
          five_hour: { remaining: 1.0, resets_in_seconds: 15120 },
          weekly: { remaining: 0.82, resets_in_seconds: 309600 },
        },
      },
    });

    const statuslineFixture = path.join(fixturesDir, 'statusline', 'statusline.json');
    if (fs.existsSync(statuslineFixture)) {
      payload = fs.readFileSync(statuslineFixture, 'utf-8');
    }

    const child = spawn(statuslineCmd, [], {
      shell: true,
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    child.stdin.write(payload);
    child.stdin.end();
  } catch {
    // 静默忽略
  }
}

/**
 * Stream 模式回放
 */
export async function runStreamMode(
  options: FakeAgyOptions,
  stdout: NodeJS.WritableStream = process.stdout,
  signal?: AbortSignal
): Promise<number> {
  const fixturesDir = findFixturesDir(options.fixturesDir);
  const scenario = options.scenario || process.env.FAKE_AGY_SCENARIO || 'simple-chat';
  const speed =
    options.speed !== undefined
      ? options.speed
      : process.env.FAKE_AGY_SPEED !== undefined
        ? Number(process.env.FAKE_AGY_SPEED)
        : 1;

  const homeDir = options.homeDir || process.env.FAKE_AGY_HOME;

  // 定位 stdout.jsonl
  let jsonlPath = path.join(fixturesDir, 'stream', scenario, 'stdout.jsonl');
  if (!fs.existsSync(jsonlPath)) {
    // 降级回 simple-chat
    jsonlPath = path.join(fixturesDir, 'stream', 'simple-chat', 'stdout.jsonl');
  }

  let lines: string[] = [];
  if (fs.existsSync(jsonlPath)) {
    lines = fs
      .readFileSync(jsonlPath, 'utf-8')
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean);
  } else {
    // 最小合法默认回退输出
    lines = [
      JSON.stringify({
        offsetMs: 0,
        event: 'init',
        conversation_id: 'c502b261-c055-461f-a5dd-9ab622b785e1',
        init: { cwd: process.cwd(), permission_mode: 'always-proceed' },
      }),
      JSON.stringify({
        offsetMs: 50,
        event: 'step_update',
        conversation_id: 'c502b261-c055-461f-a5dd-9ab622b785e1',
        step_index: 0,
        state: 'DONE',
        step_type: 'agent_response',
        text_delta: 'Hello from fake-agy!',
      }),
      JSON.stringify({
        offsetMs: 100,
        event: 'result',
        conversation_id: 'c502b261-c055-461f-a5dd-9ab622b785e1',
        status: 'SUCCESS',
        response: 'Hello from fake-agy!',
      }),
    ];
  }

  // 提取 conversation_id 并生成 transcript
  let conversationId = 'c502b261-c055-461f-a5dd-9ab622b785e1';
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      if (obj.conversation_id) {
        conversationId = obj.conversation_id;
        break;
      }
    } catch {
      // ignore
    }
  }

  if (homeDir) {
    simulateTranscript(homeDir, conversationId, scenario, fixturesDir);
    tryInvokeStatusline(homeDir, fixturesDir);
  }

  let lastOffsetMs = 0;

  for (const line of lines) {
    if (signal?.aborted) {
      break;
    }

    let delayMs = 0;
    let outputLine = line;

    try {
      const parsed = JSON.parse(line);
      if (typeof parsed.offsetMs === 'number') {
        const currentOffset = parsed.offsetMs;
        const delta = Math.max(0, currentOffset - lastOffsetMs);
        lastOffsetMs = currentOffset;

        if (speed === 0) {
          delayMs = 0;
        } else {
          delayMs = Math.round(delta / speed);
        }

        // 剥离 offsetMs 恢复为真实 agy 官方 stream-json 输出
        const realEvent = { ...parsed };
        delete (realEvent as Record<string, unknown>).offsetMs;
        outputLine = JSON.stringify(realEvent);
      }
    } catch {
      // 保持原始输出
    }

    if (delayMs > 0 && !signal?.aborted) {
      await sleep(delayMs, signal);
    }

    if (signal?.aborted) {
      break;
    }

    stdout.write(outputLine + '\n');
  }

  return 0;
}

/**
 * 登录流程回放
 */
export async function runLoginMode(
  options: FakeAgyOptions,
  stdout: NodeJS.WritableStream = process.stdout,
  signal?: AbortSignal
): Promise<number> {
  const behavior = options.loginBehavior || process.env.FAKE_AGY_LOGIN || 'success';

  if (behavior === 'hang') {
    stdout.write('Please visit this URL to authorize Antigravity:\n');
    stdout.write(
      'https://accounts.google.com/o/oauth2/auth?client_id=fake-agy&response_type=code\n'
    );
    // 持续等待直到中断
    while (!signal?.aborted) {
      await sleep(1000, signal);
    }
    return 0;
  }

  if (behavior === 'fail') {
    stdout.write('Please visit this URL to authorize Antigravity:\n');
    stdout.write(
      'https://accounts.google.com/o/oauth2/auth?client_id=fake-agy&response_type=code\n'
    );
    await sleep(20, signal);
    stdout.write('Authentication failed: Authorization code expired or invalid.\n');
    return 1;
  }

  // 默认 success
  stdout.write('Please visit this URL to authorize Antigravity:\n');
  stdout.write(
    'https://accounts.google.com/o/oauth2/auth?client_id=fake-agy&response_type=code&redirect_uri=http://localhost:8790/oauth/callback\n'
  );
  await sleep(30, signal);
  stdout.write('Authentication successful! Logged in as test-user@example.com\n');
  return 0;
}

/**
 * 交互 / PTY 模式回放
 */
export async function runPtyMode(
  options: FakeAgyOptions,
  stdin: NodeJS.ReadableStream = process.stdin,
  stdout: NodeJS.WritableStream = process.stdout,
  signal?: AbortSignal
): Promise<number> {
  const fixturesDir = findFixturesDir(options.fixturesDir);

  const getUsageText = (): string => {
    const p = path.join(fixturesDir, 'pty', 'usage.txt');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8');
    return `Antigravity Quota Usage:
Account: user@example.com (Pro)

Gemini 2.5 Pro
  5-Hour Limit:  [████████████████████] 100% remaining (Resets in 4h 12m)
  Weekly Limit:  [████████████████░░░░] 82% remaining (Resets in 3d 14h)
`;
  };

  const getCreditsText = (): string => {
    const p = path.join(fixturesDir, 'pty', 'credits.txt');
    if (fs.existsSync(p)) return fs.readFileSync(p, 'utf-8');
    return `Antigravity Credits:
Available Credits: $15.50
Monthly Grant: $20.00
Expires: 2026-10-31
`;
  };

  stdout.write('Antigravity Interactive Terminal v1.2.12\n');
  stdout.write('Type /usage, /credits or /exit.\n> ');

  return new Promise<number>((resolve) => {
    let resolved = false;
    const finish = (code: number) => {
      if (!resolved) {
        resolved = true;
        rl.close();
        resolve(code);
      }
    };

    const rl = readline.createInterface({
      input: stdin,
      crlfDelay: Infinity,
      terminal: false,
    });

    if (signal) {
      signal.addEventListener('abort', () => finish(0), { once: true });
    }

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (trimmed.includes('/usage')) {
        stdout.write('\n' + getUsageText() + '\n> ');
      } else if (trimmed.includes('/credits')) {
        stdout.write('\n' + getCreditsText() + '\n> ');
      } else if (
        trimmed === 'exit' ||
        trimmed === '/exit' ||
        trimmed === 'quit' ||
        trimmed === '/quit' ||
        trimmed.includes('\x03') // Ctrl+C
      ) {
        stdout.write('\nExiting Antigravity.\n');
        finish(0);
      } else if (trimmed === 'login') {
        runLoginMode(options, stdout, signal).then((c) => finish(c));
      } else if (trimmed) {
        stdout.write(`\nUnknown command: ${trimmed}\n> `);
      }
    });

    rl.on('close', () => {
      finish(0);
    });

    stdin.on('end', () => {
      finish(0);
    });
  });
}

/**
 * fake-agy 统一执行入口函数
 */
export async function executeFakeAgy(
  rawArgv: string[],
  options: FakeAgyOptions = {},
  io: {
    stdin?: NodeJS.ReadableStream;
    stdout?: NodeJS.WritableStream;
    stderr?: NodeJS.WritableStream;
  } = {},
  signal?: AbortSignal
): Promise<number> {
  const stdout = io.stdout || process.stdout;
  const stdin = io.stdin || process.stdin;

  const args = parseCliArgs(rawArgv);

  // 1. --version
  if (args.isVersion) {
    stdout.write('agy 1.2.12\n');
    return 0;
  }

  // 2. models
  if (args.isModels) {
    stdout.write(`Available models:
  gemini-2.5-pro (default)
  gemini-2.5-flash
`);
    return 0;
  }

  // 3. --help
  if (args.isHelp) {
    stdout.write(`Antigravity Agent CLI (fake-agy replay emulator)
Usage:
  agy [options]
  agy login
  agy models

Options:
  --stream-json                    Enable JSON streaming output
  --prompt <prompt>, -p <prompt>   Initial prompt
  --dangerously-skip-permissions   Skip confirmation prompts
  --model <model>                  Select model
  --version, -v                    Show version
  --help, -h                       Show help
`);
    return 0;
  }

  // 4. login 子命令
  if (args.isLogin) {
    return await runLoginMode(options, stdout, signal);
  }

  // 5. stream 模式
  if (args.isStream) {
    return await runStreamMode(options, stdout, signal);
  }

  // 6. 交互 / PTY 模式
  return await runPtyMode(options, stdin, stdout, signal);
}
