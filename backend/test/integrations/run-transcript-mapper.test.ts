import path from 'node:path';
import type { AgentEvent, TranscriptStep } from '@agy-studio/contracts';
import { describe, expect, it } from 'vitest';
import { loadProfile } from '../../src/integrations/agy/profile/loader.js';
import { parseLine, RunTranscriptMapper, stripResultHeader } from '../../src/integrations/agy/transcript.js';

const PROFILE = loadProfile(path.resolve(__dirname, '../../agy-profile.json'));
const RUN_ID = 'run-1';

function step(raw: Record<string, unknown>): TranscriptStep {
  const parsed = parseLine(JSON.stringify(raw));
  if (!parsed) throw new Error('unparseable step');
  return parsed;
}

function pushAll(mapper: RunTranscriptMapper, steps: Record<string, unknown>[]): AgentEvent[] {
  return steps.flatMap((s) => mapper.push(step(s)));
}

describe('RunTranscriptMapper', () => {
  const runStartedAt = '2026-10-01T08:00:00.400Z';

  it('ignores earlier turns until this run\'s USER_INPUT (second precision)', () => {
    const mapper = new RunTranscriptMapper({ runId: RUN_ID, runStartedAt, profile: PROFILE });
    const events = pushAll(mapper, [
      { step_index: 0, type: 'USER_INPUT', created_at: '2026-10-01T07:00:00Z', content: 'old' },
      { step_index: 1, type: 'PLANNER_RESPONSE', created_at: '2026-10-01T07:00:01Z', content: 'old answer' },
      { step_index: 2, type: 'USER_INPUT', created_at: '2026-10-01T08:00:00Z', content: 'new' },
      { step_index: 3, type: 'PLANNER_RESPONSE', created_at: '2026-10-01T08:00:02Z', content: 'I will connect.' },
    ]);
    expect(events).toEqual([
      { type: 'message.delta', messageId: `msg-${RUN_ID}-3`, text: 'I will connect.' },
      { type: 'message.done', messageId: `msg-${RUN_ID}-3` },
    ]);
  });

  it('pairs tool_calls with GENERIC results, decodes double-encoded args and drops transcript-only keys', () => {
    const mapper = new RunTranscriptMapper({ runId: RUN_ID, runStartedAt, profile: PROFILE });
    const events = pushAll(mapper, [
      { step_index: 10, type: 'USER_INPUT', created_at: '2026-10-01T08:00:01Z', content: 'go' },
      {
        step_index: 11,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-10-01T08:00:02Z',
        content: '',
        thinking: 'internal reasoning',
        tool_calls: [
          {
            name: 'run_command',
            args: { CommandLine: '"ssh root@host"', toolAction: '"Connecting"', toolSummary: '"ssh"' },
          },
        ],
      },
      { step_index: 12, type: 'GENERIC', status: 'RUNNING', created_at: '2026-10-01T08:00:03Z', content: '' },
    ]);

    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.type).toBe('tool.started');
    if (event.type !== 'tool.started') return;
    expect(event.tool).toMatchObject({
      toolCallId: `tool-${RUN_ID}-12`,
      name: 'run_command',
      kind: 'run_command',
      input: { CommandLine: 'ssh root@host' },
      status: 'running',
      endedAt: null,
    });
  });

  it('finishes a background tool from the SYSTEM_MESSAGE that reports its task result', () => {
    const conv = '4eb82d13-cecd-4a86-b350-b88d21ceb3c4';
    const systemMessage = (task: number, body: string) =>
      'The following is a <SYSTEM_MESSAGE> not actually sent by the user.\n\n<SYSTEM_MESSAGE>\n' +
      `[Message] timestamp=2026-10-01T00:52:15Z sender=${conv}/task-${task} priority=MESSAGE_PRIORITY_HIGH ` +
      `content=Task id "${conv}/task-${task}" finished with result:\n\n${body}\n\n` +
      `Log: file:///C:/brain/${conv}/.system_generated/tasks/task-${task}.log\n</SYSTEM_MESSAGE>`;

    const mapper = new RunTranscriptMapper({ runId: RUN_ID, runStartedAt, profile: PROFILE });
    const events = pushAll(mapper, [
      { step_index: 0, type: 'USER_INPUT', created_at: '2026-10-01T08:00:01Z', content: 'go' },
      {
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-10-01T08:00:02Z',
        tool_calls: [{ name: 'run_command', args: { CommandLine: '"ssh root@host"' } }],
      },
      {
        step_index: 2,
        type: 'GENERIC',
        status: 'RUNNING',
        created_at: '2026-10-01T08:00:03Z',
        content: `Tool is running as a background task with task id: ${conv}/task-2`,
      },
      {
        step_index: 3,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-10-01T08:00:04Z',
        tool_calls: [{ name: 'run_command', args: { CommandLine: '"Get-Command ssh"' } }],
      },
      { step_index: 4, type: 'GENERIC', status: 'RUNNING', created_at: '2026-10-01T08:00:05Z', content: 'bg' },
      {
        step_index: 5,
        type: 'SYSTEM_MESSAGE',
        created_at: '2026-10-01T08:00:09Z',
        content: systemMessage(4, 'The command exited with code 0.\nOutput:\r\nssh.exe C:\\Windows\\System32\\OpenSSH\\ssh.exe\r\n'),
      },
      {
        step_index: 6,
        type: 'SYSTEM_MESSAGE',
        created_at: '2026-10-01T08:03:00Z',
        content: systemMessage(2, 'The command exited with code 1.\nStdout:\n\nStderr:\n'),
      },
      { step_index: 7, type: 'SYSTEM_MESSAGE', created_at: '2026-10-01T08:03:01Z', content: systemMessage(2, 'again') },
    ]);

    expect(events.map((e) => e.type)).toEqual(['tool.started', 'tool.started', 'tool.finished', 'tool.finished']);
    const [, , ok, failed] = events;
    if (ok.type !== 'tool.finished' || failed.type !== 'tool.finished') return;
    expect(ok.tool).toMatchObject({
      toolCallId: `tool-${RUN_ID}-4`,
      input: { CommandLine: 'Get-Command ssh' },
      output: 'ssh.exe C:\\Windows\\System32\\OpenSSH\\ssh.exe',
      status: 'succeeded',
      error: null,
      endedAt: '2026-10-01T08:00:09Z',
    });
    expect(failed.tool).toMatchObject({
      toolCallId: `tool-${RUN_ID}-2`,
      status: 'failed',
      error: 'exit code 1',
    });
    expect(failed.tool.output).toMatch(/^Stdout:/);
  });

  it('maps finished and failed results to tool.finished', () => {
    const mapper = new RunTranscriptMapper({ runId: RUN_ID, runStartedAt, profile: PROFILE });
    const events = pushAll(mapper, [
      { step_index: 0, type: 'USER_INPUT', created_at: '2026-10-01T08:00:01Z', content: 'go' },
      {
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-10-01T08:00:02Z',
        tool_calls: [
          { name: 'run_command', args: { CommandLine: '"echo ok"' } },
          { name: 'run_command', args: { CommandLine: '"false"' } },
        ],
      },
      { step_index: 2, type: 'GENERIC', status: 'DONE', created_at: '2026-10-01T08:00:03Z', content: 'ok' },
      {
        step_index: 3,
        type: 'GENERIC',
        status: 'DONE',
        created_at: '2026-10-01T08:00:04Z',
        error: { message: 'exit code 1' },
      },
      { step_index: 4, type: 'GENERIC', status: 'DONE', created_at: '2026-10-01T08:00:05Z', content: 'orphan' },
    ]);

    expect(events.map((e) => e.type)).toEqual(['tool.finished', 'tool.finished']);
    const [first, second] = events;
    if (first.type !== 'tool.finished' || second.type !== 'tool.finished') return;
    expect(first.tool).toMatchObject({
      toolCallId: `tool-${RUN_ID}-2`,
      input: { CommandLine: 'echo ok' },
      output: 'ok',
      status: 'succeeded',
    });
    expect(second.tool).toMatchObject({
      toolCallId: `tool-${RUN_ID}-3`,
      input: { CommandLine: 'false' },
      error: 'exit code 1',
      status: 'failed',
    });
  });
});

describe('stripResultHeader', () => {
  it('drops the Created At / Completed At lines agy puts before a result', () => {
    expect(
      stripResultHeader('Created At: 2026-10-06T16:41:16+09:00\nCompleted At: 2026-10-06T16:41:20+09:00\nThe search returned **0.0063 USD**.'),
    ).toBe('The search returned **0.0063 USD**.');
    expect(stripResultHeader('plain output')).toBe('plain output');
    expect(stripResultHeader('Created At: x\n')).toBeNull();
    expect(stripResultHeader(null)).toBeNull();
  });
});
