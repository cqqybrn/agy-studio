import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { executeFakeAgy, runStreamMode, runPtyMode, parseCliArgs } from '../src/runner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('fake-agy 回放器测试套件', () => {
  let tmpHome: string;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'fake-agy-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('CLI 参数解析测试', () => {
    it('应正确识别 --stream-json、--prompt、--dangerously-skip-permissions 等参数', () => {
      const parsed = parseCliArgs([
        '--stream-json',
        '--prompt',
        'hello world',
        '--dangerously-skip-permissions',
        '--model',
        'gemini-2.5-pro',
        '--effort',
        'high',
      ]);
      expect(parsed.isStream).toBe(true);
      expect(parsed.prompt).toBe('hello world');
      expect(parsed.dangerouslySkipPermissions).toBe(true);
      expect(parsed.model).toBe('gemini-2.5-pro');
      expect(parsed.effort).toBe('high');
    });

    it('应正确识别 --version 和 models', () => {
      expect(parseCliArgs(['--version']).isVersion).toBe(true);
      expect(parseCliArgs(['-v']).isVersion).toBe(true);
      expect(parseCliArgs(['models']).isModels).toBe(true);
    });
  });

  describe('Stream 极速回放测试', () => {
    it('在 speed=0 下应极速完成输出，且内容符合 stream-json 规范 (init, step_update, result)', async () => {
      const stdoutStream = new PassThrough();
      let output = '';
      stdoutStream.on('data', (chunk) => {
        output += chunk.toString('utf-8');
      });

      const startTime = Date.now();
      const exitCode = await executeFakeAgy(
        ['--stream-json', '--prompt', 'test prompt'],
        {
          scenario: 'simple-chat',
          speed: 0,
          homeDir: tmpHome,
        },
        { stdout: stdoutStream }
      );

      const elapsed = Date.now() - startTime;

      expect(exitCode).toBe(0);
      // 极速回放耗时应极短 (通常 < 500ms)
      expect(elapsed).toBeLessThan(1000);

      const lines = output.trim().split('\n').map((l) => JSON.parse(l));
      expect(lines.length).toBeGreaterThanOrEqual(3);

      const events = lines.map((l) => l.event);
      expect(events).toContain('init');
      expect(events).toContain('step_update');
      expect(events).toContain('result');

      // 验证已剥离 offsetMs
      for (const line of lines) {
        expect(line.offsetMs).toBeUndefined();
      }

      // 验证在 FAKE_AGY_HOME 下成功生成 transcript.jsonl
      const convId = lines[0].conversation_id;
      const transcriptPath = path.join(tmpHome, 'conversations', convId, 'transcript.jsonl');
      expect(fs.existsSync(transcriptPath)).toBe(true);

      const transcriptContent = fs.readFileSync(transcriptPath, 'utf-8');
      expect(transcriptContent.length).toBeGreaterThan(0);
      const transcriptLines = transcriptContent.trim().split('\n');
      expect(transcriptLines.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('PTY / 交互模式输出测试', () => {
    it('在收到 /usage 指令时应输出 Quota Usage 终端文本', async () => {
      const stdinStream = new PassThrough();
      const stdoutStream = new PassThrough();

      let output = '';
      stdoutStream.on('data', (chunk) => {
        output += chunk.toString('utf-8');
      });

      const promise = runPtyMode({}, stdinStream, stdoutStream);

      // 发送 /usage 命令
      stdinStream.write('/usage\n');
      // 发送退出命令
      stdinStream.write('exit\n');

      const exitCode = await promise;
      expect(exitCode).toBe(0);

      // 验证输出了 usage 相关的关键内容
      expect(output).toContain('Antigravity Quota Usage');
      expect(output).toContain('Gemini 2.5 Pro');
      expect(output).toContain('Limit');
    });

    it('在收到 /credits 指令时应输出额度文本', async () => {
      const stdinStream = new PassThrough();
      const stdoutStream = new PassThrough();

      let output = '';
      stdoutStream.on('data', (chunk) => {
        output += chunk.toString('utf-8');
      });

      const promise = runPtyMode({}, stdinStream, stdoutStream);

      stdinStream.write('/credits\n');
      stdinStream.write('exit\n');

      const exitCode = await promise;
      expect(exitCode).toBe(0);
      expect(output).toContain('Antigravity Credits');
    });
  });

  describe('中断信号安全退出测试', () => {
    it('通过 AbortSignal 中断 runStreamMode 应立即优雅退出', async () => {
      const ac = new AbortController();
      const stdoutStream = new PassThrough();

      // 设置极慢的倍速 (例如 0.001，正常回放需要几十秒)
      const promise = runStreamMode(
        {
          scenario: 'simple-chat',
          speed: 0.001,
          homeDir: tmpHome,
        },
        stdoutStream,
        ac.signal
      );

      // 稍等 50ms 后发送 abort
      setTimeout(() => {
        ac.abort();
      }, 50);

      const startTime = Date.now();
      const exitCode = await promise;
      const elapsed = Date.now() - startTime;

      expect(exitCode).toBe(0);
      expect(elapsed).toBeLessThan(1500);
    });

    it('子进程收到 SIGTERM / SIGINT 信号时应立即安全退出', async () => {
      const mainPath = path.resolve(__dirname, '..', 'main.ts');

      const child = spawn(process.execPath, ['--import', 'tsx', mainPath], {
        env: {
          ...process.env,
          FAKE_AGY_SPEED: '0.001',
          FAKE_AGY_STREAM: '1',
          FAKE_AGY_HOME: tmpHome,
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const exitPromise = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
        child.on('exit', (code, signal) => {
          resolve({ code, signal });
        });
      });

      // 等待子进程启动并确认正在运行
      await new Promise((r) => setTimeout(r, 200));
      child.kill('SIGTERM');

      const { code, signal } = await exitPromise;
      // 在 Windows 和 Unix 上，收到终止信号均视为安全优雅退出
      expect(code === 0 || signal === 'SIGTERM' || code === null).toBe(true);
    });
  });
});
