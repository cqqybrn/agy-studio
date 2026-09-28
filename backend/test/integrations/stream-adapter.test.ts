import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadProfile } from '../../src/integrations/agy/profile/loader.js';
import {
  adapt,
  DEFAULT_TOOL_KIND_MAP,
  extractFileChanges,
  extractToolTarget,
  resolveToolKind,
  type AdaptContext,
} from '../../src/integrations/agy/stream-adapter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../../../');
const PROFILE_PATH = path.resolve(REPO_ROOT, 'backend/agy-profile.json');
const FIXTURES_STREAM_DIR = path.resolve(REPO_ROOT, 'fixtures/agy/stream');

function createTestContext(overrides?: Partial<AdaptContext>): AdaptContext {
  const profile = loadProfile(PROFILE_PATH);
  let idCounter = 0;
  return {
    runId: 'run-test-123',
    nextId: () => `id-${++idCounter}`,
    now: () => '2026-09-28T12:00:00.000Z',
    profile,
    ...overrides,
  };
}

describe('stream-adapter', () => {
  describe('fixtures snapshot tests', () => {
    const scenarios = [
      'simple-chat',
      'file-ops',
      'command-exec',
      'subagent',
      'outside-workspace',
      'quota-exhausted',
      'image-path',
      'image-block-fail',
      'abort-midway',
      'multi-turn',
    ];

    for (const scenario of scenarios) {
      it(`matches snapshot for scenario: ${scenario}`, () => {
        const stdoutPath = path.join(FIXTURES_STREAM_DIR, scenario, 'stdout.jsonl');
        expect(fs.existsSync(stdoutPath)).toBe(true);

        const content = fs.readFileSync(stdoutPath, 'utf-8');
        const lines = content.split('\n').filter((l) => l.trim().length > 0);
        const ctx = createTestContext();

        const results = lines.map((line) => {
          return adapt(line, ctx);
        });

        // Invariant: adapter must never emit run.completed
        for (const res of results) {
          for (const ev of res.events) {
            expect(ev.type).not.toBe('run.completed');
          }
        }

        expect(results).toMatchSnapshot();
      });
    }
  });

  describe('schema validation failure and unknown line handling', () => {
    it('produces raw event without throwing for invalid JSON', () => {
      const ctx = createTestContext();
      const invalidJson = '{ not-valid-json: ';

      expect(() => {
        const result = adapt(invalidJson, ctx);
        expect(result.events).toHaveLength(1);
        expect(result.events[0]).toEqual({
          type: 'raw',
          payload: invalidJson,
        });
      }).not.toThrow();
    });

    it('produces raw event without throwing for non-object types', () => {
      const ctx = createTestContext();
      const nonObjects = [null, undefined, 42, true, ['an', 'array']];

      for (const item of nonObjects) {
        expect(() => {
          const result = adapt(item, ctx);
          expect(result.events).toHaveLength(1);
          expect(result.events[0].type).toBe('raw');
        }).not.toThrow();
      }
    });

    it('returns empty events for empty or whitespace string', () => {
      const ctx = createTestContext();
      expect(adapt('', ctx)).toEqual({ events: [] });
      expect(adapt('   \n  ', ctx)).toEqual({ events: [] });
    });

    it('produces raw event for unknown top-level event type not in eventTypeMap', () => {
      const ctx = createTestContext();
      const unknownLine = JSON.stringify({
        event: 'future_unknown_event',
        data: { foo: 'bar' },
      });

      const result = adapt(unknownLine, ctx);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe('raw');
      expect((result.events[0] as { payload: unknown }).payload).toEqual({
        event: 'future_unknown_event',
        data: { foo: 'bar' },
      });
    });

    it('produces raw event when schema validation fails', () => {
      const ctx = createTestContext();
      // step_update with invalid structure (missing step_index, state, etc.)
      const malformedLine = JSON.stringify({
        event: 'step_update',
        step_update: {
          step_index: 'not-a-number',
        },
      });

      const result = adapt(malformedLine, ctx);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe('raw');
    });

    it('produces raw event for unknown step_type', () => {
      const ctx = createTestContext();
      const unknownStepTypeLine = JSON.stringify({
        event: 'step_update',
        step_update: {
          step_index: 10,
          state: 'ACTIVE',
          step_type: 'unknown_future_step_type',
        },
      });

      const result = adapt(unknownStepTypeLine, ctx);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].type).toBe('raw');
    });
  });

  describe('tool name to ToolKind resolution', () => {
    it('maps known tools accurately', () => {
      expect(DEFAULT_TOOL_KIND_MAP.view_file).toBe('view_file');
      expect(resolveToolKind('view_file')).toBe('view_file');
      expect(resolveToolKind('write_to_file')).toBe('write_file');
      expect(resolveToolKind('replace_file_content')).toBe('edit_file');
      expect(resolveToolKind('run_command')).toBe('run_command');
      expect(resolveToolKind('grep_search')).toBe('search');
      expect(resolveToolKind('browser_click_element')).toBe('browser');
      expect(resolveToolKind('invoke_subagent')).toBe('subagent');
      expect(resolveToolKind('call_mcp_tool')).toBe('mcp');
      expect(resolveToolKind('manage_task')).toBe('other');
    });

    it('supports profile override', () => {
      const profile = loadProfile(PROFILE_PATH);
      const customProfile = {
        ...profile,
        toolKindMap: {
          custom_tool: 'browser',
          view_file: 'mcp',
        },
      } as unknown as typeof profile;

      expect(resolveToolKind('custom_tool', customProfile)).toBe('browser');
      expect(resolveToolKind('view_file', customProfile)).toBe('mcp');
    });

    it('uses fallback heuristics for unlisted tools', () => {
      expect(resolveToolKind('browser_custom_action')).toBe('browser');
      expect(resolveToolKind('mcp_server_eval')).toBe('mcp');
      expect(resolveToolKind('my_subagent_runner')).toBe('subagent');
      expect(resolveToolKind('quick_search_files')).toBe('search');
      expect(resolveToolKind('completely_arbitrary_name')).toBe('other');
    });
  });

  describe('file changes extraction', () => {
    it('extracts TargetFile from write_to_file as created', () => {
      const changes = extractFileChanges('write_to_file', 'write_file', {
        TargetFile: '/path/to/new-file.ts',
      });
      expect(changes).toEqual([
        {
          path: '/path/to/new-file.ts',
          changeType: 'created',
          additions: null,
          deletions: null,
        },
      ]);
    });

    it('extracts FilePath from replace_file_content as modified', () => {
      const changes = extractFileChanges('replace_file_content', 'edit_file', {
        FilePath: '/path/to/existing.ts',
        additions: 15,
        deletions: 3,
      });
      expect(changes).toEqual([
        {
          path: '/path/to/existing.ts',
          changeType: 'modified',
          additions: 15,
          deletions: 3,
        },
      ]);
    });

    it('returns empty array for non-editing tools', () => {
      expect(
        extractFileChanges('view_file', 'view_file', { AbsolutePath: '/foo/bar' })
      ).toEqual([]);
      expect(
        extractFileChanges('run_command', 'run_command', { CommandLine: 'ls' })
      ).toEqual([]);
    });
  });

  describe('tool target extraction', () => {
    it('reads the parameter names recorded from real agy', () => {
      expect(extractToolTarget('run_command', { CommandLine: 'git --version' })).toBe('git --version');
      expect(extractToolTarget('view_file', { AbsolutePath: 'C:\\Windows\\win.ini' })).toBe(
        'C:\\Windows\\win.ini'
      );
      expect(extractToolTarget('write_file', { TargetFile: 'docs/a.md' })).toBe('docs/a.md');
    });

    it('returns null when no known key holds a non-empty string', () => {
      expect(extractToolTarget('run_command', { CommandLine: '   ' })).toBeNull();
      expect(extractToolTarget('run_command', { CommandLine: 42 })).toBeNull();
      expect(extractToolTarget('other', { Action: 'list' })).toBeNull();
    });

    it('fills ToolCall.target on tool.started and tool.finished from fixture stdout', () => {
      const lines = fs
        .readFileSync(path.join(FIXTURES_STREAM_DIR, 'command-exec', 'stdout.jsonl'), 'utf8')
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0);
      const ctx = createTestContext();
      const tools = lines
        .flatMap((line) => adapt(line, ctx).events)
        .flatMap((ev) => (ev.type === 'tool.started' || ev.type === 'tool.finished' ? [ev.tool] : []));

      expect(tools.length).toBeGreaterThan(0);
      for (const tool of tools.filter((t) => t.kind === 'run_command')) {
        expect(tool.target).toBe(tool.input.CommandLine);
      }
    });
  });

  describe('subagent spawn and lifecycle', () => {
    it('emits tool.started on ACTIVE and tool.finished + subagent.spawned on DONE', () => {
      const ctx = createTestContext();

      const activeLine = {
        event: 'step_update',
        step_update: {
          step_index: 2,
          state: 'ACTIVE',
          step_type: 'subagent',
          tool_name: 'invoke_subagent',
          subagent_info: {
            subagents: [
              {
                type_name: 'research',
                role: 'Analyst',
                initial_prompt: 'Analyze data',
              },
            ],
          },
        },
      };

      const activeRes = adapt(activeLine, ctx);
      expect(activeRes.events).toHaveLength(1);
      expect(activeRes.events[0]).toMatchObject({
        type: 'tool.started',
        tool: {
          toolCallId: 'tool-run-test-123-2',
          name: 'invoke_subagent',
          kind: 'subagent',
          status: 'running',
        },
      });

      const doneLine = {
        event: 'step_update',
        step_update: {
          step_index: 2,
          state: 'DONE',
          step_type: 'subagent',
          tool_name: 'invoke_subagent',
          subagent_info: {
            subagents: [
              {
                type_name: 'research',
                role: 'Analyst',
                initial_prompt: 'Analyze data',
                conversation_id: 'sub-conv-456',
              },
            ],
          },
        },
      };

      const doneRes = adapt(doneLine, ctx);
      expect(doneRes.events).toHaveLength(2);
      expect(doneRes.events[0]).toMatchObject({
        type: 'tool.finished',
        tool: {
          toolCallId: 'tool-run-test-123-2',
          name: 'invoke_subagent',
          kind: 'subagent',
          status: 'succeeded',
        },
      });
      expect(doneRes.events[1]).toEqual({
        type: 'subagent.spawned',
        parentToolCallId: 'tool-run-test-123-2',
        subagent: {
          conversationId: 'sub-conv-456',
          role: 'Analyst',
          typeName: 'research',
          initialPrompt: 'Analyze data',
          status: 'running',
        },
      });
    });
  });

  describe('terminal and usage returns', () => {
    it('returns completed terminal and usage on SUCCESS result without emitting run.completed', () => {
      const ctx = createTestContext();
      const resultLine = {
        event: 'result',
        result: {
          conversation_id: 'conv-111',
          status: 'SUCCESS',
          response: 'Done successfully.',
          num_turns: 1,
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            thinking_tokens: 20,
            cache_read_tokens: 0,
            total_tokens: 150,
          },
        },
      };

      const res = adapt(resultLine, ctx);
      expect(res.terminal).toEqual({ status: 'completed' });
      expect(res.usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        thinkingTokens: 20,
        cacheReadTokens: 0,
        totalTokens: 150,
      });
      expect(res.conversationId).toBe('conv-111');

      // Invariant: run.completed MUST NOT be emitted by adapter
      expect(res.events.some((e) => e.type === 'run.completed')).toBe(false);
      // It emits the usage event
      expect(res.events).toEqual([
        {
          type: 'usage',
          usage: {
            inputTokens: 100,
            outputTokens: 50,
            thinkingTokens: 20,
            cacheReadTokens: 0,
            totalTokens: 150,
          },
        },
      ]);
    });

    it('returns failed terminal with ApiErrorBody on ERROR result', () => {
      const ctx = createTestContext();
      const errorLine = {
        event: 'result',
        result: {
          status: 'ERROR',
          error: 'model invalid-model is not recognized',
          num_turns: 0,
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            thinking_tokens: 0,
            cache_read_tokens: 0,
            total_tokens: 0,
          },
        },
      };

      const res = adapt(errorLine, ctx);
      expect(res.terminal).toEqual({
        status: 'failed',
        error: {
          code: 'BAD_REQUEST',
          message: 'model invalid-model is not recognized',
          retryable: false,
        },
      });
    });

    it('maps quota exhaustion errors to QUOTA_EXHAUSTED', () => {
      const ctx = createTestContext();
      const errorLine = {
        event: 'result',
        result: {
          status: 'ERROR',
          error: 'Rate limit exceeded: user quota exhausted',
        },
      };

      const res = adapt(errorLine, ctx);
      expect(res.terminal?.status).toBe('failed');
      expect(res.terminal?.error?.code).toBe('QUOTA_EXHAUSTED');
    });
  });

  describe('permission event detection', () => {
    it('never flags permission requests with the real profile (permissionEvent is null: no recorded sample)', () => {
      const ctx = createTestContext();
      expect(ctx.profile.stream.permissionEvent).toBeNull();

      const res = adapt({ event: 'ask_permission', tool: 'run_command' }, ctx);
      expect(res.permissionRequest).toBeUndefined();
      expect(res.events[0].type).toBe('raw');
    });

    it('sets permissionRequest to true when a profile explicitly configures permissionEvent', () => {
      const base = createTestContext();
      // 假设性配置：仅用于验证可选的 L3 机制，不代表真实 agy 格式
      const ctx = createTestContext({
        profile: {
          ...base.profile,
          stream: {
            ...base.profile.stream,
            permissionEvent: {
              match: { event: 'ask_permission' },
              replyTemplate: '{"event":"permission_response","allow":true}',
            },
          },
        },
      });

      const res = adapt({ event: 'ask_permission', tool: 'run_command' }, ctx);
      expect(res.permissionRequest).toBe(true);
      expect(res.events[0].type).toBe('raw'); // because ask_permission is not in eventTypeMap
    });
  });
});
