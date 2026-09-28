import type { AgentMode, Effort } from './domain';
import type { ApiErrorBody } from './errors';
import type { GlobalEvent, SessionEventEnvelope } from './events';

/** Endpoint: `GET /ws?token=<apiToken>` (token optional when bound to loopback). */
export const WS_PATH = '/ws';

// ---------- Client -> Server (discriminated by `type`) ----------

export type ClientFrame =
  | {
      /**
       * Re-subscribing a session already subscribed on this socket (the client does so on a seq gap)
       * replaces the existing subscription and replays from the new `lastSeq`; it never stacks a second one.
       */
      type: 'session.subscribe';
      sessionIds: string[];
      /** Highest seq the client already holds per session; 0 = replay everything. */
      lastSeq: Record<string, number>;
    }
  | { type: 'session.unsubscribe'; sessionIds: string[] }
  | {
      type: 'session.send';
      requestId: string;
      sessionId: string;
      text: string;
      attachmentIds: string[];
      model?: string;
      effort?: Effort;
      mode?: AgentMode;
      /** `AgentInfo.id` passed to `agy --agent`; omitted or `default` runs agy's built-in agent. */
      agent?: string;
    }
  | { type: 'run.abort'; requestId: string; runId: string }
  | { type: 'ping'; ts: number };

// ---------- Server -> Client (discriminated by `type`) ----------

export type ServerFrame =
  | { type: 'event'; envelope: SessionEventEnvelope }
  | {
      type: 'subscribed';
      sessionId: string;
      /** Server's latest seq. If lower than the client's, the client must drop its slot and resubscribe from 0. */
      latestSeq: number;
      activeRunId: string | null;
    }
  | { type: 'ack'; requestId: string; runId?: string }
  | { type: 'nack'; requestId: string; error: ApiErrorBody }
  | { type: 'global'; event: GlobalEvent }
  | { type: 'pong'; ts: number };

export const WS_LIMITS = {
  /** Max envelopes sent per replay batch before yielding to live traffic. */
  replayBatchSize: 500,
  /** Server coalesces consecutive text deltas for this long before sending. */
  deltaCoalesceMs: 50,
  heartbeatIntervalMs: 20_000,
  /** Client reconnect backoff: min(maxMs, baseMs * 2^attempt) + jitter. */
  reconnectBaseMs: 500,
  reconnectMaxMs: 15_000,
} as const;
