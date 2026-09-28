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
      expect(argv).toContain('--resume');
      expect(argv).toContain('test-conv-123');
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

    it('auto-replies to permissionRequest and emits autoapprove.injected event', async () => {
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
