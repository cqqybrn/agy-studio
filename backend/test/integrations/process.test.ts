import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import process from 'node:process';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadProfile } from '../../src/integrations/agy/profile/loader.js';
import {
  ProcessRunner,
  buildArgv,
  formatUserFrame,
  resolveBinary,
} from '../../src/integrations/agy/process.js';
import type { AgentEvent } from '@agy-studio/contracts';
import { isProcessAlive } from '../../src/utils/proc-tree.js';
import { AppError } from '../../src/utils/errors.js';

describe('ProcessRunner Integration Tests', () => {
  const profileJsonPath = path.resolve(__dirname, '../../agy-profile.json');
  const profile = loadProfile(profileJsonPath);

  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-process-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('buildArgv', () => {
    it('generates stream args and dangerous skip permissions by default', () => {
      const argv = buildArgv(profile, { cwd: tempDir });
      expect(argv).toContain('--input-format');
      expect(argv).toContain('stream-json');
      expect(argv).toContain('--output-format');
      expect(argv).toContain('--dangerously-skip-permissions');
    });

    it('includes model, effort, mode, and resume parameters when provided', () => {
      const argv = buildArgv(profile, {
        cwd: tempDir,
        model: 'gemini-2.5-pro',
        effort: 'high',
        mode: 'plan',
        resumeConversationId: 'test-conv-123',
      });

      expect(argv).toContain('--model');
      expect(argv).toContain('gemini-2.5-pro');
      expect(argv).toContain('--effort');
      expect(argv).toContain('high');
      expect(argv).toContain('--mode');
      expect(argv).toContain('plan');
      expect(argv).toContain('--conversation');
      expect(argv).toContain('test-conv-123');
    });

    it('resumes a conversation with --conversation <id> and never emits --resume', () => {
      const argv = buildArgv(profile, {
        cwd: tempDir,
        resumeConversationId: '6f79591d-1521-40d1-b302-3edd62c602a0',
      });

      const idx = argv.indexOf('--conversation');
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(argv[idx + 1]).toBe('6f79591d-1521-40d1-b302-3edd62c602a0');
      expect(argv).not.toContain('--resume');
    });

    it('passes --agent <name> next to --model/--mode when an agent is given', () => {
      const argv = buildArgv(profile, {
        cwd: tempDir,
        model: 'gemini-2.5-pro',
        mode: 'plan',
        agent: 'code-reviewer',
      });
      const idx = argv.indexOf('--agent');
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(argv[idx + 1]).toBe('code-reviewer');
      expect(argv.filter((a) => a === '--agent')).toHaveLength(1);
    });

    it('omits --agent when agent is empty, null or default', () => {
      for (const agent of [undefined, null, '', '  ', 'default', 'Default']) {
        const argv = buildArgv(profile, { cwd: tempDir, agent });
        expect(argv, String(agent)).not.toContain('--agent');
      }
    });

    it('omits --conversation when there is no resumeConversationId', () => {
      const argv = buildArgv(profile, { cwd: tempDir, resumeConversationId: null });
      expect(argv).not.toContain('--conversation');
      expect(argv).not.toContain('--resume');
    });

    it('merges custom extra argv without duplicating fixed stream args', () => {
      const argv = buildArgv(profile, {
        cwd: tempDir,
        argv: ['--extra-flag', 'value1', '--dangerously-skip-permissions'],
      });

      expect(argv).toContain('--extra-flag');
      expect(argv).toContain('value1');
      const skipPermsCount = argv.filter((a) => a === '--dangerously-skip-permissions').length;
      expect(skipPermsCount).toBe(1);
    });
  });

  describe('formatUserFrame', () => {
    it('replaces {{prompt}} with JSON-escaped string', () => {
      const template = '{"event":"user","message":{"content":"{{prompt}}"}}';
      const prompt = 'Hello "world"\nLine 2';
      const formatted = formatUserFrame(template, prompt);
      const parsed = JSON.parse(formatted);
      expect(parsed).toEqual({
        event: 'user',
        message: { content: 'Hello "world"\nLine 2' },
      });
    });

    it('handles object template gracefully', () => {
      const template = { event: 'user', message: { content: '{{prompt}}' } };
      const formatted = formatUserFrame(template, 'Simple text');
      const parsed = JSON.parse(formatted);
      expect(parsed).toEqual({
        event: 'user',
        message: { content: 'Simple text' },
      });
    });
  });

  describe('resolveBinary', () => {
    it('prefers explicit bin when passed', () => {
      expect(resolveBinary(profile, 'my-custom-bin')).toBe('my-custom-bin');
    });
  });

  describe('Process execution lifecycle', () => {
    it('flushes incomplete half lines on close and yields adapter events', async () => {
      // Create a mock script that outputs an init event line, then a partial line without newline, and exits
      const scriptPath = path.join(tempDir, 'mock-partial.mjs');
      const initLine = JSON.stringify({
        event: 'init',
        conversation_id: 'conv-test-999',
        init: { cwd: tempDir, permission_mode: 'always-proceed' },
      });
      const resultLine = JSON.stringify({
        event: 'result',
        result: {
          status: 'SUCCESS',
          conversation_id: 'conv-test-999',
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        },
      });

      // Writes init with newline, then result WITHOUT newline
      fs.writeFileSync(
        scriptPath,
        `
        process.stdout.write(${JSON.stringify(initLine + '\n')});
        setTimeout(() => {
          process.stdout.write(${JSON.stringify(resultLine)});
          process.exit(0);
        }, 50);
      `,
        'utf-8',
      );

      const runner = new ProcessRunner(profile, process.execPath);
      const proc = await runner.start({
        bin: process.execPath,
        argv: [scriptPath],
        cwd: tempDir,
      });

      expect(proc.pid).toBeDefined();

      const events: AgentEvent[] = [];
      for await (const ev of proc.events) {
        events.push(ev);
      }

      const exited = await proc.exited;
      expect(exited.exitCode).toBe(0);
      expect(proc.conversationId).toBe('conv-test-999');
      expect(proc.terminal?.status).toBe('completed');
      expect(proc.usage?.totalTokens).toBe(15);
      // Half line on close was flushed and parsed as usage
      const usageEvents = events.filter((e) => e.type === 'usage');
      expect(usageEvents.length).toBeGreaterThan(0);
    });

    it('invokes onConversationId once as soon as the init line is parsed', async () => {
      const scriptPath = path.join(tempDir, 'mock-init.mjs');
      const initLine = JSON.stringify({
        event: 'init',
        conversation_id: 'conv-init-early',
        init: { cwd: tempDir, permission_mode: 'always-proceed' },
      });
      const stepLine = JSON.stringify({
        event: 'step_update',
        step_update: {
          conversation_id: 'conv-init-early',
          step_index: 0,
          state: 'DONE',
          step_type: 'user_input',
        },
      });
      fs.writeFileSync(
        scriptPath,
        `
        process.stdout.write(${JSON.stringify(initLine + '\n' + stepLine + '\n')});
        setTimeout(() => process.exit(0), 50);
      `,
        'utf-8',
      );

      const seen: string[] = [];
      const runner = new ProcessRunner(profile, process.execPath);
      const proc = await runner.start({
        bin: process.execPath,
        argv: [scriptPath],
        cwd: tempDir,
        onConversationId: (id) => seen.push(id),
      });

      for await (const _ of proc.events) {
        // drain
      }
      await proc.exited;
      expect(seen).toEqual(['conv-init-early']);
    });

    it('auto-replies to permissionRequest and emits autoapprove.injected event when the profile configures permissionEvent', async () => {
      // 真实 profile 的 permissionEvent 为 null（没有实录）；这里用假设性配置验证可选的 L3 机制
      const permissionProfile = {
        ...profile,
        stream: {
          ...profile.stream,
          permissionEvent: {
            match: { event: 'ask_permission' },
            replyTemplate: '{"event":"permission_response","allow":true}',
          },
        },
      };
      const scriptPath = path.join(tempDir, 'mock-permission.mjs');
      // Script emits ask_permission event, waits for reply on stdin, then emits result and exits
      fs.writeFileSync(
        scriptPath,
        `
        import readline from 'node:readline';
        process.stdout.write(JSON.stringify({ event: 'ask_permission', tool: 'run_command' }) + '\\n');
        
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', (line) => {
          const parsed = JSON.parse(line);
          if (parsed.allow === true) {
            process.stdout.write(JSON.stringify({
              event: 'result',
              result: { status: 'SUCCESS' }
            }) + '\\n');
            process.exit(0);
          }
        });
      `,
        'utf-8',
      );

      const runner = new ProcessRunner(permissionProfile, process.execPath);
      const proc = await runner.start({
        bin: process.execPath,
        argv: [scriptPath],
        cwd: tempDir,
      });

      const events: AgentEvent[] = [];
      for await (const ev of proc.events) {
        events.push(ev);
      }

      await proc.exited;
      const injected = events.find((e) => e.type === 'autoapprove.injected');
      expect(injected).toBeDefined();
      if (injected && injected.type === 'autoapprove.injected') {
        expect(injected.layer).toBe('permission_event');
      }
    });

    it('sends user frame through stdin including image path injection', async () => {
      const scriptPath = path.join(tempDir, 'mock-send.mjs');
      // Script reads line from stdin, emits result containing that line, and exits
      fs.writeFileSync(
        scriptPath,
        `
        import readline from 'node:readline';
        const rl = readline.createInterface({ input: process.stdin });
        rl.on('line', (line) => {
          process.stdout.write(JSON.stringify({
            event: 'step_update',
            step_update: {
              step_index: 0,
              state: 'DONE',
              step_type: 'agent_response',
              text_delta: 'echo:' + line,
            }
          }) + '\\n');
          process.stdout.write(JSON.stringify({
            event: 'result',
            result: { status: 'SUCCESS' }
          }) + '\\n');
          process.exit(0);
        });
      `,
        'utf-8',
      );

      const runner = new ProcessRunner(profile, process.execPath);
      const proc = await runner.start({
        bin: process.execPath,
        argv: [scriptPath],
        cwd: tempDir,
      });

      await proc.send('Hello Antigravity', ['/path/to/img1.png']);

      const events: AgentEvent[] = [];
      for await (const ev of proc.events) {
        events.push(ev);
      }

      await proc.exited;
      const delta = events.find((e) => e.type === 'message.delta');
      expect(delta).toBeDefined();
      if (delta && delta.type === 'message.delta') {
        expect(delta.text).toContain('Hello Antigravity');
        expect(delta.text).toContain('/path/to/img1.png');
      }
    });

    it('closeInput() ends stdin so a process waiting for more turns can exit', async () => {
      const scriptPath = path.join(tempDir, 'mock-wait-stdin.mjs');
      fs.writeFileSync(
        scriptPath,
        `
        const keepAlive = setInterval(() => {}, 1000);
        process.stdin.resume();
        process.stdin.on('end', () => {
          clearInterval(keepAlive);
          process.exit(0);
        });
      `,
        'utf-8',
      );

      const runner = new ProcessRunner(profile, process.execPath);
      const proc = await runner.start({
        bin: process.execPath,
        argv: [scriptPath],
        cwd: tempDir,
      });

      await proc.send('hello');
      proc.closeInput();
      proc.closeInput();

      const exited = await proc.exited;
      expect(exited.exitCode).toBe(0);
    });

    it('keeps a Chinese character intact when its UTF-8 bytes are split across two stdout chunks', async () => {
      const scriptPath = path.join(tempDir, 'mock-split-utf8.mjs');
      const line =
        JSON.stringify({
          event: 'step_update',
          step_update: {
            conversation_id: 'conv-utf8',
            step_index: 1,
            state: 'DONE',
            step_type: 'agent_response',
            text_delta: '你好世界',
          },
        }) + '\n';
      const bytes = Buffer.from(line, 'utf-8');
      // 在「好」的 3 个字节中间切开
      const splitAt = bytes.indexOf(Buffer.from('好', 'utf-8')) + 1;
      fs.writeFileSync(
        scriptPath,
        `
        const bytes = Buffer.from(${JSON.stringify(bytes.toString('base64'))}, 'base64');
        process.stdout.write(bytes.subarray(0, ${splitAt}));
        setTimeout(() => {
          process.stdout.write(bytes.subarray(${splitAt}), () => process.exit(0));
        }, 100);
      `,
        'utf-8',
      );

      const runner = new ProcessRunner(profile, process.execPath);
      const proc = await runner.start({
        bin: process.execPath,
        argv: [scriptPath],
        cwd: tempDir,
      });

      const events: AgentEvent[] = [];
      for await (const ev of proc.events) {
        events.push(ev);
      }
      await proc.exited;

      const deltas = events.filter((e) => e.type === 'message.delta');
      expect(deltas).toHaveLength(1);
      const text = (deltas[0] as { text: string }).text;
      expect(text).toBe('你好世界');
      expect(text).not.toContain('\uFFFD');
    });

    it('kills process tree with kill() and ensures child is dead', async () => {
      const scriptPath = path.join(tempDir, 'mock-hang.mjs');
      fs.writeFileSync(
        scriptPath,
        `
        setInterval(() => {}, 1000);
      `,
        'utf-8',
      );

      const runner = new ProcessRunner(profile, process.execPath);
      const proc = await runner.start({
        bin: process.execPath,
        argv: [scriptPath],
        cwd: tempDir,
      });

      const pid = proc.pid!;
      expect(isProcessAlive(pid)).toBe(true);

      await proc.kill();
      expect(isProcessAlive(pid)).toBe(false);
    });

    it('throws AppError with AGY_SPAWN_ERROR when binary does not exist', async () => {
      const runner = new ProcessRunner(profile, 'non-existent-binary-xyz-12345');
      await expect(
        runner.start({
          bin: 'non-existent-binary-xyz-12345',
          cwd: tempDir,
        }),
      ).rejects.toThrowError(AppError);
    });
  });
});
