import { describe, expect, it } from 'vitest';
import type {
  Attachment,
  SessionEventEnvelope,
  ToolCall,
  TranscriptStep,
} from '@agy-studio/contracts';
import {
  createInitialTimelineState,
  findSubagent,
  findTool,
  isGroupableToolKind,
  reduce,
  reduceAll,
} from './timelineReducer';
import type {
  AssistantMessageItem,
  ErrorItem,
  RunDividerItem,
  StalledNoticeItem,
  SubagentItem,
  ThinkingItem,
  ToolGroupItem,
  ToolItem,
  UserMessageItem,
} from './timeline.types';

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  Object.freeze(obj);
  for (const key of Object.getOwnPropertyNames(obj)) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== null && typeof val === 'object' && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

function makeEnvelope(
  seq: number,
  event: SessionEventEnvelope['event'],
  opts?: {
    runId?: string | null;
    sessionId?: string;
    ts?: string;
  }
): SessionEventEnvelope {
  return {
    seq,
    sessionId: opts?.sessionId ?? 'sess_1',
    runId: opts?.runId ?? 'run_1',
    ts: opts?.ts ?? `2026-09-28T10:00:0${seq}.000Z`,
    event,
  };
}

function makeTool(
  toolCallId: string,
  kind: ToolCall['kind'] = 'view_file',
  opts?: Partial<ToolCall>
): ToolCall {
  return {
    toolCallId,
    name: kind,
    kind,
    input: { AbsolutePath: `src/${toolCallId}.ts` },
    target: `src/${toolCallId}.ts`,
    output: null,
    error: null,
    status: 'running',
    fileChanges: [],
    startedAt: '2026-09-28T10:00:00.000Z',
    endedAt: null,
    ...opts,
  };
}

describe('timelineReducer', () => {
  it('creates initial state properly', () => {
    const state = createInitialTimelineState();
    expect(state).toEqual({
      items: [],
      lastSeq: 0,
      activeRunId: null,
      lastUsage: null,
    });
  });

  it('reduces empty array to initial state', () => {
    const state = reduceAll([]);
    expect(state).toEqual(createInitialTimelineState());
  });

  it('guarantees immutability with deepFreeze on state and envelopes', () => {
    let state = createInitialTimelineState();
    const envelopes: SessionEventEnvelope[] = [
      makeEnvelope(1, {
        type: 'run.started',
        runId: 'run_1',
        model: 'gemini-2.5',
        cwd: 'G:/new',
        checkpointId: null,
      }),
      makeEnvelope(2, {
        type: 'user.message',
        messageId: 'u1',
        text: 'Hello world',
        attachments: [],
      }),
      makeEnvelope(3, {
        type: 'thinking.delta',
        blockId: 'th_1',
        source: 'stream',
        text: 'Let me think',
      }),
      makeEnvelope(4, {
        type: 'thinking.delta',
        blockId: 'th_1',
        source: 'stream',
        text: ' a bit more',
      }),
      makeEnvelope(5, {
        type: 'thinking.done',
        blockId: 'th_1',
        durationMs: 1200,
      }),
      makeEnvelope(6, {
        type: 'tool.started',
        tool: makeTool('t1', 'view_file'),
      }),
      makeEnvelope(7, {
        type: 'tool.updated',
        toolCallId: 't1',
        patch: { output: 'file contents' },
      }),
      makeEnvelope(8, {
        type: 'tool.finished',
        tool: makeTool('t1', 'view_file', { status: 'succeeded', output: 'file contents' }),
      }),
      makeEnvelope(9, {
        type: 'tool.started',
        tool: makeTool('t2', 'search'),
      }),
      makeEnvelope(10, {
        type: 'subagent.spawned',
        parentToolCallId: 't2',
        subagent: {
          conversationId: 'sub_1',
          role: 'researcher',
          typeName: 'general',
          initialPrompt: 'find tests',
          status: 'running',
        },
      }),
      makeEnvelope(11, {
        type: 'subagent.step',
        conversationId: 'sub_1',
        step: {
          stepIndex: 0,
          type: 'thought',
          status: 'ok',
          createdAt: '2026-09-28T10:00:11.000Z',
          content: 'searching code',
          thinking: null,
          toolCalls: [],
          error: null,
        },
      }),
      makeEnvelope(12, {
        type: 'subagent.finished',
        conversationId: 'sub_1',
        status: 'completed',
      }),
      makeEnvelope(13, {
        type: 'tool.finished',
        tool: makeTool('t2', 'search', { status: 'succeeded' }),
      }),
      makeEnvelope(14, {
        type: 'message.delta',
        messageId: 'm1',
        text: 'All done',
      }),
      makeEnvelope(15, {
        type: 'message.done',
        messageId: 'm1',
      }),
      makeEnvelope(16, {
        type: 'run.completed',
        status: 'completed',
        durationMs: 5000,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          thinkingTokens: 20,
          cacheReadTokens: 0,
          totalTokens: 170,
        },
        error: null,
        agyConversationId: 'agy_conv_1',
      }),
    ];

    // Every single step passes deeply frozen inputs to reduce
    for (const env of envelopes) {
      deepFreeze(state);
      deepFreeze(env);
      expect(() => {
        state = reduce(state, env);
      }).not.toThrow();
    }

    expect(state.items.length).toBeGreaterThan(0);
    expect(state.activeRunId).toBeNull();
    expect(state.lastSeq).toBe(16);
  });

  it('guarantees deterministic results: reduceAll twice yields deeply equal state', () => {
    const envelopes: SessionEventEnvelope[] = [
      makeEnvelope(1, {
        type: 'run.started',
        runId: 'run_1',
        model: 'gemini-2.5',
        cwd: 'G:/new',
        checkpointId: null,
      }),
      makeEnvelope(2, {
        type: 'user.message',
        messageId: 'u1',
        text: 'Find files',
        attachments: [],
      }),
      makeEnvelope(3, {
        type: 'tool.started',
        tool: makeTool('t1', 'view_file'),
      }),
      makeEnvelope(4, {
        type: 'tool.started',
        tool: makeTool('t2', 'search'),
      }),
      makeEnvelope(5, {
        type: 'message.delta',
        messageId: 'm1',
        text: 'Results found.',
      }),
      makeEnvelope(6, {
        type: 'run.completed',
        status: 'completed',
        durationMs: 3000,
        usage: null,
        error: null,
        agyConversationId: 'agy_1',
      }),
    ];

    const stateA = reduceAll(envelopes);
    const stateB = reduceAll(envelopes);

    expect(stateA).toEqual(stateB);
    expect(JSON.stringify(stateA)).toBe(JSON.stringify(stateB));
  });

  describe('user.message', () => {
    it('appends UserMessageItem with attachments', () => {
      const attachment: Attachment = {
        id: 'att_1',
        workspaceId: 'ws_1',
        sessionId: 'sess_1',
        kind: 'image',
        originalName: 'screen.png',
        mimeType: 'image/png',
        size: 1024,
        storedPath: 'G:/new/.agy-attachments/screen.png',
        derivedTextPath: null,
        createdAt: '2026-09-28T10:00:00.000Z',
      };

      const env = makeEnvelope(1, {
        type: 'user.message',
        messageId: 'msg_1',
        text: 'Check this diagram',
        attachments: [attachment],
      });

      const state = reduce(undefined, env);
      expect(state.items).toHaveLength(1);

      const item = state.items[0] as UserMessageItem;
      expect(item.kind).toBe('user_message');
      expect(item.type).toBe('user_message');
      expect(item.id).toBe('user-msg-msg_1');
      expect(item.messageId).toBe('msg_1');
      expect(item.text).toBe('Check this diagram');
      expect(item.attachments).toEqual([attachment]);
      expect(item.createdAt).toBe(env.ts);
    });
  });

  describe('thinking process', () => {
    it('accumulates deltas across multiple events and calculates durationMs from timestamps', () => {
      const env1 = makeEnvelope(1, {
        type: 'thinking.delta',
        blockId: 'th_block',
        source: 'stream',
        text: 'Thinking step 1. ',
      }, { ts: '2026-09-28T10:00:00.000Z' });

      const env2 = makeEnvelope(2, {
        type: 'thinking.delta',
        blockId: 'th_block',
        source: 'stream',
        text: 'Step 2.',
      }, { ts: '2026-09-28T10:00:03.500Z' });

      let state = reduce(undefined, env1);
      state = reduce(state, env2);

      expect(state.items).toHaveLength(1);
      const item = state.items[0] as ThinkingItem;
      expect(item.kind).toBe('thinking');
      expect(item.blockId).toBe('th_block');
      expect(item.text).toBe('Thinking step 1. Step 2.');
      expect(item.startedAt).toBe('2026-09-28T10:00:00.000Z');
      expect(item.endedAt).toBe('2026-09-28T10:00:03.500Z');
      expect(item.durationMs).toBe(3500);
      expect(item.isComplete).toBe(false);
    });

    it('handles thinking.done with authoritative durationMs and fallback calculation', () => {
      const env1 = makeEnvelope(1, {
        type: 'thinking.delta',
        blockId: 'th_block',
        source: 'stream',
        text: 'Planning...',
      }, { ts: '2026-09-28T10:00:00.000Z' });

      const env2 = makeEnvelope(2, {
        type: 'thinking.done',
        blockId: 'th_block',
        durationMs: 4200,
      }, { ts: '2026-09-28T10:00:05.000Z' });

      const state = reduceAll([env1, env2]);
      const item = state.items[0] as ThinkingItem;
      expect(item.isComplete).toBe(true);
      expect(item.durationMs).toBe(4200);

      // When durationMs is null, fallback to timestamp difference
      const env3 = makeEnvelope(2, {
        type: 'thinking.done',
        blockId: 'th_block',
        durationMs: null,
      }, { ts: '2026-09-28T10:00:06.000Z' });

      const stateWithNullDur = reduce(reduce(undefined, env1), env3);
      const item2 = stateWithNullDur.items[0] as ThinkingItem;
      expect(item2.isComplete).toBe(true);
      expect(item2.durationMs).toBe(6000);
    });

    it('handles thinking.done arriving without prior deltas gracefully', () => {
      const env = makeEnvelope(1, {
        type: 'thinking.done',
        blockId: 'empty_block',
        durationMs: 500,
      });

      const state = reduce(undefined, env);
      expect(state.items).toHaveLength(1);
      const item = state.items[0] as ThinkingItem;
      expect(item.blockId).toBe('empty_block');
      expect(item.isComplete).toBe(true);
      expect(item.durationMs).toBe(500);
      expect(item.text).toBe('');
    });
  });

  describe('assistant message', () => {
    it('accumulates deltas across multiple events and handles message.done', () => {
      const env1 = makeEnvelope(1, {
        type: 'message.delta',
        messageId: 'msg_a',
        text: 'Hello, ',
      });
      const env2 = makeEnvelope(2, {
        type: 'message.delta',
        messageId: 'msg_a',
        text: 'how can I help you?',
      });
      const env3 = makeEnvelope(3, {
        type: 'message.done',
        messageId: 'msg_a',
      });

      const state = reduceAll([env1, env2, env3]);
      expect(state.items).toHaveLength(1);

      const item = state.items[0] as AssistantMessageItem;
      expect(item.kind).toBe('assistant_message');
      expect(item.type).toBe('assistant_message');
      expect(item.messageId).toBe('msg_a');
      expect(item.text).toBe('Hello, how can I help you?');
      expect(item.isComplete).toBe(true);
    });

    it('handles message.done without prior deltas', () => {
      const env = makeEnvelope(1, {
        type: 'message.done',
        messageId: 'msg_empty',
      });

      const state = reduce(undefined, env);
      expect(state.items).toHaveLength(1);
      const item = state.items[0] as AssistantMessageItem;
      expect(item.messageId).toBe('msg_empty');
      expect(item.text).toBe('');
      expect(item.isComplete).toBe(true);
    });
  });

  describe('tools and tool grouping', () => {
    it('leaves a single view_file tool as ToolItem', () => {
      const env = makeEnvelope(1, {
        type: 'tool.started',
        tool: makeTool('t1', 'view_file'),
      });

      const state = reduce(undefined, env);
      expect(state.items).toHaveLength(1);
      expect(state.items[0].kind).toBe('tool');
      expect((state.items[0] as ToolItem).toolCallId).toBe('t1');
    });

    it('merges 2 consecutive view_file / search tools into a ToolGroupItem', () => {
      const env1 = makeEnvelope(1, {
        type: 'tool.started',
        tool: makeTool('t1', 'view_file'),
      });
      const env2 = makeEnvelope(2, {
        type: 'tool.started',
        tool: makeTool('t2', 'search'),
      });

      const state = reduceAll([env1, env2]);
      expect(state.items).toHaveLength(1);
      expect(state.items[0].kind).toBe('tool_group');

      const group = state.items[0] as ToolGroupItem;
      expect(group.tools).toHaveLength(2);
      expect(group.tools[0].toolCallId).toBe('t1');
      expect(group.tools[1].toolCallId).toBe('t2');
      expect(group.id).toBe('tool-group-t1');
    });

    it('merges 3 consecutive view_file and search tools into the same ToolGroupItem', () => {
      const env1 = makeEnvelope(1, {
        type: 'tool.started',
        tool: makeTool('t1', 'view_file'),
      });
      const env2 = makeEnvelope(2, {
        type: 'tool.started',
        tool: makeTool('t2', 'search'),
      });
      const env3 = makeEnvelope(3, {
        type: 'tool.started',
        tool: makeTool('t3', 'view_file'),
      });

      const state = reduceAll([env1, env2, env3]);
      expect(state.items).toHaveLength(1);
      const group = state.items[0] as ToolGroupItem;
      expect(group.tools).toHaveLength(3);
      expect(group.tools.map((t) => t.toolCallId)).toEqual(['t1', 't2', 't3']);
    });

    it('updates a tool inside a ToolGroupItem when tool.updated or tool.finished arrives', () => {
      const env1 = makeEnvelope(1, {
        type: 'tool.started',
        tool: makeTool('t1', 'view_file'),
      });
      const env2 = makeEnvelope(2, {
        type: 'tool.started',
        tool: makeTool('t2', 'search'),
      });
      const env3 = makeEnvelope(3, {
        type: 'tool.updated',
        toolCallId: 't1',
        patch: { output: 'read line 1-10' },
      });
      const env4 = makeEnvelope(4, {
        type: 'tool.finished',
        tool: makeTool('t2', 'search', { status: 'succeeded', output: 'found 3 matches' }),
      });

      const state = reduceAll([env1, env2, env3, env4]);
      expect(state.items).toHaveLength(1);
      const group = state.items[0] as ToolGroupItem;
      expect(group.tools).toHaveLength(2);

      expect(group.tools[0].tool.output).toBe('read line 1-10');
      expect(group.tools[1].tool.status).toBe('succeeded');
      expect(group.tools[1].tool.output).toBe('found 3 matches');
    });

    it('does NOT group non-groupable tools like edit_file or run_command', () => {
      const env1 = makeEnvelope(1, {
        type: 'tool.started',
        tool: makeTool('t1', 'edit_file'),
      });
      const env2 = makeEnvelope(2, {
        type: 'tool.started',
        tool: makeTool('t2', 'edit_file'),
      });

      const state = reduceAll([env1, env2]);
      expect(state.items).toHaveLength(2);
      expect(state.items[0].kind).toBe('tool');
      expect(state.items[1].kind).toBe('tool');
    });

    it('interrupts tool grouping when a non-groupable tool is interleaved', () => {
      // view_file, edit_file, view_file -> none should merge
      const env1 = makeEnvelope(1, {
        type: 'tool.started',
        tool: makeTool('t1', 'view_file'),
      });
      const env2 = makeEnvelope(2, {
        type: 'tool.started',
        tool: makeTool('t2', 'edit_file'),
      });
      const env3 = makeEnvelope(3, {
        type: 'tool.started',
        tool: makeTool('t3', 'view_file'),
      });

      const state = reduceAll([env1, env2, env3]);
      expect(state.items).toHaveLength(3);
      expect(state.items.map((i) => i.kind)).toEqual(['tool', 'tool', 'tool']);
    });

    it('interrupts tool grouping when thinking or message deltas intervene', () => {
      // view_file, thinking.delta, view_file -> not merged
      const env1 = makeEnvelope(1, {
        type: 'tool.started',
        tool: makeTool('t1', 'view_file'),
      });
      const env2 = makeEnvelope(2, {
        type: 'thinking.delta',
        blockId: 'th_mid',
        source: 'stream',
        text: 'pondering',
      });
      const env3 = makeEnvelope(3, {
        type: 'tool.started',
        tool: makeTool('t2', 'view_file'),
      });

      const state = reduceAll([env1, env2, env3]);
      expect(state.items).toHaveLength(3);
      expect(state.items[0].kind).toBe('tool');
      expect(state.items[1].kind).toBe('thinking');
      expect(state.items[2].kind).toBe('tool');
    });

    it('does NOT group tools across different runs', () => {
      const env1 = makeEnvelope(1, {
        type: 'tool.started',
        tool: makeTool('t1', 'view_file'),
      }, { runId: 'run_1' });

      const env2 = makeEnvelope(2, {
        type: 'run.completed',
        status: 'completed',
        durationMs: 1000,
        usage: null,
        error: null,
        agyConversationId: null,
      }, { runId: 'run_1' });

      const env3 = makeEnvelope(3, {
        type: 'tool.started',
        tool: makeTool('t2', 'view_file'),
      }, { runId: 'run_2' });

      const state = reduceAll([env1, env2, env3]);
      expect(state.items).toHaveLength(3);
      expect(state.items[0].kind).toBe('tool');
      expect(state.items[1].kind).toBe('run_divider');
      expect(state.items[2].kind).toBe('tool');
    });

    it('does NOT group tools in different runs even if no run divider exists between them', () => {
      const env1 = makeEnvelope(1, {
        type: 'tool.started',
        tool: makeTool('t1', 'view_file'),
      }, { runId: 'run_1' });

      const env2 = makeEnvelope(2, {
        type: 'tool.started',
        tool: makeTool('t2', 'search'),
      }, { runId: 'run_2' });

      const state = reduceAll([env1, env2]);
      expect(state.items).toHaveLength(2);
      expect(state.items[0].kind).toBe('tool');
      expect(state.items[1].kind).toBe('tool');
    });

    it('forms a second ToolGroup after an intervening tool closes the first group', () => {
      const envelopes = [
        makeEnvelope(1, { type: 'tool.started', tool: makeTool('t1', 'view_file') }),
        makeEnvelope(2, { type: 'tool.started', tool: makeTool('t2', 'search') }),
        makeEnvelope(3, { type: 'tool.started', tool: makeTool('t3', 'run_command') }),
        makeEnvelope(4, { type: 'tool.started', tool: makeTool('t4', 'search') }),
        makeEnvelope(5, { type: 'tool.started', tool: makeTool('t5', 'view_file') }),
      ];

      const state = reduceAll(envelopes);
      expect(state.items).toHaveLength(3);
      expect(state.items[0].kind).toBe('tool_group');
      expect(state.items[1].kind).toBe('tool');
      expect(state.items[2].kind).toBe('tool_group');

      const group1 = state.items[0] as ToolGroupItem;
      const group2 = state.items[2] as ToolGroupItem;
      expect(group1.tools.map((t) => t.toolCallId)).toEqual(['t1', 't2']);
      expect(group2.tools.map((t) => t.toolCallId)).toEqual(['t4', 't5']);
    });
  });

  describe('subagents and steps', () => {
    it('mounts subagent under parent tool call and appends multiple steps', () => {
      const step1: TranscriptStep = {
        stepIndex: 0,
        type: 'thought',
        status: 'ok',
        createdAt: '2026-09-28T10:00:00.000Z',
        content: 'Analyzing repository structure',
        thinking: 'Let me inspect files',
        toolCalls: [],
        error: null,
      };

      const step2: TranscriptStep = {
        stepIndex: 1,
        type: 'tool',
        status: 'ok',
        createdAt: '2026-09-28T10:00:02.000Z',
        content: null,
        thinking: null,
        toolCalls: [{ name: 'read', args: { path: 'README.md' } }],
        error: null,
      };

      const envelopes = [
        makeEnvelope(1, {
          type: 'tool.started',
          tool: makeTool('parent_tool_1', 'subagent'),
        }),
        makeEnvelope(2, {
          type: 'subagent.spawned',
          parentToolCallId: 'parent_tool_1',
          subagent: {
            conversationId: 'sub_alpha',
            role: 'architect',
            typeName: 'generalPurpose',
            initialPrompt: 'Inspect architecture',
            status: 'running',
          },
        }),
        makeEnvelope(3, {
          type: 'subagent.step',
          conversationId: 'sub_alpha',
          step: step1,
        }),
        makeEnvelope(4, {
          type: 'subagent.step',
          conversationId: 'sub_alpha',
          step: step2,
        }),
        makeEnvelope(5, {
          type: 'subagent.finished',
          conversationId: 'sub_alpha',
          status: 'completed',
        }),
      ];

      const state = reduceAll(envelopes);
      expect(state.items).toHaveLength(1);

      const parentTool = state.items[0] as ToolItem;
      expect(parentTool.subagents).toHaveLength(1);

      const subagent = parentTool.subagents[0];
      expect(subagent.conversationId).toBe('sub_alpha');
      expect(subagent.role).toBe('architect');
      expect(subagent.status).toBe('completed');
      expect(subagent.steps).toEqual([step1, step2]);

      // Helper lookup
      const found = findSubagent(state, 'sub_alpha');
      expect(found).toBeDefined();
      expect(found?.conversationId).toBe('sub_alpha');
    });

    it('mounts subagent under a tool that is inside a ToolGroupItem', () => {
      const step1: TranscriptStep = {
        stepIndex: 0,
        type: 'step',
        status: null,
        createdAt: null,
        content: 'child step',
        thinking: null,
        toolCalls: [],
        error: null,
      };

      const envelopes = [
        makeEnvelope(1, { type: 'tool.started', tool: makeTool('t1', 'view_file') }),
        makeEnvelope(2, { type: 'tool.started', tool: makeTool('t2', 'search') }),
        makeEnvelope(3, {
          type: 'subagent.spawned',
          parentToolCallId: 't2',
          subagent: {
            conversationId: 'nested_sub',
            role: 'search_helper',
            typeName: 'explore',
            initialPrompt: 'deep search',
            status: 'running',
          },
        }),
        makeEnvelope(4, {
          type: 'subagent.step',
          conversationId: 'nested_sub',
          step: step1,
        }),
        makeEnvelope(5, {
          type: 'subagent.finished',
          conversationId: 'nested_sub',
          status: 'completed',
        }),
      ];

      const state = reduceAll(envelopes);
      expect(state.items).toHaveLength(1);

      const group = state.items[0] as ToolGroupItem;
      expect(group.tools).toHaveLength(2);
      expect(group.tools[1].subagents).toHaveLength(1);

      const sub = group.tools[1].subagents[0];
      expect(sub.conversationId).toBe('nested_sub');
      expect(sub.steps).toEqual([step1]);
      expect(sub.status).toBe('completed');

      const foundSub = findSubagent(state, 'nested_sub');
      expect(foundSub).toBeDefined();
      expect(foundSub?.conversationId).toBe('nested_sub');
    });

    it('places subagent at top-level when parentToolCallId is null', () => {
      const env1 = makeEnvelope(1, {
        type: 'subagent.spawned',
        parentToolCallId: null,
        subagent: {
          conversationId: 'root_sub',
          role: 'planner',
          typeName: 'planner',
          initialPrompt: 'plan work',
          status: 'running',
        },
      });

      const env2 = makeEnvelope(2, {
        type: 'subagent.step',
        conversationId: 'root_sub',
        step: {
          stepIndex: 0,
          type: 'thought',
          status: 'ok',
          createdAt: null,
          content: 'planning steps',
          thinking: null,
          toolCalls: [],
          error: null,
        },
      });

      const state = reduceAll([env1, env2]);
      expect(state.items).toHaveLength(1);
      expect(state.items[0].kind).toBe('subagent');

      const subItem = state.items[0] as SubagentItem;
      expect(subItem.conversationId).toBe('root_sub');
      expect(subItem.steps).toHaveLength(1);
    });

    it('synthesizes subagent at top level if subagent.step arrives before subagent.spawned', () => {
      const env = makeEnvelope(1, {
        type: 'subagent.step',
        conversationId: 'unexpected_sub',
        step: {
          stepIndex: 0,
          type: 'message',
          status: null,
          createdAt: null,
          content: 'out of order step',
          thinking: null,
          toolCalls: [],
          error: null,
        },
      });

      const state = reduce(undefined, env);
      expect(state.items).toHaveLength(1);
      expect(state.items[0].kind).toBe('subagent');
      const subItem = state.items[0] as SubagentItem;
      expect(subItem.conversationId).toBe('unexpected_sub');
      expect(subItem.steps).toHaveLength(1);
    });
  });

  describe('run lifecycle, errors, stalls and ignored events', () => {
    it('creates RunDividerItem on run.completed and clears activeRunId', () => {
      const envStart = makeEnvelope(1, {
        type: 'run.started',
        runId: 'run_10',
        model: 'gemini-1.5-pro',
        cwd: 'G:/new',
        checkpointId: 'chk_1',
      }, { runId: 'run_10' });

      const envComp = makeEnvelope(2, {
        type: 'run.completed',
        status: 'completed',
        durationMs: 8400,
        usage: {
          inputTokens: 1000,
          outputTokens: 200,
          thinkingTokens: 150,
          cacheReadTokens: 50,
          totalTokens: 1400,
        },
        error: null,
        agyConversationId: 'agy_conv_abc',
      }, { runId: 'run_10' });

      let state = reduce(undefined, envStart);
      expect(state.activeRunId).toBe('run_10');

      state = reduce(state, envComp);
      expect(state.activeRunId).toBeNull();
      expect(state.items).toHaveLength(1);

      const divider = state.items[0] as RunDividerItem;
      expect(divider.kind).toBe('run_divider');
      expect(divider.type).toBe('run_divider');
      expect(divider.durationMs).toBe(8400);
      expect(divider.status).toBe('completed');
      expect(divider.agyConversationId).toBe('agy_conv_abc');
      expect(divider.usage?.totalTokens).toBe(1400);
    });

    it('creates ErrorItem on run.error without terminating the run', () => {
      const envStart = makeEnvelope(1, {
        type: 'run.started',
        runId: 'run_err',
        model: 'gemini',
        cwd: 'G:/new',
        checkpointId: null,
      }, { runId: 'run_err' });

      const envErr = makeEnvelope(2, {
        type: 'run.error',
        error: {
          code: 'AGY_TIMEOUT',
          message: 'Process timed out after 30s',
          retryable: true,
        },
      }, { runId: 'run_err' });

      const envMsg = makeEnvelope(3, {
        type: 'message.delta',
        messageId: 'msg_after_err',
        text: 'Recovering...',
      }, { runId: 'run_err' });

      const state = reduceAll([envStart, envErr, envMsg]);
      expect(state.activeRunId).toBe('run_err');
      expect(state.items).toHaveLength(2);

      const errItem = state.items[0] as ErrorItem;
      expect(errItem.kind).toBe('error');
      expect(errItem.error.code).toBe('AGY_TIMEOUT');

      const msgItem = state.items[1] as AssistantMessageItem;
      expect(msgItem.kind).toBe('assistant_message');
      expect(msgItem.text).toBe('Recovering...');
    });

    it('creates StalledNoticeItem on run.stalled', () => {
      const env = makeEnvelope(1, {
        type: 'run.stalled',
        idleMs: 15000,
      });

      const state = reduce(undefined, env);
      expect(state.items).toHaveLength(1);
      const stall = state.items[0] as StalledNoticeItem;
      expect(stall.kind).toBe('stalled_notice');
      expect(stall.idleMs).toBe(15000);
    });

    it('records usage event in state.lastUsage without adding timeline items', () => {
      const env = makeEnvelope(1, {
        type: 'usage',
        usage: {
          inputTokens: 50,
          outputTokens: 25,
          thinkingTokens: 10,
          cacheReadTokens: 0,
          totalTokens: 85,
        },
      });

      const state = reduce(undefined, env);
      expect(state.items).toHaveLength(0);
      expect(state.lastUsage?.totalTokens).toBe(85);
    });

    it('safely ignores raw, artifact.updated, and autoapprove.injected events', () => {
      const envelopes = [
        makeEnvelope(1, { type: 'raw', payload: { foo: 'bar' } }),
        makeEnvelope(2, {
          type: 'artifact.updated',
          artifact: {
            id: 'art_1',
            sessionId: 'sess_1',
            conversationId: 'conv_1',
            kind: 'task',
            name: 'task.md',
            relativePath: 'task.md',
            mimeType: 'text/markdown',
            size: 200,
            version: 1,
            updatedAt: '2026-09-28T10:00:00.000Z',
          },
        }),
        makeEnvelope(3, {
          type: 'autoapprove.injected',
          layer: 'watchdog',
          detail: 'Auto-approving terminal command',
        }),
      ];

      const state = reduceAll(envelopes);
      expect(state.items).toHaveLength(0);
      expect(state.lastSeq).toBe(3);
    });
  });

  describe('helper functions', () => {
    it('isGroupableToolKind identifies view_file and search correctly', () => {
      expect(isGroupableToolKind('view_file')).toBe(true);
      expect(isGroupableToolKind('search')).toBe(true);
      expect(isGroupableToolKind('edit_file')).toBe(false);
      expect(isGroupableToolKind('write_file')).toBe(false);
      expect(isGroupableToolKind('run_command')).toBe(false);
      expect(isGroupableToolKind('browser')).toBe(false);
      expect(isGroupableToolKind('subagent')).toBe(false);
      expect(isGroupableToolKind('mcp')).toBe(false);
      expect(isGroupableToolKind('other')).toBe(false);
    });

    it('findTool finds top-level and grouped tools, returns null when missing', () => {
      const state = reduceAll([
        makeEnvelope(1, { type: 'tool.started', tool: makeTool('t_solo', 'edit_file') }),
        makeEnvelope(2, { type: 'tool.started', tool: makeTool('t_group_1', 'view_file') }),
        makeEnvelope(3, { type: 'tool.started', tool: makeTool('t_group_2', 'search') }),
      ]);

      expect(findTool(state, 't_solo')?.toolCallId).toBe('t_solo');
      expect(findTool(state, 't_group_1')?.toolCallId).toBe('t_group_1');
      expect(findTool(state, 't_group_2')?.toolCallId).toBe('t_group_2');
      expect(findTool(state, 'non_existent')).toBeNull();
    });
  });

  describe('full multi-turn realistic scenario snapshot', () => {
    it('processes a comprehensive multi-turn session matching snapshot expectations', () => {
      const envelopes: SessionEventEnvelope[] = [
        // Turn 1 start
        makeEnvelope(1, {
          type: 'run.started',
          runId: 'run_turn_1',
          model: 'gemini-2.5',
          cwd: 'G:/new',
          checkpointId: 'cp_101',
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:01.000Z' }),

        // User asks to analyze repository
        makeEnvelope(2, {
          type: 'user.message',
          messageId: 'user_turn_1',
          text: 'Please inspect the project and run tests.',
          attachments: [],
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:02.000Z' }),

        // Thinking deltas
        makeEnvelope(3, {
          type: 'thinking.delta',
          blockId: 'think_turn_1',
          source: 'stream',
          text: 'I should first read package.json. ',
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:03.000Z' }),
        makeEnvelope(4, {
          type: 'thinking.delta',
          blockId: 'think_turn_1',
          source: 'stream',
          text: 'Then I can search for test scripts.',
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:04.000Z' }),
        makeEnvelope(5, {
          type: 'thinking.done',
          blockId: 'think_turn_1',
          durationMs: 2500,
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:05.500Z' }),

        // 3 consecutive groupable tools (view_file, search, view_file)
        makeEnvelope(6, {
          type: 'tool.started',
          tool: makeTool('call_view_1', 'view_file', { input: { path: 'package.json' } }),
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:06.000Z' }),
        makeEnvelope(7, {
          type: 'tool.finished',
          tool: makeTool('call_view_1', 'view_file', {
            status: 'succeeded',
            output: '{"scripts": {"test": "vitest"}}',
          }),
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:07.000Z' }),

        makeEnvelope(8, {
          type: 'tool.started',
          tool: makeTool('call_search_1', 'search', { input: { pattern: 'test' } }),
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:08.000Z' }),

        // Subagent spawned under search tool
        makeEnvelope(9, {
          type: 'subagent.spawned',
          parentToolCallId: 'call_search_1',
          subagent: {
            conversationId: 'sub_crawler',
            role: 'file_searcher',
            typeName: 'explore',
            initialPrompt: 'look for test files',
            status: 'running',
          },
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:09.000Z' }),
        makeEnvelope(10, {
          type: 'subagent.step',
          conversationId: 'sub_crawler',
          step: {
            stepIndex: 0,
            type: 'tool_call',
            status: 'ok',
            createdAt: '2026-09-28T10:00:09.500Z',
            content: 'Found 3 test files',
            thinking: null,
            toolCalls: [],
            error: null,
          },
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:10.000Z' }),
        makeEnvelope(11, {
          type: 'subagent.finished',
          conversationId: 'sub_crawler',
          status: 'completed',
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:11.000Z' }),
        makeEnvelope(12, {
          type: 'tool.finished',
          tool: makeTool('call_search_1', 'search', {
            status: 'succeeded',
            output: 'src/a.test.ts, src/b.test.ts',
          }),
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:12.000Z' }),

        // Third groupable tool in the same sequence
        makeEnvelope(13, {
          type: 'tool.started',
          tool: makeTool('call_view_2', 'view_file', { input: { path: 'src/a.test.ts' } }),
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:13.000Z' }),
        makeEnvelope(14, {
          type: 'tool.finished',
          tool: makeTool('call_view_2', 'view_file', {
            status: 'succeeded',
            output: 'describe("a", ...)',
          }),
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:14.000Z' }),

        // Non-groupable tool (breaks group)
        makeEnvelope(15, {
          type: 'tool.started',
          tool: makeTool('call_cmd_1', 'run_command', { input: { command: 'npm test' } }),
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:15.000Z' }),
        makeEnvelope(16, {
          type: 'tool.finished',
          tool: makeTool('call_cmd_1', 'run_command', {
            status: 'succeeded',
            output: '3 passed',
          }),
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:16.000Z' }),

        // Stalled notice
        makeEnvelope(17, {
          type: 'run.stalled',
          idleMs: 5000,
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:17.000Z' }),

        // Non-terminal error
        makeEnvelope(18, {
          type: 'run.error',
          error: {
            code: 'INTERNAL',
            message: 'Temporary network glitch',
            retryable: true,
          },
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:18.000Z' }),

        // Assistant response
        makeEnvelope(19, {
          type: 'message.delta',
          messageId: 'asst_turn_1',
          text: 'Tests ran successfully. ',
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:19.000Z' }),
        makeEnvelope(20, {
          type: 'message.delta',
          messageId: 'asst_turn_1',
          text: 'All 3 test files passed.',
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:20.000Z' }),
        makeEnvelope(21, {
          type: 'message.done',
          messageId: 'asst_turn_1',
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:21.000Z' }),

        // Usage event
        makeEnvelope(22, {
          type: 'usage',
          usage: {
            inputTokens: 500,
            outputTokens: 120,
            thinkingTokens: 60,
            cacheReadTokens: 10,
            totalTokens: 690,
          },
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:22.000Z' }),

        // Run completed
        makeEnvelope(23, {
          type: 'run.completed',
          status: 'completed',
          durationMs: 22000,
          usage: {
            inputTokens: 500,
            outputTokens: 120,
            thinkingTokens: 60,
            cacheReadTokens: 10,
            totalTokens: 690,
          },
          error: null,
          agyConversationId: 'native_conv_123',
        }, { runId: 'run_turn_1', ts: '2026-09-28T10:00:23.000Z' }),
      ];

      const state = reduceAll(envelopes);

      expect(state.items.map((i) => i.kind)).toEqual([
        'user_message',
        'thinking',
        'tool_group',
        'tool',
        'stalled_notice',
        'error',
        'assistant_message',
        'run_divider',
      ]);

      const group = state.items[2] as ToolGroupItem;
      expect(group.tools).toHaveLength(3);
      expect(group.tools[1].subagents).toHaveLength(1);
      expect(group.tools[1].subagents[0].status).toBe('completed');
      expect(group.tools[1].subagents[0].steps).toHaveLength(1);

      const divider = state.items[7] as RunDividerItem;
      expect(divider.status).toBe('completed');
      expect(divider.durationMs).toBe(22000);
      expect(divider.agyConversationId).toBe('native_conv_123');
      expect(state.activeRunId).toBeNull();
      expect(state.lastUsage?.totalTokens).toBe(690);
    });
  });

  describe('run boundaries: stragglers, overlapping runs and interrupted steps', () => {
    const usage = {
      inputTokens: 10,
      outputTokens: 5,
      thinkingTokens: 0,
      cacheReadTokens: 0,
      totalTokens: 15,
    };

    function started(seq: number, runId: string) {
      return makeEnvelope(
        seq,
        { type: 'run.started', runId, model: null, cwd: 'G:/new', checkpointId: null },
        { runId }
      );
    }

    function completed(
      seq: number,
      runId: string,
      status: 'completed' | 'aborted' | 'failed' = 'completed'
    ) {
      return makeEnvelope(
        seq,
        {
          type: 'run.completed',
          status,
          usage: null,
          error: null,
          durationMs: 1000,
          agyConversationId: null,
        },
        { runId }
      );
    }

    it('does not revive activeRunId when events for a finished run arrive after run.completed', () => {
      const state = reduceAll([
        started(1, 'run_a'),
        completed(2, 'run_a'),
        makeEnvelope(3, { type: 'usage', usage }, { runId: 'run_a' }),
        makeEnvelope(
          4,
          { type: 'tool.finished', tool: makeTool('late_tool', 'run_command', { status: 'succeeded' }) },
          { runId: 'run_a' }
        ),
        makeEnvelope(5, { type: 'raw', payload: {} }, { runId: 'run_a' }),
      ]);

      expect(state.activeRunId).toBeNull();
      expect(state.lastSeq).toBe(5);
    });

    it('does not set activeRunId from ordinary events without a run.started', () => {
      const state = reduce(
        undefined,
        makeEnvelope(1, { type: 'message.delta', messageId: 'm', text: 'x' }, { runId: 'run_x' })
      );
      expect(state.activeRunId).toBeNull();
    });

    it('keeps the new run active when a late run.completed for the previous run arrives', () => {
      const state = reduceAll([started(1, 'run_a'), started(2, 'run_b'), completed(3, 'run_a')]);

      expect(state.activeRunId).toBe('run_b');
      const divider = state.items[state.items.length - 1] as RunDividerItem;
      expect(divider.runId).toBe('run_a');
    });

    it('closes open items of the previous run when a new run.started arrives first', () => {
      const state = reduceAll([
        started(1, 'run_a'),
        makeEnvelope(2, { type: 'message.delta', messageId: 'm_a', text: 'partial' }, { runId: 'run_a' }),
        makeEnvelope(3, { type: 'tool.started', tool: makeTool('cmd_a', 'run_command') }, { runId: 'run_a' }),
        started(4, 'run_b'),
        makeEnvelope(5, { type: 'tool.started', tool: makeTool('cmd_b', 'run_command') }, { runId: 'run_b' }),
      ]);

      expect(state.activeRunId).toBe('run_b');
      const msg = state.items[0] as AssistantMessageItem;
      expect(msg.isComplete).toBe(true);
      expect(findTool(state, 'cmd_a')?.tool.status).toBe('failed');
      expect(findTool(state, 'cmd_a')?.tool.error).toMatch(/new run started/);
      expect(findTool(state, 'cmd_b')?.tool.status).toBe('running');
    });

    it('settles running tools, grouped tools, streaming message, thinking and subagents on an aborted run', () => {
      const state = reduceAll([
        started(1, 'run_a'),
        makeEnvelope(2, { type: 'thinking.delta', blockId: 'b1', source: 'stream', text: 'hmm' }, { runId: 'run_a' }),
        makeEnvelope(3, { type: 'message.delta', messageId: 'm1', text: 'Running' }, { runId: 'run_a' }),
        makeEnvelope(4, { type: 'tool.started', tool: makeTool('v1', 'view_file') }, { runId: 'run_a' }),
        makeEnvelope(5, { type: 'tool.started', tool: makeTool('s1', 'search') }, { runId: 'run_a' }),
        makeEnvelope(6, { type: 'tool.started', tool: makeTool('cmd', 'run_command') }, { runId: 'run_a' }),
        makeEnvelope(
          7,
          {
            type: 'subagent.spawned',
            parentToolCallId: 'cmd',
            subagent: {
              conversationId: 'sub_1',
              role: 'r',
              typeName: 't',
              initialPrompt: null,
              status: 'running',
            },
          },
          { runId: 'run_a' }
        ),
        completed(8, 'run_a', 'aborted'),
      ]);

      expect(state.activeRunId).toBeNull();

      const thinking = state.items.find((it) => it.kind === 'thinking') as ThinkingItem;
      expect(thinking.isComplete).toBe(true);

      const msg = state.items.find((it) => it.kind === 'assistant_message') as AssistantMessageItem;
      expect(msg.isComplete).toBe(true);

      const group = state.items.find((it) => it.kind === 'tool_group') as ToolGroupItem;
      expect(group.tools.map((t) => t.tool.status)).toEqual(['failed', 'failed']);

      const cmd = findTool(state, 'cmd')!;
      expect(cmd.tool.status).toBe('failed');
      expect(cmd.tool.error).toMatch(/aborted/);
      expect(cmd.tool.endedAt).not.toBeNull();
      expect(cmd.subagents[0].status).toBe('failed');

      expect(state.items[state.items.length - 1].kind).toBe('run_divider');
    });

    it('marks leftover running tools as succeeded when the run completed normally, and leaves finished tools untouched', () => {
      const finished = makeTool('done', 'run_command', {
        status: 'failed',
        error: 'exit 1',
        endedAt: '2026-09-28T10:00:02.000Z',
      });
      const state = reduceAll([
        started(1, 'run_a'),
        makeEnvelope(2, { type: 'tool.started', tool: makeTool('open', 'run_command') }, { runId: 'run_a' }),
        makeEnvelope(3, { type: 'tool.finished', tool: finished }, { runId: 'run_a' }),
        completed(4, 'run_a', 'completed'),
      ]);

      expect(findTool(state, 'open')?.tool.status).toBe('succeeded');
      expect(findTool(state, 'open')?.tool.error).toBeNull();
      expect(findTool(state, 'done')?.tool).toEqual(finished);
    });

    it('does not touch items of other runs when a run completes', () => {
      const state = reduceAll([
        started(1, 'run_a'),
        started(2, 'run_b'),
        makeEnvelope(3, { type: 'message.delta', messageId: 'm_b', text: 'live' }, { runId: 'run_b' }),
        completed(4, 'run_a', 'failed'),
      ]);

      const msg = state.items.find((it) => it.kind === 'assistant_message') as AssistantMessageItem;
      expect(msg.isComplete).toBe(false);
      expect(state.activeRunId).toBe('run_b');
    });

    it('treats the doubled usage event emitted per result as idempotent', () => {
      const state = reduceAll([
        started(1, 'run_a'),
        makeEnvelope(2, { type: 'usage', usage }, { runId: 'run_a' }),
        makeEnvelope(3, { type: 'usage', usage }, { runId: 'run_a' }),
      ]);
      expect(state.items).toHaveLength(0);
      expect(state.lastUsage).toEqual(usage);
    });
  });

  describe('subagent de-duplication', () => {
    const spawn = (seq: number, parentToolCallId: string | null, status: 'running' | 'completed' = 'running') =>
      makeEnvelope(seq, {
        type: 'subagent.spawned',
        parentToolCallId,
        subagent: {
          conversationId: 'sub_dup',
          role: 'Dependency Analyzer',
          typeName: 'research',
          initialPrompt: 'analyze',
          status,
        },
      });

    const step = (seq: number, stepIndex: number, content: string) =>
      makeEnvelope(seq, {
        type: 'subagent.step',
        conversationId: 'sub_dup',
        step: {
          stepIndex,
          type: 'message',
          status: null,
          createdAt: null,
          content,
          thinking: null,
          toolCalls: [],
          error: null,
        },
      });

    it('merges repeated subagent.spawned for the same conversationId into one card', () => {
      const state = reduceAll([
        makeEnvelope(1, { type: 'tool.started', tool: makeTool('parent', 'subagent') }),
        spawn(2, 'parent'),
        spawn(3, 'parent'),
      ]);

      expect(findTool(state, 'parent')?.subagents).toHaveLength(1);
    });

    it('upserts steps by stepIndex and keeps them ordered', () => {
      const state = reduceAll([
        spawn(1, null),
        step(2, 1, 'second'),
        step(3, 0, 'first'),
        step(4, 1, 'second (replayed)'),
      ]);

      const sub = findSubagent(state, 'sub_dup')!;
      expect(sub.steps.map((s) => s.stepIndex)).toEqual([0, 1]);
      expect(sub.steps[1].content).toBe('second (replayed)');
    });

    it('keeps a subagent.finished that arrives before subagent.spawned, and re-parents the placeholder', () => {
      const state = reduceAll([
        makeEnvelope(1, { type: 'tool.started', tool: makeTool('parent', 'subagent') }),
        makeEnvelope(2, { type: 'subagent.finished', conversationId: 'sub_dup', status: 'completed' }),
        spawn(3, 'parent', 'running'),
      ]);

      expect(state.items.filter((it) => it.kind === 'subagent')).toHaveLength(0);
      const subs = findTool(state, 'parent')!.subagents;
      expect(subs).toHaveLength(1);
      expect(subs[0].status).toBe('completed');
      expect(subs[0].role).toBe('Dependency Analyzer');
    });
  });
});
