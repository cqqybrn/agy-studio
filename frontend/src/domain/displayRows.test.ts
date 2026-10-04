import { describe, expect, it } from 'vitest';
import type { ToolCall, ToolKind } from '@agy-studio/contracts';
import { buildDisplayRows, formatWorkedDuration, type WorkedRow } from './displayRows';
import { prettyFileName, toolGroupLabel, toolLineDelta } from './toolLabels';
import type {
  AssistantMessageItem,
  ThinkingItem,
  TimelineItem,
  ToolGroupItem,
  ToolItem,
  UserMessageItem,
} from './timeline.types';

const T0 = Date.parse('2026-10-01T10:00:00.000Z');
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

function tool(
  id: string,
  kind: ToolKind,
  startSec: number,
  endSec: number | null,
  overrides: Partial<ToolCall> = {},
  runId = 'run-1',
): ToolItem {
  return {
    id: `item-${id}`,
    kind: 'tool',
    type: 'tool',
    toolCallId: id,
    tool: {
      toolCallId: id,
      name: kind,
      kind,
      input: {},
      target: `${id}-target`,
      output: null,
      error: null,
      status: endSec === null ? 'running' : 'succeeded',
      fileChanges: [],
      startedAt: at(startSec),
      endedAt: endSec === null ? null : at(endSec),
      ...overrides,
    },
    subagents: [],
    runId,
    createdAt: at(startSec),
    updatedAt: at(endSec ?? startSec),
  };
}

function assistant(id: string, sec: number, runId = 'run-1'): AssistantMessageItem {
  return {
    id,
    kind: 'assistant_message',
    type: 'assistant_message',
    messageId: id,
    text: `text ${id}`,
    isComplete: true,
    runId,
    createdAt: at(sec),
    updatedAt: at(sec),
  };
}

function user(id: string, sec: number, runId: string | null = 'run-1'): UserMessageItem {
  return {
    id,
    kind: 'user_message',
    type: 'user_message',
    messageId: id,
    text: 'hi',
    attachments: [],
    runId,
    createdAt: at(sec),
  };
}

function thinking(id: string, startSec: number, endSec: number): ThinkingItem {
  return {
    id,
    kind: 'thinking',
    type: 'thinking',
    blockId: id,
    source: 'stream',
    text: 'hmm',
    startedAt: at(startSec),
    endedAt: at(endSec),
    durationMs: (endSec - startSec) * 1000,
    isComplete: true,
    runId: 'run-1',
  };
}

const worked = (rows: ReturnType<typeof buildDisplayRows>) =>
  rows.filter((r): r is WorkedRow => r.kind === 'worked');

describe('buildDisplayRows', () => {
  it('wraps work between messages into Worked blocks and keeps narration top-level', () => {
    const items: TimelineItem[] = [
      user('u1', 0),
      thinking('th1', 1, 3),
      tool('t1', 'run_command', 3, 5),
      assistant('a1', 10),
      tool('t2', 'view_file', 11, 12),
      assistant('a2', 20),
    ];
    const rows = buildDisplayRows(items, { activeRunId: null });

    expect(rows.map((r) => r.kind)).toEqual([
      'user_message',
      'worked',
      'assistant_message',
      'worked',
      'assistant_message',
    ]);
    const [first, second] = worked(rows);
    expect(first.children.map((c) => c.kind)).toEqual(['thinking', 'tool']);
    expect(first.startedAt).toBe(at(1));
    // Block ends when the next narration starts
    expect(first.endedAt).toBe(at(10));
    expect(first.active).toBe(false);
    expect(second.key).toBe('worked-t2');
  });

  it('counts adjacent tools of the same category and breaks the run on a different one', () => {
    const items: TimelineItem[] = [
      tool('c1', 'run_command', 0, 1),
      tool('c2', 'run_command', 1, 2),
      tool('e1', 'edit_file', 2, 3),
      tool('e2', 'write_file', 3, 4),
      tool('c3', 'run_command', 4, 5),
    ];
    const [block] = worked(buildDisplayRows(items, { activeRunId: null }));

    expect(block.children.map((c) => c.kind)).toEqual(['tool_group', 'tool_group', 'tool']);
    const [commands, edits] = block.children;
    expect(commands.kind === 'tool_group' && commands.category).toBe('command');
    expect(commands.kind === 'tool_group' && commands.tools.map((t) => t.toolCallId)).toEqual([
      'c1',
      'c2',
    ]);
    expect(commands.key).toBe('group-c1');
    expect(edits.kind === 'tool_group' && edits.category).toBe('edit');
  });

  it('flattens reducer tool groups so they merge with neighbouring same-category tools', () => {
    const group: ToolGroupItem = {
      id: 'g1',
      kind: 'tool_group',
      type: 'tool_group',
      tools: [tool('v1', 'view_file', 0, 1), tool('v2', 'view_file', 1, 2)],
      runId: 'run-1',
      createdAt: at(0),
      updatedAt: at(2),
    };
    const [block] = worked(
      buildDisplayRows([group, tool('v3', 'view_file', 2, 3)], { activeRunId: null }),
    );
    expect(block.children).toHaveLength(1);
    const only = block.children[0];
    expect(only.kind === 'tool_group' && only.tools.map((t) => t.toolCallId)).toEqual([
      'v1',
      'v2',
      'v3',
    ]);
  });

  it('marks the trailing block of the active run as active with an open end', () => {
    const items = [user('u1', 0), tool('t1', 'run_command', 1, null)];
    const [block] = worked(buildDisplayRows(items, { activeRunId: 'run-1' }));
    expect(block.active).toBe(true);
    expect(block.endedAt).toBeNull();

    const [done] = worked(buildDisplayRows(items, { activeRunId: null }));
    expect(done.active).toBe(false);
    expect(done.endedAt).toBe(at(1));
  });

  it('shows Working… while the active run has streamed nothing yet', () => {
    const rows = buildDisplayRows([user('u1', 0)], { activeRunId: 'run-1' });
    expect(rows.map((r) => r.kind)).toEqual(['user_message', 'worked']);
    const [block] = worked(rows);
    expect(block).toMatchObject({ active: true, endedAt: null, startedAt: at(0), children: [] });
  });

  it('shows Working… after a finished message while the run is still active', () => {
    const rows = buildDisplayRows([user('u1', 0), assistant('a1', 5)], { activeRunId: 'run-1' });
    expect(rows.map((r) => r.kind)).toEqual(['user_message', 'assistant_message', 'worked']);
    expect(worked(rows)[0].startedAt).toBe(at(5));
  });

  it('adds no extra Working… row while a message streams or work is shown', () => {
    const streaming = { ...assistant('a1', 5), isComplete: false };
    expect(worked(buildDisplayRows([user('u1', 0), streaming], { activeRunId: 'run-1' }))).toHaveLength(0);
    const busy = [user('u1', 0), tool('t1', 'run_command', 1, null)];
    expect(worked(buildDisplayRows(busy, { activeRunId: 'run-1' }))).toHaveLength(1);
    expect(worked(buildDisplayRows([user('u1', 0)], { activeRunId: null }))).toHaveLength(0);
  });

  it('does not merge work across runs', () => {
    const items = [
      tool('t1', 'run_command', 0, 1, {}, 'run-1'),
      tool('t2', 'run_command', 2, 3, {}, 'run-2'),
    ];
    expect(worked(buildDisplayRows(items, { activeRunId: null }))).toHaveLength(2);
  });

  it('flags a block containing a failed tool', () => {
    const items = [tool('t1', 'run_command', 0, 1, { status: 'failed', error: 'exit code 1' })];
    expect(worked(buildDisplayRows(items, { activeRunId: null }))[0].failed).toBe(true);
  });

  it('drops hidden thinking without leaving empty blocks', () => {
    const rows = buildDisplayRows([user('u1', 0), thinking('th1', 1, 2), assistant('a1', 3)], {
      activeRunId: null,
      thinkingHidden: true,
    });
    expect(rows.map((r) => r.kind)).toEqual(['user_message', 'assistant_message']);
  });

  it('shows the assistant identity once per run', () => {
    const rows = buildDisplayRows(
      [
        user('u1', 0),
        tool('t1', 'run_command', 1, 2),
        assistant('a1', 3),
        user('u2', 4, 'run-2'),
        assistant('a2', 5, 'run-2'),
        assistant('a3', 6, 'run-2'),
      ],
      { activeRunId: null },
    );
    const identities = rows
      .filter((r) => r.kind === 'worked' || r.kind === 'assistant_message')
      .map((r) => [r.key, (r as { showIdentity: boolean }).showIdentity]);
    expect(identities).toEqual([
      ['worked-t1', true],
      ['a1', false],
      ['a2', true],
      ['a3', false],
    ]);
  });
});

describe('formatWorkedDuration', () => {
  it('uses seconds, then whole minutes, then hours', () => {
    expect(formatWorkedDuration(42_400)).toBe('42s');
    expect(formatWorkedDuration(99_000)).toBe('1m');
    expect(formatWorkedDuration(3_900_000)).toBe('1h 5m');
    expect(formatWorkedDuration(7_200_000)).toBe('2h');
  });
});

describe('toolLabels', () => {
  it('prettifies snake/kebab file names and leaves other names alone', () => {
    expect(prettyFileName('C:\\repo\\fix_name.py')).toBe('Fix Name');
    expect(prettyFileName('/a/b/run-transcript-mapper.test.ts')).toBe('Run Transcript Mapper.test');
    expect(prettyFileName('src/App.tsx')).toBe('App');
  });

  it('pluralises group labels', () => {
    expect(toolGroupLabel('command', 2, false)).toBe('Ran 2 commands');
    expect(toolGroupLabel('view', 1, true)).toBe('Reading 1 file');
  });

  it('sums line deltas only when reported', () => {
    const base = tool('e1', 'edit_file', 0, 1).tool;
    expect(toolLineDelta(base)).toBeNull();
    expect(
      toolLineDelta({
        ...base,
        fileChanges: [
          { path: 'a', changeType: 'modified', additions: 3, deletions: 1 },
          { path: 'b', changeType: 'created', additions: 5, deletions: null },
        ],
      }),
    ).toEqual({ additions: 8, deletions: 1 });
  });
});
