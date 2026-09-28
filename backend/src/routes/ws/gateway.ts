import type { FastifyInstance, FastifyPluginAsync } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import {
  WS_LIMITS,
  WS_PATH,
  type AgentMode,
  type ClientFrame,
  type Effort,
  type ServerFrame,
  type SessionEventEnvelope,
} from '@agy-studio/contracts';
import type { EventBus } from '../../services/event-bus.js';
import type { EventsRepository } from '../../repositories/events.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

export interface SessionServicePort {
  send(params: {
    sessionId: string;
    text: string;
    attachmentIds: string[];
    model?: string;
    effort?: Effort;
    mode?: AgentMode;
  }): Promise<{ runId?: string } | string | void>;
  abortRun(params: { runId: string }): Promise<void>;
  getActiveRunId(sessionId: string): Promise<string | null> | string | null;
}

export interface GatewayOptions {
  eventBus: EventBus;
  eventsRepo: EventsRepository;
  sessionService: SessionServicePort;
  token?: string;
  heartbeatIntervalMs?: number;
  replayBatchSize?: number;
  maxBufferedAmount?: number;
  onConnection?: (socket: WebSocket) => void;
}

interface SessionSubscription {
  state: 'replay' | 'live';
  buffer: SessionEventEnvelope[];
  maxSentSeq: number;
  hasSentAny: boolean;
  unsubscribe: () => void;
}

const DEFAULT_MAX_BUFFERED_AMOUNT = 8 * 1024 * 1024; // 8MB

export async function registerWsGateway(
  app: FastifyInstance,
  options: GatewayOptions,
): Promise<void> {
  // Register @fastify/websocket if not already registered on this instance
  if (!(app as unknown as { websocketServer?: unknown }).websocketServer) {
    await app.register(fastifyWebsocket);
  }

  const {
    eventBus,
    eventsRepo,
    sessionService,
    token,
    heartbeatIntervalMs = WS_LIMITS.heartbeatIntervalMs,
    replayBatchSize = WS_LIMITS.replayBatchSize,
    maxBufferedAmount = DEFAULT_MAX_BUFFERED_AMOUNT,
  } = options;

  app.get(
    WS_PATH,
    {
      websocket: true,
      preHandler: async (req, reply) => {
        if (token) {
          const query = req.query as Record<string, string | undefined> | undefined;
          const queryToken = query?.token;
          if (!queryToken || queryToken !== token) {
            reply.code(401).send({
              error: {
                code: 'UNAUTHORIZED',
                message: 'Invalid or missing token',
                retryable: false,
              },
            });
            return;
          }
        }
      },
    },
    (socket: WebSocket, req) => {
      options.onConnection?.(socket);

      // In case preHandler was bypassed, double-check token
      if (token) {
        const query = req.query as Record<string, string | undefined> | undefined;
        if (!query?.token || query.token !== token) {
          socket.close(4401, 'Unauthorized');
          return;
        }
      }

      const activeSubscriptions = new Map<string, SessionSubscription>();
      let isCleanedUp = false;
      let lastActivityAt = Date.now();

      function safeSend(frame: ServerFrame): boolean {
        if (isCleanedUp || socket.readyState !== socket.OPEN) {
          return false;
        }

        if (socket.bufferedAmount > maxBufferedAmount) {
          logger.warn(
            { bufferedAmount: socket.bufferedAmount, maxBufferedAmount },
            'WebSocket buffered amount exceeded limit, terminating connection',
          );
          terminateConnection(1008, 'Buffer overflow');
          return false;
        }

        try {
          socket.send(JSON.stringify(frame));
        } catch (err) {
          logger.debug({ err }, 'Failed to send frame to WebSocket');
          cleanup();
          return false;
        }

        if (socket.bufferedAmount > maxBufferedAmount) {
          logger.warn(
            { bufferedAmount: socket.bufferedAmount, maxBufferedAmount },
            'WebSocket buffered amount exceeded limit after send, terminating connection',
          );
          terminateConnection(1008, 'Buffer overflow');
          return false;
        }

        return true;
      }

      function terminateConnection(code: number, reason: string): void {
        cleanup();
        try {
          socket.close(code, reason);
        } catch {
          // ignore
        }
        try {
          socket.terminate();
        } catch {
          // ignore
        }
      }

      function cleanup(): void {
        if (isCleanedUp) return;
        isCleanedUp = true;

        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
        }

        unsubGlobal();

        for (const sub of activeSubscriptions.values()) {
          try {
            sub.unsubscribe();
          } catch {
            // ignore
          }
        }
        activeSubscriptions.clear();
      }

      // Subscribe to global events immediately for connected socket
      const unsubGlobal = eventBus.subscribeGlobal((event) => {
        safeSend({ type: 'global', event });
      });

      // Heartbeat watchdog: terminate if no ping/activity for 2 intervals
      const heartbeatTimeoutMs = 2 * heartbeatIntervalMs;
      const checkInterval = Math.max(10, Math.min(heartbeatIntervalMs / 2, 2000));
      const heartbeatTimer = setInterval(() => {
        if (isCleanedUp) return;
        if (Date.now() - lastActivityAt > heartbeatTimeoutMs) {
          logger.debug('WebSocket heartbeat timed out, terminating');
          terminateConnection(1000, 'Heartbeat timeout');
        }
      }, checkInterval);

      socket.on('close', cleanup);
      socket.on('error', cleanup);

      socket.on('message', async (raw: unknown) => {
        lastActivityAt = Date.now();

        let frame: ClientFrame;
        try {
          const text =
            typeof raw === 'string'
              ? raw
              : Buffer.isBuffer(raw)
                ? raw.toString('utf8')
                : String(raw);
          frame = JSON.parse(text) as ClientFrame;
        } catch {
          return;
        }

        if (!frame || typeof frame !== 'object' || !('type' in frame)) {
          return;
        }

        switch (frame.type) {
          case 'ping': {
            safeSend({ type: 'pong', ts: frame.ts });
            break;
          }

          case 'session.subscribe': {
            await handleSubscribe(frame);
            break;
          }

          case 'session.unsubscribe': {
            handleUnsubscribe(frame);
            break;
          }

          case 'session.send': {
            await handleSend(frame);
            break;
          }

          case 'run.abort': {
            await handleAbort(frame);
            break;
          }
        }
      });

      async function handleSubscribe(
        frame: Extract<ClientFrame, { type: 'session.subscribe' }>,
      ): Promise<void> {
        const sessionIds = frame.sessionIds || [];
        const lastSeqMap = frame.lastSeq || {};

        for (const sessionId of sessionIds) {
          if (isCleanedUp || socket.readyState !== socket.OPEN) {
            break;
          }

          // Clean up existing subscription for this session on this socket if present
          const existing = activeSubscriptions.get(sessionId);
          if (existing) {
            existing.unsubscribe();
            activeSubscriptions.delete(sessionId);
          }

          const clientLastSeq = lastSeqMap[sessionId] ?? 0;
          const sub: SessionSubscription = {
            state: 'replay',
            buffer: [],
            maxSentSeq: clientLastSeq,
            hasSentAny: false,
            unsubscribe: () => {},
          };

          // Step 1: Hook up live subscription and buffer incoming live events
          const unsub = eventBus.subscribe(sessionId, (envelope) => {
            if (sub.state === 'replay') {
              sub.buffer.push(envelope);
            } else {
              safeSend({ type: 'event', envelope });
              sub.hasSentAny = true;
              if (envelope.seq > sub.maxSentSeq) {
                sub.maxSentSeq = envelope.seq;
              }
            }
          });
          sub.unsubscribe = unsub;
          activeSubscriptions.set(sessionId, sub);

          // Step 2: Replay events with seq > lastSeq from DB in batches of replayBatchSize
          let currentAfterSeq = clientLastSeq;
          while (socket.readyState === socket.OPEN && !isCleanedUp) {
            if (activeSubscriptions.get(sessionId) !== sub) {
              return;
            }
            const batch = eventsRepo.listAfter(sessionId, currentAfterSeq, replayBatchSize);
            if (batch.length === 0) {
              break;
            }

            for (const env of batch) {
              if (activeSubscriptions.get(sessionId) !== sub) {
                return;
              }
              safeSend({ type: 'event', envelope: env });
              sub.hasSentAny = true;
              if (env.seq > sub.maxSentSeq) {
                sub.maxSentSeq = env.seq;
              }
            }

            currentAfterSeq = sub.maxSentSeq;
            if (batch.length < replayBatchSize) {
              break;
            }
          }

          if (isCleanedUp || socket.readyState !== socket.OPEN || activeSubscriptions.get(sessionId) !== sub) {
            return;
          }

          // Step 3: Discard buffered events with seq <= maximum seq already sent
          const remaining = sub.buffer.filter((env) => env.seq > sub.maxSentSeq);

          // Step 4: Flush remaining buffered events, then switch directly to live push
          for (const env of remaining) {
            if (activeSubscriptions.get(sessionId) !== sub) {
              return;
            }
            safeSend({ type: 'event', envelope: env });
            sub.hasSentAny = true;
            if (env.seq > sub.maxSentSeq) {
              sub.maxSentSeq = env.seq;
            }
          }
          sub.buffer = [];
          sub.state = 'live';

          if (isCleanedUp || socket.readyState !== socket.OPEN || activeSubscriptions.get(sessionId) !== sub) {
            return;
          }

          // Step 5: Send ServerFrame subscribed { latestSeq, activeRunId }
          const dbLatest = eventsRepo.latestSeq(sessionId);
          // If server sent events past dbLatest, use maxSentSeq; otherwise return server's true dbLatest
          const latestSeq = Math.max(sub.hasSentAny ? sub.maxSentSeq : 0, dbLatest);

          let activeRunId: string | null = null;
          try {
            activeRunId = (await sessionService.getActiveRunId(sessionId)) ?? null;
          } catch {
            activeRunId = null;
          }

          if (isCleanedUp || socket.readyState !== socket.OPEN || activeSubscriptions.get(sessionId) !== sub) {
            return;
          }

          safeSend({
            type: 'subscribed',
            sessionId,
            latestSeq,
            activeRunId,
          });
        }
      }

      function handleUnsubscribe(
        frame: Extract<ClientFrame, { type: 'session.unsubscribe' }>,
      ): void {
        for (const sessionId of frame.sessionIds || []) {
          const sub = activeSubscriptions.get(sessionId);
          if (sub) {
            sub.unsubscribe();
            activeSubscriptions.delete(sessionId);
          }
        }
      }

      async function handleSend(
        frame: Extract<ClientFrame, { type: 'session.send' }>,
      ): Promise<void> {
        try {
          const res = await sessionService.send({
            sessionId: frame.sessionId,
            text: frame.text,
            attachmentIds: frame.attachmentIds,
            model: frame.model,
            effort: frame.effort,
            mode: frame.mode,
          });
          const runId = typeof res === 'string' ? res : res?.runId;
          safeSend({
            type: 'ack',
            requestId: frame.requestId,
            ...(runId ? { runId } : {}),
          });
        } catch (err) {
          const apiError = AppError.from(err).toApiError();
          safeSend({
            type: 'nack',
            requestId: frame.requestId,
            error: apiError,
          });
        }
      }

      async function handleAbort(
        frame: Extract<ClientFrame, { type: 'run.abort' }>,
      ): Promise<void> {
        try {
          await sessionService.abortRun({ runId: frame.runId });
          safeSend({
            type: 'ack',
            requestId: frame.requestId,
          });
        } catch (err) {
          const apiError = AppError.from(err).toApiError();
          safeSend({
            type: 'nack',
            requestId: frame.requestId,
            error: apiError,
          });
        }
      }
    },
  );
}

export const wsGatewayPlugin: FastifyPluginAsync<GatewayOptions> = async (app, opts) => {
  await registerWsGateway(app, opts);
};
