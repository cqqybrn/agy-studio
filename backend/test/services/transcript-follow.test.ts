import type { AgentEvent, ToolCall } from '@agy-studio/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrainPort, RunTranscriptHandle } from '../../src/services/ports/brain.port.js';
import { TranscriptFollowService } from '../../src/services/transcript-follow.js';

const SESSION_ID = 'session-1';
const RUN_ID = 'run-1';
const CONV_ID = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';

/** A transcript handle whose batches are pushed by the test. */
function controllableHandle() {
  const queue: AgentEvent[][] = [];
  let wake: (() => void) | null = null;
  let stopped = false;

  async function* batches(): AsyncGenerator<AgentEvent[], void, unknown> {
    while (!stopped) {
      const next = queue.shift();
      if (next) {
        yield next;
        continue;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  }

  const handle: RunTranscriptHandle = {
    batches: batches(),
    stop: vi.fn(() => {
      stopped = true;
      wake?.();
    }),
  };

  return {
    handle,
    push(batch: AgentEvent[]) {
      queue.push(batch);
      const fn = wake;
      wake = null;
      fn?.();
    },
  };
}

function tool(id: string, status: ToolCall['status']): ToolCall {
  return {
    toolCallId: id,
    name: 'run_command',
    kind: 'run_command',
    input: { CommandLine: 'ssh root@host' },
    target: 'ssh root@host',
    output: null,
    error: null,
    fileChanges: [],
    status,
    startedAt: '2026-10-01T08:00:00.000Z',
    endedAt: status === 'running' ? null : '2026-10-01T08:00:01.000Z',
  };
}

describe('TranscriptFollowService', () => {
  let published: AgentEvent[];
  let activity: string[];
  let transcript: ReturnType<typeof controllableHandle>;
  let followRunTranscript: ReturnType<typeof vi.fn>;
  let conversationId: string | null;
  let service: TranscriptFollowService;

  beforeEach(() => {
    vi.useFakeTimers();
    published = [];
    activity = [];
    transcript = controllableHandle();
    followRunTranscript = vi.fn(async () => transcript.handle);
    conversationId = CONV_ID;
    service = new TranscriptFollowService({
      brainPort: { followRunTranscript } as unknown as BrainPort,
      sessionsRepo: {
        findById: () => ({ agyConversationId: conversationId }) as never,
      },
      publish: async (_sessionId, _runId, event) => {
        published.push(event);
      },
      onActivity: (runId) => activity.push(runId),
      graceMs: 3000,
      conversationPollMs: 1000,
    });
  });

  afterEach(() => {
    service.dispose();
    vi.useRealTimers();
  });

  async function startRun(): Promise<void> {
    expect(service.filterStreamEvent(SESSION_ID, RUN_ID, { type: 'run.started', runId: RUN_ID } as AgentEvent)).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
  }

  it('publishes transcript steps after the grace period when stdout is held back, and reports activity', async () => {
    await startRun();
    expect(followRunTranscript).toHaveBeenCalledWith(CONV_ID, expect.objectContaining({ runId: RUN_ID }));

    transcript.push([
      { type: 'message.delta', messageId: 'msg-run-1-3', text: 'I will connect.' },
      { type: 'message.done', messageId: 'msg-run-1-3' },
      { type: 'tool.started', tool: tool('tool-run-1-4', 'running') },
    ]);
    transcript.push([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(activity).toEqual([RUN_ID, RUN_ID]);
    expect(published).toEqual([]);

    await vi.advanceTimersByTimeAsync(3000);
    expect(published.map((e) => e.type)).toEqual(['message.delta', 'message.done', 'tool.started']);

    // stdout catches up later: the message must not be appended again, the tool may still finish
    expect(service.filterStreamEvent(SESSION_ID, RUN_ID, { type: 'message.delta', messageId: 'msg-run-1-3', text: 'I will' })).toBe(false);
    expect(service.filterStreamEvent(SESSION_ID, RUN_ID, { type: 'message.done', messageId: 'msg-run-1-3' })).toBe(false);
    expect(service.filterStreamEvent(SESSION_ID, RUN_ID, { type: 'tool.started', tool: tool('tool-run-1-4', 'running') })).toBe(true);
    expect(service.filterStreamEvent(SESSION_ID, RUN_ID, { type: 'tool.finished', tool: tool('tool-run-1-4', 'succeeded') })).toBe(true);
  });

  it('skips transcript events that stdout already delivered within the grace period', async () => {
    await startRun();
    transcript.push([
      { type: 'message.delta', messageId: 'msg-run-1-3', text: 'Hello' },
      { type: 'message.done', messageId: 'msg-run-1-3' },
      { type: 'tool.finished', tool: tool('tool-run-1-4', 'succeeded') },
    ]);
    await vi.advanceTimersByTimeAsync(0);

    expect(service.filterStreamEvent(SESSION_ID, RUN_ID, { type: 'message.delta', messageId: 'msg-run-1-3', text: 'Hel' })).toBe(true);
    expect(service.filterStreamEvent(SESSION_ID, RUN_ID, { type: 'message.delta', messageId: 'msg-run-1-3', text: 'lo' })).toBe(true);
    expect(service.filterStreamEvent(SESSION_ID, RUN_ID, { type: 'tool.finished', tool: tool('tool-run-1-4', 'succeeded') })).toBe(true);

    await vi.advanceTimersByTimeAsync(3000);
    expect(published).toEqual([]);
  });

  it('does not move a tool finished from the transcript back to running', async () => {
    await startRun();
    transcript.push([{ type: 'tool.finished', tool: tool('tool-run-1-4', 'succeeded') }]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(published.map((e) => e.type)).toEqual(['tool.finished']);

    expect(service.filterStreamEvent(SESSION_ID, RUN_ID, { type: 'tool.started', tool: tool('tool-run-1-4', 'running') })).toBe(false);
  });

  it('fills in the result of a tool that stdout finished without output (search_web)', async () => {
    await startRun();
    const search = { ...tool('tool-run-1-2', 'succeeded'), name: 'search_web', kind: 'search' as const };
    expect(service.filterStreamEvent(SESSION_ID, RUN_ID, { type: 'tool.finished', tool: search })).toBe(true);

    transcript.push([{ type: 'tool.finished', tool: { ...search, output: 'Tokyo has 14 million people.' } }]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(published).toEqual([
      { type: 'tool.updated', toolCallId: 'tool-run-1-2', patch: { output: 'Tokyo has 14 million people.' } },
    ]);
  });

  it('leaves the output alone when stdout already had one', async () => {
    await startRun();
    const viewed = { ...tool('tool-run-1-2', 'succeeded'), output: '330 lines' };
    expect(service.filterStreamEvent(SESSION_ID, RUN_ID, { type: 'tool.finished', tool: viewed })).toBe(true);
    transcript.push([{ type: 'tool.finished', tool: { ...viewed, output: 'full file text' } }]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(published).toEqual([]);
  });

  it('drops an output-less stdout finish for a tool the transcript already finished with a result', async () => {
    await startRun();
    transcript.push([{ type: 'tool.finished', tool: { ...tool('tool-run-1-2', 'succeeded'), output: 'result' } }]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(published.map((e) => e.type)).toEqual(['tool.finished']);

    expect(service.filterStreamEvent(SESSION_ID, RUN_ID, { type: 'tool.finished', tool: tool('tool-run-1-2', 'succeeded') })).toBe(false);
    expect(
      service.filterStreamEvent(SESSION_ID, RUN_ID, { type: 'tool.finished', tool: { ...tool('tool-run-1-2', 'succeeded'), output: 'x' } }),
    ).toBe(true);
  });

  it('waits for the conversation id of a new session before following', async () => {
    conversationId = null;
    await startRun();
    expect(followRunTranscript).not.toHaveBeenCalled();

    conversationId = CONV_ID;
    await vi.advanceTimersByTimeAsync(1000);
    expect(followRunTranscript).toHaveBeenCalledTimes(1);
  });

  it('stops following and drops pending events when the run completes', async () => {
    await startRun();
    transcript.push([{ type: 'tool.started', tool: tool('tool-run-1-4', 'running') }]);
    await vi.advanceTimersByTimeAsync(0);

    service.filterStreamEvent(SESSION_ID, RUN_ID, {
      type: 'run.completed',
      status: 'completed',
      usage: null,
      error: null,
      durationMs: 0,
      agyConversationId: null,
    });
    expect(transcript.handle.stop).toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(3000);
    expect(published).toEqual([]);
  });
});
