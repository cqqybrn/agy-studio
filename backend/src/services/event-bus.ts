import {
  WS_LIMITS,
  type AgentEvent,
  type GlobalEvent,
  type SessionEventEnvelope,
} from '@agy-studio/contracts';
import type { EventsRepository } from '../repositories/events.js';
import { logger } from '../utils/logger.js';

export type SessionEventListener = (envelope: SessionEventEnvelope) => void;
export type GlobalEventListener = (event: GlobalEvent) => void;

export interface EventBusOptions {
  eventsRepo: EventsRepository;
  deltaCoalesceMs?: number;
  batchSize?: number;
  flushIntervalMs?: number;
}

interface Deferred {
  resolve: () => void;
  reject: (err: unknown) => void;
}

interface PendingItem {
  envelope: SessionEventEnvelope;
  receivedAt: number;
  deferreds: Deferred[];
}

interface SessionQueueState {
  latestSeq: number;
  initialized: boolean;
  buffer: PendingItem[];
  timer: NodeJS.Timeout | null;
  commitQueue: Promise<void>;
}

export class EventBus {
  private readonly eventsRepo: EventsRepository;
  private readonly deltaCoalesceMs: number;
  private readonly batchSize: number;
  private readonly flushIntervalMs: number;

  private readonly sessionSubscribers = new Map<string, Set<SessionEventListener>>();
  private readonly globalSubscribers = new Set<GlobalEventListener>();
  private readonly sessionQueues = new Map<string, SessionQueueState>();

  constructor(options: EventBusOptions) {
    this.eventsRepo = options.eventsRepo;
    this.deltaCoalesceMs = options.deltaCoalesceMs ?? WS_LIMITS.deltaCoalesceMs;
    this.batchSize = options.batchSize ?? 100;
    this.flushIntervalMs = options.flushIntervalMs ?? WS_LIMITS.deltaCoalesceMs;
  }

  /**
   * Subscribe to session-specific events.
   * Returns an unsubscribe function.
   */
  subscribe(sessionId: string, listener: SessionEventListener): () => void {
    let listeners = this.sessionSubscribers.get(sessionId);
    if (!listeners) {
      listeners = new Set();
      this.sessionSubscribers.set(sessionId, listeners);
    }
    listeners.add(listener);

    return () => {
      this.unsubscribe(sessionId, listener);
    };
  }

  /**
   * Unsubscribe from session-specific events.
   */
  unsubscribe(sessionId: string, listener: SessionEventListener): void {
    const listeners = this.sessionSubscribers.get(sessionId);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.sessionSubscribers.delete(sessionId);
      }
    }
  }

  /**
   * Subscribe to process-wide global events.
   * Returns an unsubscribe function.
   */
  subscribeGlobal(listener: GlobalEventListener): () => void {
    this.globalSubscribers.add(listener);
    return () => {
      this.unsubscribeGlobal(listener);
    };
  }

  /**
   * Unsubscribe from process-wide global events.
   */
  unsubscribeGlobal(listener: GlobalEventListener): void {
    this.globalSubscribers.delete(listener);
  }

  /**
   * Dispatch a global event to all global subscribers immediately (not persisted).
   */
  publishGlobal(event: GlobalEvent): void {
    for (const listener of this.globalSubscribers) {
      try {
        listener(event);
      } catch (err) {
        logger.error({ err }, 'Error in global event listener');
      }
    }
  }

  /**
   * Publish a session event.
   * Ensures monotonic sequence per session, delta coalescing, batch commit to DB,
   * and pushes to subscribers only after successful DB append.
   */
  publish(sessionId: string, runId: string | null, event: AgentEvent): Promise<void> {
    const session = this.getOrCreateSessionQueue(sessionId);
    const now = Date.now();

    return new Promise<void>((resolve, reject) => {
      const deferred: Deferred = { resolve, reject };

      const lastItem = session.buffer[session.buffer.length - 1];
      let coalesced = false;

      if (
        lastItem &&
        now - lastItem.receivedAt <= this.deltaCoalesceMs &&
        lastItem.envelope.runId === runId
      ) {
        if (
          lastItem.envelope.event.type === 'message.delta' &&
          event.type === 'message.delta' &&
          lastItem.envelope.event.messageId === event.messageId
        ) {
          lastItem.envelope.event = {
            ...lastItem.envelope.event,
            text: lastItem.envelope.event.text + event.text,
          };
          lastItem.deferreds.push(deferred);
          coalesced = true;
        } else if (
          lastItem.envelope.event.type === 'thinking.delta' &&
          event.type === 'thinking.delta' &&
          lastItem.envelope.event.blockId === event.blockId
        ) {
          lastItem.envelope.event = {
            ...lastItem.envelope.event,
            text: lastItem.envelope.event.text + event.text,
          };
          lastItem.deferreds.push(deferred);
          coalesced = true;
        }
      }

      if (!coalesced) {
        session.latestSeq += 1;
        const envelope: SessionEventEnvelope = {
          seq: session.latestSeq,
          sessionId,
          runId,
          ts: new Date().toISOString(),
          event,
        };

        session.buffer.push({
          envelope,
          receivedAt: now,
          deferreds: [deferred],
        });
      }

      if (session.buffer.length >= this.batchSize) {
        this.scheduleCommit(session, sessionId);
      } else if (!session.timer) {
        session.timer = setTimeout(() => {
          this.scheduleCommit(session, sessionId);
        }, this.flushIntervalMs);
      }
    });
  }

  /**
   * Flush pending events immediately.
   * If sessionId is provided, only that session is flushed.
   * If omitted, all sessions are flushed.
   */
  async flush(sessionId?: string): Promise<void> {
    if (sessionId) {
      const session = this.sessionQueues.get(sessionId);
      if (session) {
        this.scheduleCommit(session, sessionId);
        await session.commitQueue;
      }
    } else {
      const promises: Promise<void>[] = [];
      for (const [id, session] of this.sessionQueues.entries()) {
        this.scheduleCommit(session, id);
        promises.push(session.commitQueue);
      }
      await Promise.all(promises);
    }
  }

  /**
   * Clear timers and flush pending items during graceful shutdown.
   */
  async close(): Promise<void> {
    for (const session of this.sessionQueues.values()) {
      if (session.timer) {
        clearTimeout(session.timer);
        session.timer = null;
      }
    }
    await this.flush();
  }

  private getOrCreateSessionQueue(sessionId: string): SessionQueueState {
    let session = this.sessionQueues.get(sessionId);
    if (!session) {
      const initialSeq = this.eventsRepo.latestSeq(sessionId);
      session = {
        latestSeq: initialSeq,
        initialized: true,
        buffer: [],
        timer: null,
        commitQueue: Promise.resolve(),
      };
      this.sessionQueues.set(sessionId, session);
    }
    return session;
  }

  private scheduleCommit(session: SessionQueueState, sessionId: string): void {
    if (session.timer) {
      clearTimeout(session.timer);
      session.timer = null;
    }

    if (session.buffer.length === 0) {
      return;
    }

    const itemsToCommit = session.buffer;
    session.buffer = [];

    // Chain to commitQueue so that database writes and pushes for this session are strictly serialized
    session.commitQueue = session.commitQueue
      .catch(() => {
        // Previous batch failure shouldn't completely block subsequent batches
      })
      .then(async () => {
        await this.commitBatch(sessionId, itemsToCommit, session);
      });
  }

  private async commitBatch(
    sessionId: string,
    items: PendingItem[],
    session: SessionQueueState,
  ): Promise<void> {
    if (items.length === 0) {
      return;
    }

    const envelopes = items.map((i) => i.envelope);

    try {
      this.eventsRepo.appendBatch(sessionId, envelopes);
    } catch (err) {
      // Re-align latestSeq with database to avoid sequence gaps
      try {
        session.latestSeq = this.eventsRepo.latestSeq(sessionId);
      } catch {
        // ignore fallback errors
      }

      // Reject all pending publish callers
      for (const item of items) {
        for (const d of item.deferreds) {
          d.reject(err);
        }
      }

      // Writing to DB failed - NEVER push to subscribers
      logger.error({ err, sessionId }, 'Failed to append events batch to database');
      return;
    }

    // DB append succeeded - push to subscribers
    const listeners = this.sessionSubscribers.get(sessionId);
    if (listeners && listeners.size > 0) {
      for (const envelope of envelopes) {
        for (const listener of Array.from(listeners)) {
          try {
            listener(envelope);
          } catch (err) {
            logger.error({ err, sessionId }, 'Error in session event subscriber');
          }
        }
      }
    }

    // Resolve publish callers
    for (const item of items) {
      for (const d of item.deferreds) {
        d.resolve();
      }
    }
  }
}
