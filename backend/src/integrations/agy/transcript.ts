import type {
  AgentEvent,
  ISODateString,
  ToolCall,
  TranscriptStep,
  TranscriptToolCall,
} from '@agy-studio/contracts';
import path from 'node:path';
import { isUuid } from '../../utils/ids.js';
import { JsonlTail } from '../../utils/jsonl-tail.js';
import {
  getDefaultPaths,
  resolveTranscriptPath as resolveTranscriptPathFromProfile,
  type PathResolveOptions,
} from './paths.js';
import type { AgyProfile, PathsConfig } from './profile/schema.js';
import {
  extractFileChanges,
  extractToolTarget,
  resolveToolKind,
  stepMessageId,
  stepToolCallId,
} from './stream-adapter.js';

export { expandPathTokens } from './paths.js';

export interface TailOptions {
  fromStep?: number;
  homeDir?: string;
  dataRoot?: string;
  transcriptPath?: string;
  pollIntervalMs?: number;
}

export interface TailHandle extends AsyncIterable<TranscriptStep> {
  steps: AsyncIterable<TranscriptStep>;
  stop(): void;
  [Symbol.asyncIterator](): AsyncIterator<TranscriptStep>;
}

/**
 * Resolves the absolute path to a conversation's transcript file from profile.paths.
 */
export function resolveTranscriptPath(
  conversationId: string,
  options?: PathResolveOptions,
  pathsConfig?: PathsConfig,
): string {
  return resolveTranscriptPathFromProfile(conversationId, options, pathsConfig ?? getDefaultPaths());
}

/**
 * Parses a single JSON line into a TranscriptStep, returning null if invalid.
 */
export function parseLine(line: string): TranscriptStep | null {
  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- walks untyped agy transcript JSON
  let raw: Record<string, any>;
  try {
    const parsed = JSON.parse(trimmed);
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    raw = parsed;
  } catch {
    return null;
  }

  // 1. stepIndex
  let stepIndex = 0;
  if (typeof raw.stepIndex === 'number') {
    stepIndex = raw.stepIndex;
  } else if (typeof raw.step_index === 'number') {
    stepIndex = raw.step_index;
  } else if (typeof raw.index === 'number') {
    stepIndex = raw.index;
  }

  // 2. type
  let type = 'unknown';
  if (typeof raw.type === 'string') {
    type = raw.type;
  } else if (typeof raw.step_type === 'string') {
    type = raw.step_type;
  } else if (typeof raw.kind === 'string') {
    type = raw.kind;
  } else if (raw.context_kind === 'CONTEXT_KIND_MODEL_THOUGHT') {
    type = 'thought';
  }

  // 3. status
  let status: string | null = null;
  if (typeof raw.status === 'string') {
    status = raw.status;
  } else if (typeof raw.state === 'string') {
    status = raw.state;
  }

  // 4. createdAt
  let createdAt: ISODateString | null = null;
  if (typeof raw.createdAt === 'string') {
    createdAt = raw.createdAt;
  } else if (typeof raw.timestamp === 'string') {
    createdAt = raw.timestamp;
  } else if (typeof raw.created_at === 'string') {
    createdAt = raw.created_at;
  } else if (typeof raw.ts === 'string') {
    createdAt = raw.ts;
  }

  // 5. content
  let content: string | null = null;
  if (typeof raw.content === 'string') {
    content = raw.content;
  } else if (typeof raw.text === 'string') {
    content = raw.text;
  } else if (typeof raw.text_delta === 'string') {
    content = raw.text_delta;
  } else if (typeof raw.message === 'string') {
    content = raw.message;
  } else if (raw.message && typeof raw.message === 'object' && typeof raw.message.content === 'string') {
    content = raw.message.content;
  } else if (raw.content && typeof raw.content === 'object' && typeof raw.content.text === 'string') {
    content = raw.content.text;
  } else if (Array.isArray(raw.content)) {
    const texts = raw.content
      .filter(
        (c: unknown): c is { text: string } =>
          !!c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string',
      )
      .map((c: { text: string }) => c.text);
    if (texts.length > 0) {
      content = texts.join('\n');
    }
  }

  // 6. thinking
  let thinking: string | null = null;
  if (typeof raw.thinking === 'string') {
    thinking = raw.thinking;
  } else if (typeof raw.thought === 'string') {
    thinking = raw.thought;
  } else if (
    type === 'thought' ||
    type === 'thinking' ||
    raw.context_kind === 'CONTEXT_KIND_MODEL_THOUGHT'
  ) {
    thinking = content;
  }

  // 7. toolCalls
  const toolCalls: TranscriptToolCall[] = [];
  if (Array.isArray(raw.toolCalls)) {
    for (const tc of raw.toolCalls) {
      if (tc && typeof tc === 'object' && typeof tc.name === 'string') {
        toolCalls.push({
          name: tc.name,
          args: (tc.args && typeof tc.args === 'object' ? tc.args : {}) as Record<string, unknown>,
        });
      }
    }
  } else if (Array.isArray(raw.tool_calls)) {
    for (const tc of raw.tool_calls) {
      if (tc && typeof tc === 'object') {
        const name = tc.name ?? tc.function?.name ?? 'unknown';
        let args: Record<string, unknown> = {};
        if (tc.args && typeof tc.args === 'object') {
          args = tc.args;
        } else if (tc.function?.arguments) {
          if (typeof tc.function.arguments === 'string') {
            try {
              args = JSON.parse(tc.function.arguments);
            } catch {
              args = { raw: tc.function.arguments };
            }
          } else if (typeof tc.function.arguments === 'object') {
            args = tc.function.arguments;
          }
        }
        toolCalls.push({ name, args });
      }
    }
  } else if (typeof raw.tool_name === 'string') {
    const args = (raw.tool_info?.parameters ?? raw.tool_parameters ?? raw.args ?? {}) as Record<string, unknown>;
    toolCalls.push({
      name: raw.tool_name,
      args: typeof args === 'object' && args !== null ? args : {},
    });
  }

  // 8. error
  let error: string | null = null;
  if (typeof raw.error === 'string') {
    error = raw.error;
  } else if (raw.error && typeof raw.error === 'object') {
    error = raw.error.message ? String(raw.error.message) : JSON.stringify(raw.error);
  }

  return {
    stepIndex,
    type,
    status,
    createdAt,
    content,
    thinking,
    toolCalls,
    error,
  };
}

function pushSubagentConversationIds(subagents: unknown, out: string[]): void {
  let list = subagents;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      return;
    }
  }
  if (!Array.isArray(list)) return;
  for (const sa of list) {
    const id = sa && typeof sa === 'object' ? (sa as { conversation_id?: unknown }).conversation_id : undefined;
    if (typeof id === 'string') {
      out.push(id);
    }
  }
}

/**
 * Collects subagent conversation IDs spawned by a conversation, reading only subagent fields
 * (subagent_info.subagents[].conversation_id, or invoke_subagent args Subagents[].conversation_id).
 * Accepts transcript lines as well as stream-json lines wrapping the step in `step_update`.
 * UUIDs that merely appear in message text are never returned.
 */
export function extractSubagentConversationIds(text: string): string[] {
  const ids: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- walks untyped agy step JSON
    let raw: any;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!raw || typeof raw !== 'object') continue;
    const step = raw.step_update && typeof raw.step_update === 'object' ? raw.step_update : raw;

    pushSubagentConversationIds(step.subagent_info?.subagents, ids);

    const toolInfo = step.tool_info;
    const isInvokeSubagent =
      step.tool_name === 'invoke_subagent' || toolInfo?.name === 'invoke_subagent';
    if (isInvokeSubagent && toolInfo && typeof toolInfo === 'object') {
      const args = toolInfo.args ?? toolInfo.arguments ?? toolInfo.parameters ?? toolInfo.input;
      if (args && typeof args === 'object') {
        pushSubagentConversationIds(args.Subagents ?? args.subagents ?? args.agents, ids);
      }
    }
  }
  return [...new Set(ids.filter((id) => isUuid(id)))];
}

/**
 * Converts a TranscriptStep into unified AgentEvent(s).
 * - role: 'main' with thinking -> thinking.delta(source='transcript')
 * - role: 'subagent' -> subagent.step
 */
export function toEvents(
  step: TranscriptStep,
  role: 'main' | 'subagent',
  conversationId: string,
): AgentEvent[] {
  if (role === 'subagent') {
    return [
      {
        type: 'subagent.step',
        conversationId,
        step,
      },
    ];
  }

  if (step.thinking && step.thinking.length > 0) {
    return [
      {
        type: 'thinking.delta',
        blockId: `thinking-${conversationId}-${step.stepIndex}`,
        source: 'transcript',
        text: step.thinking,
      },
    ];
  }

  return [];
}

/**
 * GENERIC result steps start with "Created At: …" / "Completed At: …" lines (agy 1.2.16); the
 * result itself follows. Returns null for an empty result.
 */
export function stripResultHeader(content: string | null | undefined): string | null {
  if (!content) return null;
  const body = content.replace(/^(?:(?:Created|Completed) At: [^\n]*\n)+/, '').trim();
  return body.length > 0 ? body : null;
}

/** Bookkeeping keys agy adds to every tool call; stdout tool parameters never contain them. */
const TRANSCRIPT_ONLY_ARG_KEYS = new Set(['toolAction', 'toolSummary']);

/**
 * transcript.jsonl stores string arguments JSON-encoded a second time (`"\"npm test\""`),
 * while transcript_full.jsonl and stdout do not.
 */
function decodeTranscriptArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    if (TRANSCRIPT_ONLY_ARG_KEYS.has(key)) continue;
    if (typeof value === 'string' && value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      try {
        const decoded: unknown = JSON.parse(value);
        out[key] = typeof decoded === 'string' ? decoded : value;
        continue;
      } catch {
        // not an encoded string; keep as is
      }
    }
    out[key] = value;
  }
  return out;
}

function floorToSecond(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : Math.floor(ms / 1000) * 1000;
}

export interface RunTranscriptMapperOptions {
  runId: string;
  /** Steps from earlier turns of a resumed conversation precede this run's USER_INPUT. */
  runStartedAt: ISODateString;
  profile?: AgyProfile;
}

/**
 * Maps a main conversation's transcript steps for one run into the same message / tool events
 * the stdout adapter produces, with identical ids (both use agy's conversation-wide step index).
 *
 * - PLANNER_RESPONSE with content → message.delta (full text) + message.done
 * - PLANNER_RESPONSE tool_calls are paired, in order, with the GENERIC result steps that follow;
 *   a RUNNING result → tool.started, any other status → tool.finished
 * - A background tool's GENERIC step stays RUNNING; its result arrives later as a SYSTEM_MESSAGE
 *   matching `profile.transcript.taskResultPattern` → tool.finished for that step
 * - Thinking, user input and other system messages produce nothing.
 */
export class RunTranscriptMapper {
  private readonly runId: string;
  private readonly runStartMs: number;
  private readonly profile?: AgyProfile;
  private readonly taskResultPattern: RegExp | null;
  private started = false;
  private pendingCalls: TranscriptToolCall[] = [];
  /** step index → tool still running in the background */
  private readonly runningTools = new Map<number, ToolCall>();

  constructor(options: RunTranscriptMapperOptions) {
    this.runId = options.runId;
    this.runStartMs = floorToSecond(options.runStartedAt);
    this.profile = options.profile;
    const pattern = options.profile?.transcript?.taskResultPattern;
    this.taskResultPattern = pattern ? new RegExp(pattern) : null;
  }

  push(step: TranscriptStep): AgentEvent[] {
    const type = step.type.toUpperCase();

    if (!this.started) {
      if (type === 'USER_INPUT' && step.createdAt && floorToSecond(step.createdAt) >= this.runStartMs) {
        this.started = true;
      }
      return [];
    }

    if (type === 'PLANNER_RESPONSE') {
      this.pendingCalls = [...step.toolCalls];
      const text = step.content ?? '';
      if (text.trim().length === 0) return [];
      const messageId = stepMessageId(this.runId, step.stepIndex);
      return [
        { type: 'message.delta', messageId, text },
        { type: 'message.done', messageId },
      ];
    }

    if (type === 'GENERIC') {
      const call = this.pendingCalls.shift();
      if (!call) return [];
      const event = this.toToolEvent(step, call);
      if (event.type === 'tool.started') this.runningTools.set(step.stepIndex, event.tool);
      return [event];
    }

    if (type === 'SYSTEM_MESSAGE') {
      return this.toBackgroundResult(step);
    }

    return [];
  }

  private toBackgroundResult(step: TranscriptStep): AgentEvent[] {
    if (!this.taskResultPattern || !step.content) return [];
    const groups = this.taskResultPattern.exec(step.content)?.groups;
    if (!groups?.step) return [];
    const stepIndex = Number(groups.step);
    const started = this.runningTools.get(stepIndex);
    if (!started) return [];
    this.runningTools.delete(stepIndex);

    const exitCode = groups.exitCode === undefined ? null : Number(groups.exitCode);
    const failed = exitCode !== null && exitCode !== 0;
    const output = groups.output?.trim() ?? '';
    return [
      {
        type: 'tool.finished',
        tool: {
          ...started,
          output: output.length > 0 ? output : null,
          error: failed ? `exit code ${exitCode}` : null,
          status: failed ? 'failed' : 'succeeded',
          endedAt: step.createdAt ?? new Date().toISOString(),
        },
      },
    ];
  }

  private toToolEvent(step: TranscriptStep, call: TranscriptToolCall): AgentEvent {
    const input = decodeTranscriptArgs(call.args);
    const kind = resolveToolKind(call.name, this.profile);
    const ts = step.createdAt ?? new Date().toISOString();
    const running = (step.status ?? '').toUpperCase() === 'RUNNING';
    const tool: ToolCall = {
      toolCallId: stepToolCallId(this.runId, step.stepIndex),
      name: call.name,
      kind,
      input,
      target: extractToolTarget(kind, input),
      output: stripResultHeader(step.content),
      error: step.error,
      status: running ? 'running' : step.error ? 'failed' : 'succeeded',
      fileChanges: extractFileChanges(call.name, kind, input),
      startedAt: ts,
      endedAt: running ? null : ts,
    };
    return running ? { type: 'tool.started', tool } : { type: 'tool.finished', tool };
  }
}

/**
 * Tails a conversation's transcript file incrementally.
 * Polls every 300ms if file does not exist or has no new lines.
 * Deduplicates by stepIndex. Calling stop() releases all resources immediately.
 */
export function tail(
  conversationIdOrPath: string,
  options?: TailOptions,
  pathsConfig?: PathsConfig,
): TailHandle {
  const pollIntervalMs = options?.pollIntervalMs ?? 300;
  const fromStep = options?.fromStep ?? 0;

  let targetPath: string;
  if (options?.transcriptPath) {
    targetPath = options.transcriptPath;
  } else if (
    conversationIdOrPath.endsWith('.jsonl') ||
    path.isAbsolute(conversationIdOrPath)
  ) {
    targetPath = conversationIdOrPath;
  } else {
    targetPath = resolveTranscriptPath(conversationIdOrPath, options, pathsConfig);
  }

  const jsonlTail = new JsonlTail(targetPath, 0);
  const seenStepIndices = new Set<number>();
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let wakeUp: (() => void) | null = null;

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (wakeUp !== null) {
      const fn = wakeUp;
      wakeUp = null;
      fn();
    }
  }

  async function* iterate(): AsyncGenerator<TranscriptStep, void, unknown> {
    try {
      while (!stopped) {
        let lines: string[] = [];
        try {
          const res = await jsonlTail.read();
          lines = res.lines;
        } catch {
          // Ignore transient read errors
        }

        for (const line of lines) {
          if (stopped) break;
          const step = parseLine(line);
          if (step !== null) {
            if (step.stepIndex >= fromStep && !seenStepIndices.has(step.stepIndex)) {
              seenStepIndices.add(step.stepIndex);
              yield step;
            }
          }
        }

        if (stopped) break;

        // Wait for poll interval or early wakeup on stop()
        await new Promise<void>((resolve) => {
          wakeUp = resolve;
          timer = setTimeout(() => {
            timer = null;
            wakeUp = null;
            resolve();
          }, pollIntervalMs);
        });
      }
    } finally {
      stop();
    }
  }

  const generator = iterate();

  const handle: TailHandle = {
    get steps() {
      return this;
    },
    stop,
    [Symbol.asyncIterator]() {
      return generator;
    },
  };

  return handle;
}
