import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocket } from 'ws';
import type Database from 'better-sqlite3';
import type { ServerFrame, SessionEventEnvelope } from '@agy-studio/contracts';
import {
  createDatabase,
  EventsRepository,
  SessionsRepository,
  WorkspacesRepository,
} from '../../src/repositories/index.js';
import { EventBus } from '../../src/services/event-bus.js';
import {
  registerWsGateway,
  type SessionServicePort,
} from '../../src/routes/ws/gateway.js';
import { AppError } from '../../src/utils/errors.js';

function connectWs(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.on('open', () => resolve(ws));
    ws.on('error', (err) => reject(err));
  });
}

function waitForFrame<T = ServerFrame>(
  ws: WebSocket,
  predicate: (frame: any) => boolean,
  timeoutMs = 3000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', handler);
      reject(new Error(`Timeout (${timeoutMs}ms) waiting for frame`));
    }, timeoutMs);

    const handler = (data: any) => {
      try {
        const text = typeof data === 'string' ? data : data.toString('utf8');
        const frame = JSON.parse(text);
        if (predicate(frame)) {
          clearTimeout(timer);
          ws.off('message', handler);
          resolve(frame as T);
        }
      } catch {
        // ignore
      }
    };
    ws.on('message', handler);
  });
}

describe('WebSocket Gateway', () => {
  let tempDir: string;
  let db: Database.Database;
  let eventsRepo: EventsRepository;
  let sessionsRepo: SessionsRepository;
  let workspacesRepo: WorkspacesRepository;
  let eventBus: EventBus;
  let app: FastifyInstance;
  let serverUrl: string;
  let port: number;

  const workspaceId = 'ws-gw-1';
  const sessionId = 'session-gw-1';

  let mockSessionService: SessionServicePort;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-gateway-test-'));
    const dbPath = path.join(tempDir, 'test.db');
    db = createDatabase({ dbPath });
    eventsRepo = new EventsRepository(db);
    sessionsRepo = new SessionsRepository(db);
    workspacesRepo = new WorkspacesRepository(db);

    const now = new Date().toISOString();
    workspacesRepo.create({
      id: workspaceId,
      name: 'WS Gateway',
      path: '/tmp',
      isGitRepo: false,
      createdAt: now,
      lastOpenedAt: now,
    });
    sessionsRepo.create({
      id: sessionId,
      workspaceId,
      accountName: null,
      title: 'Session Gateway',
      agyConversationId: null,
      status: 'idle',
      model: null,
      effort: null,
      mode: null,
      source: 'studio',
      lastRunId: null,
      lastSeq: 0,
      createdAt: now,
      updatedAt: now,
    });

    eventBus = new EventBus({
      eventsRepo,
      deltaCoalesceMs: 50,
      batchSize: 100,
      flushIntervalMs: 50,
    });

    mockSessionService = {
      send: vi.fn().mockResolvedValue({ runId: 'mock-run-1' }),
      abortRun: vi.fn().mockResolvedValue(undefined),
      getActiveRunId: vi.fn().mockReturnValue(null),
    };
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
    await eventBus.close();
    try {
      db.close();
    } catch {
      // ignore
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  async function startServer(options: {
    token?: string;
    heartbeatIntervalMs?: number;
    replayBatchSize?: number;
    maxBufferedAmount?: number;
    onConnection?: (socket: WebSocket) => void;
  } = {}) {
    app = Fastify({ logger: false });
    await registerWsGateway(app, {
      eventBus,
      eventsRepo,
      sessionService: mockSessionService,
      ...options,
    });
    const addr = await app.listen({ port: 0, host: '127.0.0.1' });
    port = (app.server.address() as any).port;
    serverUrl = `ws://127.0.0.1:${port}/ws`;
  }

  describe('Authentication', () => {
    it('allows connection when token is not configured', async () => {
      await startServer();
      const ws = await connectWs(serverUrl);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });

    it('rejects connection when token is configured but missing or wrong', async () => {
      await startServer({ token: 'correct-secret' });

      // No token
      await expect(connectWs(serverUrl)).rejects.toThrow();

      // Wrong token
      await expect(connectWs(`${serverUrl}?token=bad-token`)).rejects.toThrow();

      // Correct token
      const ws = await connectWs(`${serverUrl}?token=correct-secret`);
      expect(ws.readyState).toBe(WebSocket.OPEN);
      ws.close();
    });
  });

  describe('Ping / Pong and Heartbeat', () => {
    it('replies with pong frame on ping frame', async () => {
      await startServer();
      const ws = await connectWs(serverUrl);

      const pongPromise = waitForFrame(ws, (f) => f.type === 'pong');
      ws.send(JSON.stringify({ type: 'ping', ts: 98765 }));

      const pong = await pongPromise;
      expect(pong).toEqual({ type: 'pong', ts: 98765 });
      ws.close();
    });

    it('terminates connection when client is idle past two heartbeat intervals', async () => {
      // Set heartbeat interval to 40ms, so 2 intervals = 80ms
      await startServer({ heartbeatIntervalMs: 40 });
      const ws = await connectWs(serverUrl);

      const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
        ws.on('close', (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      });

      // Do nothing, wait for watchdog termination
      const result = await closePromise;
      expect(ws.readyState).toBe(WebSocket.CLOSED);
      expect(result.code).toBe(1000);
      expect(result.reason).toContain('Heartbeat timeout');
    });
  });

  describe('Session send and run abort', () => {
    it('returns ack with runId when sessionService.send succeeds', async () => {
      await startServer();
      const ws = await connectWs(serverUrl);

      (mockSessionService.send as any).mockResolvedValueOnce({ runId: 'run-success-42' });

      const ackPromise = waitForFrame(ws, (f) => f.type === 'ack' && f.requestId === 'req-1');
      ws.send(
        JSON.stringify({
          type: 'session.send',
          requestId: 'req-1',
          sessionId,
          text: 'Hello world',
          attachmentIds: [],
        }),
      );

      const ack = await ackPromise;
      expect(ack).toEqual({
        type: 'ack',
        requestId: 'req-1',
        runId: 'run-success-42',
      });
      ws.close();
    });

    it('returns nack with ApiErrorBody when sessionService.send fails', async () => {
      await startServer();
      const ws = await connectWs(serverUrl);

      (mockSessionService.send as any).mockRejectedValueOnce(
        new AppError('SESSION_BUSY', 'Session has active run'),
      );

      const nackPromise = waitForFrame(ws, (f) => f.type === 'nack' && f.requestId === 'req-2');
      ws.send(
        JSON.stringify({
          type: 'session.send',
          requestId: 'req-2',
          sessionId,
          text: 'Trigger busy',
          attachmentIds: [],
        }),
      );

      const nack: any = await nackPromise;
      expect(nack.type).toBe('nack');
      expect(nack.requestId).toBe('req-2');
      expect(nack.error.code).toBe('SESSION_BUSY');
      expect(nack.error.message).toBe('Session has active run');
      ws.close();
    });

    it('returns ack when run.abort succeeds', async () => {
      await startServer();
      const ws = await connectWs(serverUrl);

      const ackPromise = waitForFrame(ws, (f) => f.type === 'ack' && f.requestId === 'abort-req');
      ws.send(
        JSON.stringify({
          type: 'run.abort',
          requestId: 'abort-req',
          runId: 'run-to-abort',
        }),
      );

      const ack = await ackPromise;
      expect(ack).toEqual({
        type: 'ack',
        requestId: 'abort-req',
      });
      expect(mockSessionService.abortRun).toHaveBeenCalledWith({ runId: 'run-to-abort' });
      ws.close();
    });

    it('returns nack when run.abort fails', async () => {
      await startServer();
      const ws = await connectWs(serverUrl);

      (mockSessionService.abortRun as any).mockRejectedValueOnce(
        new AppError('NOT_FOUND', 'Run not found'),
      );

      const nackPromise = waitForFrame(ws, (f) => f.type === 'nack' && f.requestId === 'abort-fail');
      ws.send(
        JSON.stringify({
          type: 'run.abort',
          requestId: 'abort-fail',
          runId: 'invalid-run',
        }),
      );

      const nack: any = await nackPromise;
      expect(nack.type).toBe('nack');
      expect(nack.error.code).toBe('NOT_FOUND');
      ws.close();
    });
  });

  describe('Session subscribe & replay vs live seamless transition', () => {
    it('replays historical events with seq > lastSeq and sends subscribed frame', async () => {
      await startServer();

      // Pre-populate DB with events seq 1..5
      const envelopes: SessionEventEnvelope[] = [1, 2, 3, 4, 5].map((seq) => ({
        seq,
        sessionId,
        runId: 'run-hist',
        ts: new Date().toISOString(),
        event: {
          type: 'user.message',
          messageId: `msg-${seq}`,
          text: `Text ${seq}`,
          attachments: [],
        },
      }));
      eventsRepo.appendBatch(sessionId, envelopes);

      const ws = await connectWs(serverUrl);
      const frames: ServerFrame[] = [];
      ws.on('message', (raw) => {
        frames.push(JSON.parse(raw.toString()));
      });

      // Client already has seq 2, should replay seq 3, 4, 5
      ws.send(
        JSON.stringify({
          type: 'session.subscribe',
          sessionIds: [sessionId],
          lastSeq: { [sessionId]: 2 },
        }),
      );

      await waitForFrame(ws, (f) => f.type === 'subscribed' && f.sessionId === sessionId);

      const eventFrames = frames.filter((f) => f.type === 'event') as Array<
        Extract<ServerFrame, { type: 'event' }>
      >;
      expect(eventFrames).toHaveLength(3);
      expect(eventFrames.map((f) => f.envelope.seq)).toEqual([3, 4, 5]);

      const subscribedFrame = frames.find((f) => f.type === 'subscribed') as Extract<
        ServerFrame,
        { type: 'subscribed' }
      >;
      expect(subscribedFrame).toBeDefined();
      expect(subscribedFrame.latestSeq).toBe(5);
      expect(subscribedFrame.activeRunId).toBeNull();

      ws.close();
    });

    it('seamlessly transitions from replay to live without dropping or duplicating events during in-flight subscription', async () => {
      await startServer();

      // 1. Initial event in DB (seq 1)
      eventsRepo.appendBatch(sessionId, [
        {
          seq: 1,
          sessionId,
          runId: 'run-1',
          ts: new Date().toISOString(),
          event: { type: 'message.done', messageId: 'm1' },
        },
      ]);

      const ws = await connectWs(serverUrl);
      const frames: ServerFrame[] = [];
      ws.on('message', (raw) => {
        frames.push(JSON.parse(raw.toString()));
      });

      // Hook up an interceptor on eventsRepo.listAfter to inject a concurrent live publish!
      const originalListAfter = eventsRepo.listAfter.bind(eventsRepo);
      let injected = false;
      vi.spyOn(eventsRepo, 'listAfter').mockImplementation((sId, afterSeq, limit) => {
        const result = originalListAfter(sId, afterSeq, limit);
        if (!injected && sId === sessionId) {
          injected = true;
          // While gateway is in the middle of replaying, publish new events to EventBus!
          eventBus.publish(sessionId, 'run-1', {
            type: 'message.delta',
            messageId: 'live-msg',
            text: 'Live 1',
          });
          eventBus.publish(sessionId, 'run-1', {
            type: 'message.done',
            messageId: 'live-msg',
          });
          // Flush to make sure they get committed and pushed into gateway buffer
          eventBus.flush(sessionId);
        }
        return result;
      });

      // Subscribe starting from seq 0
      ws.send(
        JSON.stringify({
          type: 'session.subscribe',
          sessionIds: [sessionId],
          lastSeq: { [sessionId]: 0 },
        }),
      );

      // Wait for subscribed frame
      await waitForFrame(ws, (f) => f.type === 'subscribed' && f.sessionId === sessionId);

      // Now publish an additional live event after subscribed
      await eventBus.publish(sessionId, 'run-1', {
        type: 'user.message',
        messageId: 'post-sub',
        text: 'Post sub',
        attachments: [],
      });
      await eventBus.flush(sessionId);

      await waitForFrame(
        ws,
        (f) =>
          f.type === 'event' &&
          (f.envelope.event as any).messageId === 'post-sub',
      );

      const eventFrames = frames.filter((f) => f.type === 'event') as Array<
        Extract<ServerFrame, { type: 'event' }>
      >;
      const seqs = eventFrames.map((f) => f.envelope.seq);

      // Must be strictly increasing [1, 2, 3, 4] with no gaps and no duplicates!
      expect(seqs).toEqual([1, 2, 3, 4]);

      ws.close();
    });

    it('supports two clients subscribing simultaneously to the same session', async () => {
      await startServer();

      const ws1 = await connectWs(serverUrl);
      const ws2 = await connectWs(serverUrl);

      const frames1: ServerFrame[] = [];
      const frames2: ServerFrame[] = [];
      ws1.on('message', (d) => frames1.push(JSON.parse(d.toString())));
      ws2.on('message', (d) => frames2.push(JSON.parse(d.toString())));

      // Both subscribe
      ws1.send(
        JSON.stringify({
          type: 'session.subscribe',
          sessionIds: [sessionId],
          lastSeq: { [sessionId]: 0 },
        }),
      );
      ws2.send(
        JSON.stringify({
          type: 'session.subscribe',
          sessionIds: [sessionId],
          lastSeq: { [sessionId]: 0 },
        }),
      );

      await Promise.all([
        waitForFrame(ws1, (f) => f.type === 'subscribed'),
        waitForFrame(ws2, (f) => f.type === 'subscribed'),
      ]);

      // Publish a new live event
      await eventBus.publish(sessionId, 'run-1', {
        type: 'user.message',
        messageId: 'msg-dual',
        text: 'Hello both',
        attachments: [],
      });
      await eventBus.flush(sessionId);

      await Promise.all([
        waitForFrame(ws1, (f) => f.type === 'event'),
        waitForFrame(ws2, (f) => f.type === 'event'),
      ]);

      expect(frames1.some((f) => f.type === 'event' && (f.envelope.event as any).messageId === 'msg-dual')).toBe(true);
      expect(frames2.some((f) => f.type === 'event' && (f.envelope.event as any).messageId === 'msg-dual')).toBe(true);

      ws1.close();
      ws2.close();
    });

    it('unsubscribes from session when session.unsubscribe frame is sent', async () => {
      await startServer();
      const ws = await connectWs(serverUrl);

      ws.send(
        JSON.stringify({
          type: 'session.subscribe',
          sessionIds: [sessionId],
          lastSeq: { [sessionId]: 0 },
        }),
      );
      await waitForFrame(ws, (f) => f.type === 'subscribed');

      // Unsubscribe
      ws.send(
        JSON.stringify({
          type: 'session.unsubscribe',
          sessionIds: [sessionId],
        }),
      );

      // Wait a tick for unsubscribe to process
      await new Promise((r) => setTimeout(r, 50));

      const receivedAfter: ServerFrame[] = [];
      ws.on('message', (d) => receivedAfter.push(JSON.parse(d.toString())));

      // Publish new event
      await eventBus.publish(sessionId, 'run-1', {
        type: 'message.done',
        messageId: 'after-unsub',
      });
      await eventBus.flush(sessionId);

      // Wait briefly, should receive no event
      await new Promise((r) => setTimeout(r, 100));
      expect(receivedAfter.filter((f) => f.type === 'event')).toHaveLength(0);

      ws.close();
    });
  });

  describe('Global events & Backpressure protection', () => {
    it('pushes global events to connected sockets', async () => {
      await startServer();
      const ws = await connectWs(serverUrl);

      const globalPromise = waitForFrame(ws, (f) => f.type === 'global');

      eventBus.publishGlobal({
        type: 'session.deleted',
        sessionId: 'deleted-session-123',
      });

      const globalFrame: any = await globalPromise;
      expect(globalFrame.type).toBe('global');
      expect(globalFrame.event).toEqual({
        type: 'session.deleted',
        sessionId: 'deleted-session-123',
      });

      ws.close();
    });

    it('terminates connection when socket buffer exceeds maxBufferedAmount (backpressure protection)', async () => {
      let serverSideSocket: WebSocket | null = null;
      await startServer({
        maxBufferedAmount: 100,
        onConnection: (sock) => {
          serverSideSocket = sock;
        },
      });

      const ws = await connectWs(serverUrl);
      expect(serverSideSocket).toBeDefined();

      // Mock server-side socket bufferedAmount to simulate backpressure overflow (> 100 bytes)
      Object.defineProperty(serverSideSocket, 'bufferedAmount', {
        get: () => 1024,
        configurable: true,
      });

      const closePromise = new Promise<{ code: number; reason: string }>((resolve) => {
        ws.on('close', (code, reason) => {
          resolve({ code, reason: reason.toString() });
        });
      });

      // Trigger a send from server which checks bufferedAmount
      eventBus.publishGlobal({
        type: 'session.deleted',
        sessionId: 'test-overflow-session',
      });

      const closeResult = await closePromise;
      expect(closeResult.code).toBe(1008);
      expect(closeResult.reason).toContain('Buffer overflow');
    });
  });
});
