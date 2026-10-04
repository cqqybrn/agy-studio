import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  extractSubagentConversationIds,
  parseLine,
  resolveTranscriptPath,
  tail,
  toEvents,
} from '../../src/integrations/agy/transcript.js';
import { loadProfile } from '../../src/integrations/agy/profile/loader.js';

const REAL_TRANSCRIPT = path.resolve(
  __dirname,
  '../../../fixtures/agy/fs/brain-sample/.system_generated/logs/transcript.jsonl',
);
const PROFILE_PATHS = loadProfile(path.resolve(__dirname, '../../agy-profile.json')).paths;

describe('Integrations: transcript.ts', () => {
  describe('resolveTranscriptPath', () => {
    const convId = '6f79591d-1521-40d1-b302-3edd62c602a0';

    it('derives brain\\<id>\\.system_generated\\logs\\transcript.jsonl from the profile for an account home', () => {
      const home = path.join(os.tmpdir(), 'agy-account-home');
      expect(resolveTranscriptPath(convId, { homeDir: home }, PROFILE_PATHS)).toBe(
        path.join(
          home,
          '.gemini',
          'antigravity-cli',
          'brain',
          convId,
          '.system_generated',
          'logs',
          'transcript.jsonl',
        ),
      );
    });

    it('derives the same layout relative to an explicit data root', () => {
      const dataRoot = path.join(os.tmpdir(), 'agy-data-root');
      expect(resolveTranscriptPath(convId, { dataRoot }, PROFILE_PATHS)).toBe(
        path.join(dataRoot, 'brain', convId, '.system_generated', 'logs', 'transcript.jsonl'),
      );
    });

    it('tail() by conversation id reads the real transcript copied into an account home', async () => {
      const home = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'transcript-home-'));
      try {
        const target = resolveTranscriptPath(convId, { homeDir: home }, PROFILE_PATHS);
        await fs.promises.mkdir(path.dirname(target), { recursive: true });
        await fs.promises.copyFile(REAL_TRANSCRIPT, target);

        const handle = tail(convId, { homeDir: home, pollIntervalMs: 50 }, PROFILE_PATHS);
        const received: number[] = [];
        for await (const step of handle) {
          received.push(step.stepIndex);
          if (step.stepIndex === 4) {
            handle.stop();
            break;
          }
        }
        expect(received).toEqual([0, 1, 2, 3, 4]);
      } finally {
        await fs.promises.rm(home, { recursive: true, force: true });
      }
    });
  });

  describe('parseLine', () => {
    it('returns null for empty, whitespace, or invalid JSON', () => {
      expect(parseLine('')).toBeNull();
      expect(parseLine('   \n  \t')).toBeNull();
      expect(parseLine('{ invalid json')).toBeNull();
      expect(parseLine('"not an object"')).toBeNull();
      expect(parseLine('12345')).toBeNull();
      expect(parseLine('null')).toBeNull();
    });

    it('parses real agy transcript lines (step_index/source/type/status/created_at/content)', () => {
      const lines = fs.readFileSync(REAL_TRANSCRIPT, 'utf-8').split(/\r?\n/).filter(Boolean);
      const step = parseLine(lines[1]);
      expect(step).toEqual({
        stepIndex: 1,
        type: 'PLANNER_RESPONSE',
        status: 'DONE',
        createdAt: '2026-09-28T10:29:37Z',
        content: 'OK',
        thinking: null,
        toolCalls: [],
        error: null,
      });
    });

    it('parses standard fake-agy transcript lines', () => {
      const line = JSON.stringify({
        step_index: 0,
        kind: 'user',
        content: 'Hello Antigravity, please help me.',
        timestamp: '2026-09-28T08:00:00.000Z',
      });
      const step = parseLine(line);
      expect(step).not.toBeNull();
      expect(step?.stepIndex).toBe(0);
      expect(step?.type).toBe('user');
      expect(step?.content).toBe('Hello Antigravity, please help me.');
      expect(step?.createdAt).toBe('2026-09-28T08:00:00.000Z');
      expect(step?.thinking).toBeNull();
      expect(step?.toolCalls).toEqual([]);
      expect(step?.error).toBeNull();
    });

    it('extracts thinking from thought steps or explicit fields', () => {
      const thoughtLine = JSON.stringify({
        step_index: 1,
        kind: 'thought',
        content: 'Let me think about this problem...',
        timestamp: '2026-09-28T08:00:01.000Z',
      });
      const thoughtStep = parseLine(thoughtLine);
      expect(thoughtStep?.type).toBe('thought');
      expect(thoughtStep?.thinking).toBe('Let me think about this problem...');

      const contextKindLine = JSON.stringify({
        step_index: 2,
        context_kind: 'CONTEXT_KIND_MODEL_THOUGHT',
        content: 'Deep reasoning chain...',
      });
      const contextKindStep = parseLine(contextKindLine);
      expect(contextKindStep?.type).toBe('thought');
      expect(contextKindStep?.thinking).toBe('Deep reasoning chain...');

      const explicitThinking = JSON.stringify({
        stepIndex: 3,
        type: 'agent_response',
        content: 'Final answer',
        thinking: 'Intermediate internal reasoning',
      });
      const explicitStep = parseLine(explicitThinking);
      expect(explicitStep?.thinking).toBe('Intermediate internal reasoning');
      expect(explicitStep?.content).toBe('Final answer');
    });

    it('parses tool calls in various formats', () => {
      // Format 1: tool_name and tool_info.parameters
      const line1 = JSON.stringify({
        step_index: 4,
        step_type: 'tool',
        tool_name: 'run_command',
        tool_info: {
          parameters: {
            CommandLine: 'git status',
          },
        },
      });
      const step1 = parseLine(line1);
      expect(step1?.toolCalls).toEqual([
        {
          name: 'run_command',
          args: { CommandLine: 'git status' },
        },
      ]);

      // Format 2: toolCalls array
      const line2 = JSON.stringify({
        stepIndex: 5,
        type: 'tool',
        toolCalls: [
          { name: 'view_file', args: { path: 'README.md' } },
        ],
      });
      const step2 = parseLine(line2);
      expect(step2?.toolCalls).toEqual([
        { name: 'view_file', args: { path: 'README.md' } },
      ]);
    });

    it('parses status and error fields', () => {
      const line = JSON.stringify({
        step_index: 6,
        type: 'tool',
        state: 'DONE',
        error: { message: 'Command failed with exit code 1' },
      });
      const step = parseLine(line);
      expect(step?.status).toBe('DONE');
      expect(step?.error).toBe('Command failed with exit code 1');
    });
  });

  describe('extractSubagentConversationIds', () => {
    it('reads subagent_info.subagents[].conversation_id from the real subagent stream, ignoring text/log_uri mentions', () => {
      const text = fs.readFileSync(
        path.resolve(__dirname, '../../../fixtures/agy/stream/subagent/stdout.jsonl'),
        'utf-8',
      );
      expect(extractSubagentConversationIds(text)).toEqual(['e33a7c24-f1e3-4792-ac80-d602ef34dabb']);
    });

    it('returns nothing for the real brain-sample transcript and for UUIDs mentioned in content', () => {
      const mentioned = JSON.stringify({
        step_index: 9,
        type: 'USER_INPUT',
        content: 'see conversation d4d4d4d4-4444-4444-8444-444444444444',
      });
      const text = `${fs.readFileSync(REAL_TRANSCRIPT, 'utf-8')}\n${mentioned}\n`;
      expect(extractSubagentConversationIds(text)).toEqual([]);
    });

    it('reads invoke_subagent args Subagents[].conversation_id (agy-auto field names)', () => {
      const line = JSON.stringify({
        step_type: 'tool',
        tool_name: 'invoke_subagent',
        tool_info: {
          name: 'invoke_subagent',
          args: {
            Subagents: JSON.stringify([
              { TypeName: 'research', conversation_id: 'b2b2b2b2-2222-4222-8222-222222222222' },
              { TypeName: 'research', conversation_id: 'not-a-uuid' },
            ]),
          },
        },
      });
      expect(extractSubagentConversationIds(line)).toEqual(['b2b2b2b2-2222-4222-8222-222222222222']);
    });
  });

  describe('toEvents', () => {
    const convId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

    it('transforms main role with thinking into thinking.delta', () => {
      const step = {
        stepIndex: 1,
        type: 'thought',
        status: 'DONE',
        createdAt: '2026-09-28T08:00:00.000Z',
        content: 'Analyzing codebase structure...',
        thinking: 'Analyzing codebase structure...',
        toolCalls: [],
        error: null,
      };

      const events = toEvents(step, 'main', convId);
      expect(events).toEqual([
        {
          type: 'thinking.delta',
          blockId: `thinking-${convId}-1`,
          source: 'transcript',
          text: 'Analyzing codebase structure...',
        },
      ]);
    });

    it('transforms main role without thinking into empty array', () => {
      const step = {
        stepIndex: 2,
        type: 'agent_response',
        status: 'DONE',
        createdAt: '2026-09-28T08:00:01.000Z',
        content: 'Here is the result.',
        thinking: null,
        toolCalls: [],
        error: null,
      };

      const events = toEvents(step, 'main', convId);
      expect(events).toEqual([]);
    });

    it('transforms subagent role into subagent.step', () => {
      const step = {
        stepIndex: 0,
        type: 'user',
        status: null,
        createdAt: '2026-09-28T08:00:00.000Z',
        content: 'Subtask prompt',
        thinking: null,
        toolCalls: [],
        error: null,
      };

      const events = toEvents(step, 'subagent', convId);
      expect(events).toEqual([
        {
          type: 'subagent.step',
          conversationId: convId,
          step,
        },
      ]);
    });
  });

  describe('tail', () => {
    let tmpDir: string;
    let transcriptFile: string;

    beforeEach(async () => {
      tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'transcript-test-'));
      transcriptFile = path.join(tmpDir, 'transcript.jsonl');
    });

    afterEach(async () => {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    });

    it('tails an incrementally appended file line by line', async () => {
      // Start with file already created with one step
      const step0 = {
        step_index: 0,
        kind: 'user',
        content: 'Step 0',
      };
      await fs.promises.writeFile(transcriptFile, JSON.stringify(step0) + '\n', 'utf-8');

      const handle = tail(transcriptFile, { pollIntervalMs: 50 });
      const received: number[] = [];

      const consumerPromise = (async () => {
        for await (const step of handle) {
          received.push(step.stepIndex);
          if (step.stepIndex === 2) {
            handle.stop();
            break;
          }
        }
      })();

      // Append step 1
      await new Promise((r) => setTimeout(r, 80));
      await fs.promises.appendFile(
        transcriptFile,
        JSON.stringify({ step_index: 1, kind: 'thought', content: 'Step 1' }) + '\n',
        'utf-8',
      );

      // Append step 2
      await new Promise((r) => setTimeout(r, 80));
      await fs.promises.appendFile(
        transcriptFile,
        JSON.stringify({ step_index: 2, kind: 'assistant', content: 'Step 2' }) + '\n',
        'utf-8',
      );

      await consumerPromise;
      expect(received).toEqual([0, 1, 2]);
    });

    it('waits and polls when file does not exist initially, then picks up appended steps', async () => {
      // File does not exist yet!
      expect(fs.existsSync(transcriptFile)).toBe(false);

      const handle = tail(transcriptFile, { pollIntervalMs: 50 });
      const received: number[] = [];

      const consumerPromise = (async () => {
        for await (const step of handle.steps) {
          received.push(step.stepIndex);
          if (step.stepIndex === 1) {
            handle.stop();
            break;
          }
        }
      })();

      // Wait 100ms and write the file
      await new Promise((r) => setTimeout(r, 100));
      await fs.promises.writeFile(
        transcriptFile,
        JSON.stringify({ step_index: 0, kind: 'user', content: 'First' }) +
          '\n' +
          JSON.stringify({ step_index: 1, kind: 'assistant', content: 'Second' }) +
          '\n',
        'utf-8',
      );

      await consumerPromise;
      expect(received).toEqual([0, 1]);
    });

    it('deduplicates steps by stepIndex and respects fromStep', async () => {
      await fs.promises.writeFile(
        transcriptFile,
        JSON.stringify({ step_index: 0, kind: 'user', content: 'Step 0' }) +
          '\n' +
          JSON.stringify({ step_index: 1, kind: 'user', content: 'Step 1' }) +
          '\n' +
          // duplicate step_index 1
          JSON.stringify({ step_index: 1, kind: 'user', content: 'Step 1 duplicate' }) +
          '\n' +
          JSON.stringify({ step_index: 2, kind: 'user', content: 'Step 2' }) +
          '\n',
        'utf-8',
      );

      const handle = tail(transcriptFile, { fromStep: 1, pollIntervalMs: 50 });
      const received: number[] = [];

      for await (const step of handle) {
        received.push(step.stepIndex);
        if (step.stepIndex === 2) {
          handle.stop();
          break;
        }
      }

      // Step 0 was skipped because fromStep=1; duplicate step 1 was skipped due to deduplication
      expect(received).toEqual([1, 2]);
    });

    it('releases all resources and leaves no residual timers on stop()', async () => {
      const handle = tail(transcriptFile, { pollIntervalMs: 100 });

      // Start tailing in background
      const received: number[] = [];
      const iteratorPromise = (async () => {
        for await (const step of handle) {
          received.push(step.stepIndex);
        }
      })();

      // Wait a moment so the poll loop is actively waiting
      await new Promise((r) => setTimeout(r, 30));

      // Stop handle
      handle.stop();
      await iteratorPromise;

      // Ensure calling stop again is safe
      handle.stop();

      // Ensure no active timers block process exit
      // Wait slightly past pollInterval to verify no more callbacks trigger
      await new Promise((r) => setTimeout(r, 150));
      expect(received).toEqual([]);
    });

    it('cleans up timers when consumer breaks out of loop early', async () => {
      await fs.promises.writeFile(
        transcriptFile,
        JSON.stringify({ step_index: 0, kind: 'user', content: 'Hello' }) + '\n',
        'utf-8',
      );

      const handle = tail(transcriptFile, { pollIntervalMs: 80 });
      const received: number[] = [];

      for await (const step of handle) {
        received.push(step.stepIndex);
        break; // break early
      }

      expect(received).toEqual([0]);

      // Wait past poll interval to verify iterator stopped cleanly
      await new Promise((r) => setTimeout(r, 120));
    });
  });
});
