import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { spawn, spawnSync } from 'node:child_process';

/**
 * CLI 命令行参数接口
 */
export interface CliArgs {
  scenario?: string;
  prompt?: string;
  cwd?: string;
  model?: string;
  turns?: string;
  abortAfterMs?: number;
  extraArgs: string[];
  frameTemplate?: string;
  help?: boolean;
}

/**
 * 录制元数据结构 (meta.json)
 */
export interface StreamRecordingMeta {
  scenario: string;
  agyVersion: string;
  recordedAt: string;
  durationMs: number;
  exitCode: number | null;
  exitSignal: string | null;
  command: {
    bin: string;
    argv: string[];
    cwd: string;
  };
  options: {
    scenario: string;
    prompt?: string;
    cwd?: string;
    model?: string;
    turnsFile?: string;
    abortAfterMs?: number;
    extraArgs?: string[];
    frameTemplate?: string;
  };
  turnsCount: number;
  aborted: boolean;
}

/**
 * 解析命令行参数
 */
export function parseCliArgs(argv: string[]): CliArgs {
  const result: CliArgs = {
    extraArgs: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      result.help = true;
      return result;
    }

    if (arg === '--scenario') {
      result.scenario = argv[++i];
    } else if (arg.startsWith('--scenario=')) {
      result.scenario = arg.slice('--scenario='.length);
    } else if (arg === '--prompt' || arg === '-p') {
      result.prompt = argv[++i];
    } else if (arg.startsWith('--prompt=')) {
      result.prompt = arg.slice('--prompt='.length);
    } else if (arg === '--cwd') {
      result.cwd = argv[++i];
    } else if (arg.startsWith('--cwd=')) {
      result.cwd = arg.slice('--cwd='.length);
    } else if (arg === '--model') {
      result.model = argv[++i];
    } else if (arg.startsWith('--model=')) {
      result.model = arg.slice('--model='.length);
    } else if (arg === '--turns') {
      result.turns = argv[++i];
    } else if (arg.startsWith('--turns=')) {
      result.turns = arg.slice('--turns='.length);
    } else if (arg === '--abort-after-ms') {
      const val = argv[++i];
      result.abortAfterMs = val ? Number.parseInt(val, 10) : undefined;
    } else if (arg.startsWith('--abort-after-ms=')) {
      result.abortAfterMs = Number.parseInt(arg.slice('--abort-after-ms='.length), 10);
    } else if (arg === '--frame-template') {
      result.frameTemplate = argv[++i];
    } else if (arg.startsWith('--frame-template=')) {
      result.frameTemplate = arg.slice('--frame-template='.length);
    } else if (arg === '--extra-args') {
      // 收集之后的所有参数，或者单项字符串
      const next = argv[++i];
      if (next) {
        // 如果用户传入的是带空格的字符串，如 "--effort high"，拆分为参数
        result.extraArgs.push(...next.trim().split(/\s+/));
      }
    } else if (arg.startsWith('--extra-args=')) {
      const rest = arg.slice('--extra-args='.length);
      result.extraArgs.push(...rest.trim().split(/\s+/));
    }
  }

  return result;
}

/**
 * 打印使用说明帮助手册
 */
export function printHelp(): void {
  const helpText = `
用法: npx tsx tools/discover/record-stream.ts --scenario <name> (--prompt <text> | --turns <file>) [选项]

参数说明:
  --scenario <name>        [必填] 录制场景名称 (如: simple-chat, file-ops, multi-turn)
  --prompt <text>          用户输入内容 (单轮，或作为多轮的首轮)
  --turns <file>           多轮对话输入文件路径，每行代表一轮 prompt 或 user 帧 JSON
  --cwd <dir>              工作目录 (默认为当前工作目录)
  --model <model>          指定模型 (传递给 agy --model)
  --abort-after-ms <ms>    指定毫秒后强制中止进程 (用于录制中途中止场景)
  --extra-args <args>      传递给 agy CLI 的额外参数 (如 "--effort high")
  --frame-template <str>   自定义发送给 stdin 的 user 帧 JSON 模板，默认:
                           '{"event":"user","message":{"content":"{{prompt}}"}}'
                           可使用 {{prompt}} 作为用户输入占位符
  -h, --help               显示本帮助信息

产出文件:
  fixtures/agy/stream/<scenario>/stdout.jsonl  (每行附加 offsetMs 相对毫秒时间戳)
  fixtures/agy/stream/<scenario>/stderr.txt    (标准错误输出)
  fixtures/agy/stream/<scenario>/meta.json     (录制元数据：版本、参数、耗时、退出码)
  * 所有产出在落盘前均自动脱敏 (移除用户主目录、邮箱、疑似令牌等)

示例:
  # 场景 1: 纯对话录制
  npx tsx tools/discover/record-stream.ts --scenario simple-chat --prompt "你好，请用一句话介绍你自己"

  # 场景 2: 多轮对话录制
  npx tsx tools/discover/record-stream.ts --scenario multi-turn --turns path/to/turns.txt

  # 场景 3: 中途中止测试
  npx tsx tools/discover/record-stream.ts --scenario abort-midway --prompt "写一篇 5000 字的小说" --abort-after-ms 2000
`;
  console.log(helpText.trim());
}

/**
 * 检查系统是否安装了 agy 可执行程序
 */
export function checkAgyInstalled(): { installed: boolean; version: string; error?: string } {
  try {
    const isWin = process.platform === 'win32';
    const res = spawnSync('agy', ['--version'], {
      encoding: 'utf-8',
      windowsHide: true,
    });

    if (res.status === 0 && res.stdout) {
      return { installed: true, version: res.stdout.trim() };
    }

    // 尝试直接通过 where.exe / which 探测
    const checker = isWin ? 'where.exe' : 'which';
    const checkRes = spawnSync(checker, ['agy'], {
      encoding: 'utf-8',
      windowsHide: true,
    });

    if (checkRes.status === 0) {
      return { installed: true, version: 'unknown' };
    }

    return {
      installed: false,
      version: '',
      error: res.stderr ? res.stderr.trim() : '在 PATH 环境变量中未找到 agy 命令',
    };
  } catch (err: unknown) {
    return {
      installed: false,
      version: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 数据脱敏函数
 * 对邮箱、疑似 Token 的长字符串、用户主目录路径进行脱敏
 */
export function sanitize(input: string, customHomeDirs: string[] = []): string {
  if (!input) return input;
  let text = input;

  // 1. 用户主目录及敏感路径脱敏
  const homeCandidates = new Set<string>();
  if (process.env.USERPROFILE) homeCandidates.add(process.env.USERPROFILE);
  if (process.env.HOME) homeCandidates.add(process.env.HOME);
  if (process.env.APPDATA) homeCandidates.add(process.env.APPDATA);
  if (process.env.LOCALAPPDATA) homeCandidates.add(process.env.LOCALAPPDATA);
  try {
    const h = os.homedir();
    if (h) homeCandidates.add(h);
  } catch {
    // 忽略获取主目录失败
  }
  for (const c of customHomeDirs) {
    if (c) homeCandidates.add(c);
  }

  // 按路径长度从长到短排序，避免短路径替换导致长路径残留
  const sortedDirs = Array.from(homeCandidates)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const dir of sortedDirs) {
    const backslash = dir;
    const forwardSlash = dir.replace(/\\/g, '/');
    const escapedBackslash = dir.replace(/\\/g, '\\\\');

    text = text.split(escapedBackslash).join('<HOME>');
    text = text.split(backslash).join('<HOME>');
    text = text.split(forwardSlash).join('<HOME>');
  }

  // 2. 邮箱地址脱敏
  text = text.replace(
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    '[REDACTED_EMAIL]'
  );

  // 3. 疑似 Token 与密钥脱敏 (注意保留 UUID 格式以支持会话追踪)
  // JWT
  text = text.replace(
    /\bey[A-Za-z0-9_-]{10,}\.ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\b/g,
    '[REDACTED_JWT_TOKEN]'
  );
  // Google OAuth ya29.*
  text = text.replace(/\bya29\.[A-Za-z0-9_-]+\b/g, '[REDACTED_GOOGLE_TOKEN]');
  // Google API keys AIza*
  text = text.replace(/\bAIza[0-9A-Za-z\-_]{35}\b/g, '[REDACTED_API_KEY]');
  // GitHub / GitLab tokens
  text = text.replace(
    /\b(?:ghp|gho|ghu|ghs|ghr|glpat)_[A-Za-z0-9]{20,}\b/g,
    '[REDACTED_TOKEN]'
  );
  // OpenAI / Anthropic-like keys
  text = text.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, '[REDACTED_TOKEN]');
  // Bearer tokens
  text = text.replace(
    /\b(Bearer\s+)[A-Za-z0-9_.-]{20,}\b/gi,
    '$1[REDACTED_TOKEN]'
  );
  // JSON 中敏感字段的值脱敏
  text = text.replace(
    /(["'](?:token|secret|accessToken|apiKey|authCode|refreshToken|credential)["']\s*:\s*["'])[^"']{16,}(["'])/gi,
    '$1[REDACTED_TOKEN]$2'
  );

  return text;
}

/**
 * 构造 user 帧 JSON 字符串
 */
export function createUserFrame(prompt: string, template?: string): string {
  const trimmed = prompt.trim();
  // 若传入的行本身已是包含 event 的完整 JSON 帧，则直接使用
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as { event?: unknown };
      if (parsed.event) {
        return trimmed;
      }
    } catch {
      // 非合法 JSON 则作为普通文本处理
    }
  }

  if (template) {
    if (template.includes('{{prompt}}')) {
      const escaped = JSON.stringify(prompt).slice(1, -1);
      return template.replaceAll('{{prompt}}', escaped);
    }
    return template;
  }

  // 默认官方 stream-json user 帧格式
  return JSON.stringify({
    event: 'user',
    message: {
      content: prompt,
    },
  });
}

/**
 * 安全终止进程树 (支持跨平台)
 */
export function killProcessTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], {
        windowsHide: true,
      });
    } catch {
      try {
        process.kill(pid);
      } catch {
        // 忽略终止失败
      }
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // 忽略终止失败
      }
    }
  }
}

/**
 * 主执行函数
 */
export async function runRecordStream(cliArgs: CliArgs): Promise<void> {
  // 1. 检查帮助选项
  if (cliArgs.help) {
    printHelp();
    return;
  }

  // 2. 检查必需参数
  if (!cliArgs.scenario) {
    console.error('❌ 错误: 缺少必填参数 --scenario <name>');
    console.error('运行 `npx tsx tools/discover/record-stream.ts --help` 查看完整用法。\n');
    process.exit(1);
  }

  if (!cliArgs.prompt && !cliArgs.turns) {
    console.error('❌ 错误: 必须提供 --prompt <text> 或 --turns <file> 至少其一');
    console.error('运行 `npx tsx tools/discover/record-stream.ts --help` 查看完整用法。\n');
    process.exit(1);
  }

  if (cliArgs.turns && !fs.existsSync(cliArgs.turns)) {
    console.error(`❌ 错误: 轮次输入文件不存在: ${cliArgs.turns}`);
    process.exit(1);
  }

  // 3. 检查 agy CLI 安装
  const agyStatus = checkAgyInstalled();
  if (!agyStatus.installed) {
    console.error('\n❌ 错误: 未在系统中检测到 Antigravity CLI (agy)。');
    console.error('   录制真实 stream-json 输出需要本机已安装并配置 agy。');
    console.error('   官方安装与文档地址: https://antigravity.google/docs');
    if (agyStatus.error) {
      console.error(`   详细原因: ${agyStatus.error}`);
    }
    console.error('   请先安装 agy 并确保其在 PATH 环境变量中后重试。\n');
    process.exit(1);
  }

  // 4. 准备多轮输入队列
  const turnsQueue: string[] = [];
  if (cliArgs.prompt) {
    turnsQueue.push(cliArgs.prompt);
  }
  if (cliArgs.turns) {
    const rawContent = fs.readFileSync(cliArgs.turns, 'utf-8');
    const lines = rawContent.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    turnsQueue.push(...lines);
  }

  // 5. 准备录制目标目录
  const outDir = path.resolve(process.cwd(), 'fixtures', 'agy', 'stream', cliArgs.scenario);
  fs.mkdirSync(outDir, { recursive: true });

  const stdoutPath = path.join(outDir, 'stdout.jsonl');
  const stderrPath = path.join(outDir, 'stderr.txt');
  const metaPath = path.join(outDir, 'meta.json');

  const stdoutStream = fs.createWriteStream(stdoutPath, { flags: 'w', encoding: 'utf-8' });
  const stderrStream = fs.createWriteStream(stderrPath, { flags: 'w', encoding: 'utf-8' });

  // 6. 构造 agy 启动参数
  // 官方 stream-json 参数：--input-format stream-json --output-format stream-json --dangerously-skip-permissions
  const agyArgs: string[] = [
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--dangerously-skip-permissions',
  ];

  if (cliArgs.model) {
    agyArgs.push('--model', cliArgs.model);
  }
  if (cliArgs.extraArgs.length > 0) {
    agyArgs.push(...cliArgs.extraArgs);
  }

  const targetCwd = cliArgs.cwd ? path.resolve(cliArgs.cwd) : process.cwd();

  console.log(`[record-stream] 开始录制场景: "${cliArgs.scenario}"`);
  console.log(`[record-stream] agy 版本: ${agyStatus.version || '1.x'}`);
  console.log(`[record-stream] 工作目录: ${targetCwd}`);
  console.log(`[record-stream] 启动命令: agy ${agyArgs.join(' ')}`);
  console.log(`[record-stream] 总轮次数: ${turnsQueue.length}`);

  const startTime = Date.now();
  let currentTurnIndex = 0;
  let wasAborted = false;
  let abortTimer: NodeJS.Timeout | null = null;
  let stdinClosed = false;

  // 7. 启动 agy 子进程 (不用 shell，跨平台支持)
  const child = spawn('agy', agyArgs, {
    cwd: targetCwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });

  // 设置中止定时器 (若配置)
  if (cliArgs.abortAfterMs && cliArgs.abortAfterMs > 0) {
    abortTimer = setTimeout(() => {
      wasAborted = true;
      console.warn(`[record-stream] 达到设定的超时时间 (${cliArgs.abortAfterMs}ms)，正在终止进程树...`);
      killProcessTree(child.pid);
    }, cliArgs.abortAfterMs);
  }

  // 发送指定轮次的输入帧
  const sendTurn = (index: number) => {
    if (index >= turnsQueue.length) {
      if (!stdinClosed && child.stdin && !child.stdin.destroyed) {
        stdinClosed = true;
        child.stdin.end();
        console.log(`[record-stream] 所有 ${turnsQueue.length} 轮输入已发送，stdin 已关闭`);
      }
      return;
    }

    const promptText = turnsQueue[index];
    const frame = createUserFrame(promptText, cliArgs.frameTemplate);
    console.log(`[record-stream] 正在发送第 ${index + 1}/${turnsQueue.length} 轮输入 (${promptText.slice(0, 40)}...)`);
    child.stdin.write(frame + '\n');
  };

  // 发送第 1 轮
  sendTurn(0);

  // 8. 监听 stdout (逐行读取，打相对时间戳，脱敏后写入 stdout.jsonl)
  const rlStdout = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });

  rlStdout.on('line', (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    const offsetMs = Date.now() - startTime;
    const sanitizedLine = sanitize(trimmed);

    try {
      const parsed = JSON.parse(sanitizedLine) as { event?: string };
      const record = { offsetMs, ...parsed };
      stdoutStream.write(JSON.stringify(record) + '\n');

      // 当收到 result 事件时，代表当前轮次已结束
      if (parsed.event === 'result') {
        currentTurnIndex++;
        if (currentTurnIndex < turnsQueue.length) {
          // 延迟微小片刻确保状态机就绪后发送下一轮
          setTimeout(() => {
            sendTurn(currentTurnIndex);
          }, 60);
        } else {
          if (!stdinClosed && child.stdin && !child.stdin.destroyed) {
            stdinClosed = true;
            child.stdin.end();
            console.log(`[record-stream] 收到最后一轮 result，已关闭 stdin 等待进程退出`);
          }
        }
      }
    } catch {
      // 非 JSON 输出保留原样
      const record = { offsetMs, raw: sanitizedLine };
      stdoutStream.write(JSON.stringify(record) + '\n');
    }
  });

  // 9. 监听 stderr
  child.stderr.on('data', (chunk: Buffer) => {
    const sanitized = sanitize(chunk.toString('utf-8'));
    stderrStream.write(sanitized);
  });

  // 10. 等待进程退出
  const exitPromise = new Promise<{ code: number | null; signal: string | null }>(resolve => {
    child.on('close', (code, signal) => {
      resolve({ code, signal });
    });
    child.on('error', err => {
      console.error(`[record-stream] 子进程发生错误:`, err);
      resolve({ code: 1, signal: null });
    });
  });

  const { code, signal } = await exitPromise;

  if (abortTimer) {
    clearTimeout(abortTimer);
  }

  // 关闭流
  await new Promise(resolve => stdoutStream.end(resolve));
  await new Promise(resolve => stderrStream.end(resolve));

  const durationMs = Date.now() - startTime;

  // 11. 生成 meta.json
  const meta: StreamRecordingMeta = {
    scenario: cliArgs.scenario,
    agyVersion: agyStatus.version || 'unknown',
    recordedAt: new Date().toISOString(),
    durationMs,
    exitCode: code,
    exitSignal: signal,
    command: {
      bin: 'agy',
      argv: agyArgs,
      cwd: targetCwd,
    },
    options: {
      scenario: cliArgs.scenario,
      prompt: cliArgs.prompt,
      cwd: cliArgs.cwd,
      model: cliArgs.model,
      turnsFile: cliArgs.turns,
      abortAfterMs: cliArgs.abortAfterMs,
      extraArgs: cliArgs.extraArgs.length > 0 ? cliArgs.extraArgs : undefined,
      frameTemplate: cliArgs.frameTemplate,
    },
    turnsCount: turnsQueue.length,
    aborted: wasAborted,
  };

  const sanitizedMetaJson = sanitize(JSON.stringify(meta, null, 2)) + '\n';
  fs.writeFileSync(metaPath, sanitizedMetaJson, 'utf-8');

  console.log(`\n✅ 录制完成！场景: ${cliArgs.scenario}`);
  console.log(`   耗时: ${durationMs}ms, 退出码: ${code ?? 'null'}, 信号: ${signal ?? 'none'}`);
  console.log(`   输出目录: ${outDir}`);
  console.log(`   - ${stdoutPath}`);
  console.log(`   - ${stderrPath}`);
  console.log(`   - ${metaPath}\n`);
}

// 脚本直接执行入口
const currentFile = path.resolve(process.argv[1] || '');
const scriptName = path.resolve('tools/discover/record-stream.ts');

if (
  currentFile === scriptName ||
  currentFile.endsWith('record-stream.ts') ||
  currentFile.endsWith('record-stream.js')
) {
  const args = parseCliArgs(process.argv.slice(2));
  runRecordStream(args).catch(err => {
    console.error('❌ 执行失败:', err);
    process.exit(1);
  });
}
