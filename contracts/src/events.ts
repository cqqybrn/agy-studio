import type {
  Attachment,
  ISODateString,
  Run,
  RunStatus,
  Session,
  SubagentInfo,
  SubagentStatus,
  TerminalRunStatus,
  TokenUsage,
  ToolCall,
  TranscriptStep,
  QuotaSnapshot,
  WhoAmI,
} from './domain';
import type { ApiErrorBody } from './errors';

/**
 * Session-scoped events. Persisted in order and replayable by `seq`.
 * Invariant: every run emits exactly one `run.started` and exactly one `run.completed`.
 */
export type AgentEvent =
  | {
      type: 'run.started';
      runId: string;
      model: string | null;
      cwd: string;
    }
  | {
      type: 'user.message';
      messageId: string;
      text: string;
      attachments: Attachment[];
    }
  | {
      type: 'thinking.delta';
      blockId: string;
      source: 'stream' | 'transcript';
      text: string;
    }
  | { type: 'thinking.done'; blockId: string; durationMs: number | null }
  | { type: 'message.delta'; messageId: string; text: string }
  | { type: 'message.done'; messageId: string }
  | { type: 'tool.started'; tool: ToolCall }
  | { type: 'tool.updated'; toolCallId: string; patch: Partial<ToolCall> }
  | { type: 'tool.finished'; tool: ToolCall }
  | { type: 'subagent.spawned'; parentToolCallId: string | null; subagent: SubagentInfo }
  | { type: 'subagent.step'; conversationId: string; step: TranscriptStep }
  | { type: 'subagent.finished'; conversationId: string; status: SubagentStatus }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'autoapprove.injected'; layer: 'settings' | 'permission_event' | 'watchdog'; detail: string }
  | { type: 'run.stalled'; idleMs: number }
  /** Non-terminal: the run continues after this. */
  | { type: 'run.error'; error: ApiErrorBody }
  | {
      type: 'run.completed';
      status: TerminalRunStatus;
      usage: TokenUsage | null;
      error: ApiErrorBody | null;
      durationMs: number;
      agyConversationId: string | null;
    }
  /** Unrecognised agy output, forwarded so a CLI upgrade never breaks the stream. */
  | { type: 'raw'; payload: unknown };

export type AgentEventType = AgentEvent['type'];

export interface SessionEventEnvelope {
  /** Per-session monotonic sequence, starting at 1. Gaps are not allowed. */
  seq: number;
  sessionId: string;
  runId: string | null;
  ts: ISODateString;
  event: AgentEvent;
}

/** Process-wide events; not persisted, not replayed. */
export type GlobalEvent =
  | { type: 'session.upserted'; session: Session }
  | { type: 'session.deleted'; sessionId: string }
  | { type: 'run.status'; run: Pick<Run, 'id' | 'sessionId'> & { status: RunStatus } }
  | { type: 'account.changed'; whoami: WhoAmI }
  | { type: 'quota.updated'; snapshot: QuotaSnapshot };
