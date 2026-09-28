import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GlobalEvent, SessionEventEnvelope } from '@agy-studio/contracts';
import { ApiError } from './http';
import {
  close as wsClose,
  onGlobalEvent,
  onStatusChange,
  send as wsSend,
  subscribe as wsSubscribe,
  unsubscribe as wsUnsubscribe,
  WsClient,
  wsClient,
} from './ws';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  static instances: MockWebSocket[] = [];

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  sentMessages: string[] = [];

  onopen: ((ev?: any) => void) | null = null;
  onclose: ((ev?: any) => void) | null = null;
  onerror: ((ev?: any) => void) | null = null;
  onmessage: ((ev: { data: any }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(data: string) {
    if (this.readyState !== MockWebSocket.OPEN) {
      throw new Error(`WebSocket is not open: readyState ${this.readyState}`);
    }
    this.sentMessages.push(data);
  }

  close(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.({});
  }

  simulateMessage(msg: any) {
    const data = typeof msg === 'string' ? msg : JSON.stringify(msg);
    this.onmessage?.({ data });
  }

  simulateClose(code = 1000, reason = '') {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  simulateError(err = new Error('Socket error')) {
    this.onerror?.(err);
  }

  getLastSent<T = any>(): T | null {
    if (this.sentMessages.length === 0) return null;
    return JSON.parse(this.sentMessages[this.sentMessages.length - 1]);
  }

  getAllSent<T = any>(): T[] {
    return this.sentMessages.map((m) => JSON.parse(m));
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 6; i++) {
    await Promise.resolve();
  }
}

describe('WsClient - Full Test Suite', () => {
  let createdClients: WsClient[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    createdClients = [];
  });

  afterEach(() => {
    for (const c of createdClients) {
      c.close();
    }
    wsClose();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const createClient = (options: any = {}): { client: WsClient; getWs: () => MockWebSocket } => {
    const client = new WsClient({
      WebSocketClass: MockWebSocket,
      url: 'ws://127.0.0.1:8790/ws',
      jitter: 0,
      ...options,
    });
    createdClients.push(client);
    return {
      client,
      getWs: () => MockWebSocket.instances[MockWebSocket.instances.length - 1],
    };
  };

  // -------------------------------------------------------------
  // 1) 基本连接、心跳 ping/pong、双周期未收到 pong 主动超时重连
  // -------------------------------------------------------------
  describe('1) Connection & Heartbeat ping/pong', () => {
    it('initiates connection and transitions to open upon onopen', () => {
      const { client, getWs } = createClient();
      expect(client.getStatus()).toBe('connecting');

      const ws = getWs();
      expect(ws).toBeDefined();
      expect(ws.url).toBe('ws://127.0.0.1:8790/ws');

      ws.simulateOpen();
      expect(client.getStatus()).toBe('open');
    });

    it('sends ping frame on every heartbeat interval', () => {
      const { client, getWs } = createClient({ heartbeatIntervalMs: 20_000 });
      const ws = getWs();
      ws.simulateOpen();

      expect(ws.getAllSent().filter((m) => m.type === 'ping')).toHaveLength(0);

      // Advance 20s
      vi.advanceTimersByTime(20_000);
      let pings = ws.getAllSent().filter((m) => m.type === 'ping');
      expect(pings).toHaveLength(1);
      expect(pings[0].type).toBe('ping');
      expect(typeof pings[0].ts).toBe('number');

      // Server sends pong
      ws.simulateMessage({ type: 'pong', ts: pings[0].ts });

      // Advance another 20s
      vi.advanceTimersByTime(20_000);
      pings = ws.getAllSent().filter((m) => m.type === 'ping');
      expect(pings).toHaveLength(2);
    });

    it('triggers active reconnect when 2 cycles pass without pong', () => {
      const { client, getWs } = createClient({
        heartbeatIntervalMs: 20_000,
        reconnectBaseMs: 500,
      });
      const ws1 = getWs();
      ws1.simulateOpen();

      // Cycle 1 at 20s: ping 1 sent, no pong returned
      vi.advanceTimersByTime(20_000);
      expect(ws1.getAllSent().filter((m) => m.type === 'ping')).toHaveLength(1);
      expect(client.getStatus()).toBe('open');

      // Cycle 2 at 40s: ping 2 sent, still no pong returned
      vi.advanceTimersByTime(20_000);
      expect(ws1.getAllSent().filter((m) => m.type === 'ping')).toHaveLength(2);
      expect(client.getStatus()).toBe('open');

      // Cycle 3 at 60s: 2 full cycles elapsed without pong -> active timeout triggers reconnect!
      vi.advanceTimersByTime(20_000);
      expect(client.getStatus()).toBe('reconnecting');
      expect(ws1.readyState).toBe(MockWebSocket.CLOSED);

      // Advance reconnect delay (500ms)
      vi.advanceTimersByTime(500);
      expect(client.getStatus()).toBe('connecting');
      expect(MockWebSocket.instances.length).toBe(2);
    });

    it('stays healthy if pong arrives in time before 2 cycles without pong', () => {
      const { client, getWs } = createClient({ heartbeatIntervalMs: 20_000 });
      const ws = getWs();
      ws.simulateOpen();

      vi.advanceTimersByTime(20_000);
      expect(ws.getAllSent().filter((m) => m.type === 'ping')).toHaveLength(1);

      // Pong arrives at 25s
      vi.advanceTimersByTime(5_000);
      ws.simulateMessage({ type: 'pong', ts: Date.now() });

      // Cycle 2 at 40s
      vi.advanceTimersByTime(15_000);
      expect(ws.getAllSent().filter((m) => m.type === 'ping')).toHaveLength(2);
      expect(client.getStatus()).toBe('open');
    });
  });

  // -------------------------------------------------------------
  // 2) 指数退避重连算法
  // -------------------------------------------------------------
  describe('2) Exponential Backoff and Jitter Calculation', () => {
    it('calculates delay accurately: 500 * (2^attempt), capped at 15000ms', () => {
      const { client } = createClient({ jitter: 0 });

      // Normal visible state
      expect(client.calculateReconnectDelay(0, false)).toBe(500);
      expect(client.calculateReconnectDelay(1, false)).toBe(1000);
      expect(client.calculateReconnectDelay(2, false)).toBe(2000);
      expect(client.calculateReconnectDelay(3, false)).toBe(4000);
      expect(client.calculateReconnectDelay(4, false)).toBe(8000);
      expect(client.calculateReconnectDelay(5, false)).toBe(15000);
      expect(client.calculateReconnectDelay(6, false)).toBe(15000);
    });

    it('multiplies base delay by 4 when page is hidden', () => {
      const { client } = createClient({ jitter: 0 });

      expect(client.calculateReconnectDelay(0, true)).toBe(2000);
      expect(client.calculateReconnectDelay(1, true)).toBe(4000);
      expect(client.calculateReconnectDelay(2, true)).toBe(8000);
      expect(client.calculateReconnectDelay(5, true)).toBe(60000);
    });

    it('adds jitter within range', () => {
      const { client } = createClient({ jitter: () => 42 });
      expect(client.calculateReconnectDelay(0, false)).toBe(542);
      expect(client.calculateReconnectDelay(0, true)).toBe(2042);
    });

    it('resets attempt counter to 0 after successful open', () => {
      const { client, getWs } = createClient({ jitter: 0 });
      const ws1 = getWs();
      ws1.simulateOpen();

      // Trigger close
      ws1.simulateClose();
      expect(client.getStatus()).toBe('reconnecting');
      expect(client.getReconnectAttempt()).toBe(1);

      // Advance 500ms
      vi.advanceTimersByTime(500);
      const ws2 = getWs();
      expect(client.getStatus()).toBe('connecting');

      // Successfully opens
      ws2.simulateOpen();
      expect(client.getStatus()).toBe('open');
      expect(client.getReconnectAttempt()).toBe(0);
    });
  });

  // -------------------------------------------------------------
  // 3) subscribe/unsubscribe 会话管理
  // -------------------------------------------------------------
  describe('3) Session Subscription & Resubscribe Management', () => {
    it('immediately sends session.subscribe if already connected', () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      const onEvent = vi.fn();
      client.subscribe('session-1', onEvent);

      const sent = ws.getAllSent();
      const subFrames = sent.filter((m) => m.type === 'session.subscribe');
      expect(subFrames).toHaveLength(1);
      expect(subFrames[0]).toEqual({
        type: 'session.subscribe',
        sessionIds: ['session-1'],
        lastSeq: { 'session-1': 0 },
      });
      expect(client.getLastSeq('session-1')).toBe(0);
    });

    it('supports custom initialLastSeq option', () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      client.subscribe('session-initial', () => {}, { initialLastSeq: 15 });
      expect(client.getLastSeq('session-initial')).toBe(15);

      const subFrame = ws.getLastSent();
      expect(subFrame).toEqual({
        type: 'session.subscribe',
        sessionIds: ['session-initial'],
        lastSeq: { 'session-initial': 15 },
      });
    });

    it('allows multiple subscribers on the same session without sending duplicate subscribe frame', () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      const sub1 = vi.fn();
      const sub2 = vi.fn();

      client.subscribe('session-shared', sub1);
      expect(ws.getAllSent().filter((m) => m.type === 'session.subscribe')).toHaveLength(1);

      client.subscribe('session-shared', sub2);
      // Still only 1 subscribe frame
      expect(ws.getAllSent().filter((m) => m.type === 'session.subscribe')).toHaveLength(1);
    });

    it('unsubscribes specific handler and only sends session.unsubscribe when all handlers are removed', () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      const sub1 = vi.fn();
      const sub2 = vi.fn();

      const unsub1 = client.subscribe('session-multi', sub1);
      client.subscribe('session-multi', sub2);

      // Unsubscribe sub1
      unsub1();
      expect(ws.getAllSent().filter((m) => m.type === 'session.unsubscribe')).toHaveLength(0);
      expect(client.getSubscriptions()).toContain('session-multi');

      // Unsubscribe sub2
      client.unsubscribe('session-multi', sub2);
      expect(ws.getAllSent().filter((m) => m.type === 'session.unsubscribe')).toHaveLength(1);
      expect(client.getSubscriptions()).not.toContain('session-multi');
    });

    it('accurately unsubscribes when the same handler function is used by multiple subscribers', async () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      const sharedHandler = vi.fn();
      const events: SessionEventEnvelope[] = [];
      const trackingHandler = (env: SessionEventEnvelope) => {
        sharedHandler(env);
        events.push(env);
      };

      const unsub1 = client.subscribe('session-same', trackingHandler);
      const unsub2 = client.subscribe('session-same', trackingHandler);

      // Unsubscribing caller 1 must not remove caller 2
      unsub1();
      expect(client.getSubscriptions()).toContain('session-same');
      expect(ws.getAllSent().filter((m) => m.type === 'session.unsubscribe')).toHaveLength(0);

      // Event should still be delivered to caller 2
      ws.simulateMessage({
        type: 'event',
        envelope: {
          seq: 1,
          sessionId: 'session-same',
          runId: 'r1',
          ts: '2026-09-28T00:00:00Z',
          event: { type: 'message.delta', messageId: 'm1', text: 'hi' },
        },
      });

      await flushMicrotasks();
      expect(events).toHaveLength(1);

      // Unsubscribing caller 2 now cleanly removes the session and sends session.unsubscribe
      unsub2();
      expect(client.getSubscriptions()).not.toContain('session-same');
      expect(ws.getAllSent().filter((m) => m.type === 'session.unsubscribe')).toHaveLength(1);
    });

    it('does not mistakenly delete object callback subscribers sharing the same onEvent handler', () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      const commonFn = vi.fn();
      const onReset = vi.fn();

      const unsubFn = client.subscribe('s-obj', commonFn);
      const unsubObj = client.subscribe('s-obj', { onEvent: commonFn, onReset });

      // Unsubscribe the bare function subscription
      unsubFn();

      // Object subscriber should still remain
      expect(client.getSubscriptions()).toContain('s-obj');
      expect(ws.getAllSent().filter((m) => m.type === 'session.unsubscribe')).toHaveLength(0);

      unsubObj();
      expect(client.getSubscriptions()).not.toContain('s-obj');
      expect(ws.getAllSent().filter((m) => m.type === 'session.unsubscribe')).toHaveLength(1);
    });

    it('resubscribeAll sends only currently active subscriptions on reconnect, excluding unsubscribed', () => {
      const { client, getWs } = createClient({ jitter: 0 });
      const ws1 = getWs();
      ws1.simulateOpen();

      client.subscribe('s1', () => {});
      client.subscribe('s2', () => {});
      client.subscribe('s3', () => {});

      // Advance sequence of s1 and s2
      ws1.simulateMessage({
        type: 'event',
        envelope: {
          seq: 1,
          sessionId: 's1',
          runId: 'r1',
          ts: '2026-09-28T00:00:00Z',
          event: { type: 'message.delta', messageId: 'm1', text: 'a' },
        },
      });
      expect(client.getLastSeq('s1')).toBe(1);

      // Unsubscribe s3
      client.unsubscribe('s3');
      expect(client.getSubscriptions()).toEqual(['s1', 's2']);

      // Disconnect ws1
      ws1.simulateClose();
      vi.advanceTimersByTime(500);

      const ws2 = getWs();
      ws2.simulateOpen();

      const subFrames = ws2.getAllSent().filter((m) => m.type === 'session.subscribe');
      expect(subFrames).toHaveLength(1);
      expect(subFrames[0].sessionIds.sort()).toEqual(['s1', 's2']);
      expect(subFrames[0].lastSeq).toEqual({
        s1: 1,
        s2: 0,
      });
      // S3 was unsubscribed and must NEVER appear!
      expect(subFrames[0].sessionIds).not.toContain('s3');
    });
  });

  // -------------------------------------------------------------
  // 4) ack / nack 与 send() 的 requestId 匹配与超时
  // -------------------------------------------------------------
  describe('4) Request ack / nack and Timeout', () => {
    it('generates unique requestId and resolves with runId on ack', async () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      const promise = client.send({
        type: 'session.send',
        sessionId: 's1',
        text: 'hello',
        attachmentIds: [],
      });

      const sentFrame = ws.getLastSent();
      expect(sentFrame.type).toBe('session.send');
      expect(typeof sentFrame.requestId).toBe('string');
      expect(sentFrame.requestId.length).toBeGreaterThan(0);

      // Server sends ack
      ws.simulateMessage({
        type: 'ack',
        requestId: sentFrame.requestId,
        runId: 'run-999',
      });

      const result = await promise;
      expect(result).toEqual({ runId: 'run-999' });
      expect(client.getPendingCount()).toBe(0);
    });

    it('rejects with ApiError when server returns nack', async () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      const promise = client.send({
        type: 'run.abort',
        runId: 'run-123',
      });

      const sentFrame = ws.getLastSent();
      expect(sentFrame.type).toBe('run.abort');

      ws.simulateMessage({
        type: 'nack',
        requestId: sentFrame.requestId,
        error: {
          code: 'NOT_FOUND',
          message: 'Run not found',
          retryable: false,
          details: { id: 'run-123' },
        },
      });

      await expect(promise).rejects.toThrow('Run not found');
      try {
        await promise;
      } catch (err: any) {
        expect(err).toBeInstanceOf(ApiError);
        expect(err.code).toBe('NOT_FOUND');
        expect(err.retryable).toBe(false);
        expect(err.details).toEqual({ id: 'run-123' });
      }
      expect(client.getPendingCount()).toBe(0);
    });

    it('rejects after 10-second timeout if no ack or nack arrives', async () => {
      const { client, getWs } = createClient({ ackTimeoutMs: 10_000 });
      const ws = getWs();
      ws.simulateOpen();

      const promise = client.send({
        type: 'session.send',
        sessionId: 's1',
        text: 'will timeout',
        attachmentIds: [],
      });

      expect(client.getPendingCount()).toBe(1);

      // Advance 9.9s -> still pending
      vi.advanceTimersByTime(9_900);
      expect(client.getPendingCount()).toBe(1);

      // Advance past 10s
      vi.advanceTimersByTime(200);

      await expect(promise).rejects.toThrow('Request timed out after 10000ms');
      expect(client.getPendingCount()).toBe(0);
    });
  });

  // -------------------------------------------------------------
  // 5) offlineQueue 离线排队与重连后发送
  // -------------------------------------------------------------
  describe('5) Offline Queueing', () => {
    it('queues send() requests while connecting and sends them after open', async () => {
      const { client, getWs } = createClient();
      expect(client.getStatus()).toBe('connecting');

      const promise = client.send({
        type: 'session.send',
        sessionId: 's1',
        text: 'queued message',
        attachmentIds: [],
      });

      expect(client.getOfflineQueueCount()).toBe(1);
      const ws = getWs();
      expect(ws.sentMessages).toHaveLength(0);

      // Now open connection
      ws.simulateOpen();
      expect(client.getOfflineQueueCount()).toBe(0);

      const sent = ws.getAllSent();
      const sendFrames = sent.filter((m) => m.type === 'session.send');
      expect(sendFrames).toHaveLength(1);
      expect(sendFrames[0].text).toBe('queued message');

      // Server responds with ack
      ws.simulateMessage({
        type: 'ack',
        requestId: sendFrames[0].requestId,
        runId: 'run-queued',
      });

      const res = await promise;
      expect(res).toEqual({ runId: 'run-queued' });
    });

    it('drops timed-out items from offline queue if timeout expires before open', async () => {
      const { client, getWs } = createClient({ ackTimeoutMs: 10_000 });
      const promise = client.send({
        type: 'session.send',
        sessionId: 's1',
        text: 'will expire offline',
        attachmentIds: [],
      });

      expect(client.getOfflineQueueCount()).toBe(1);

      // 10s expires while still disconnected
      vi.advanceTimersByTime(10_001);

      await expect(promise).rejects.toThrow('Request timed out after 10000ms');
      expect(client.getOfflineQueueCount()).toBe(0);

      // Connect afterwards, no message should be sent
      const ws = getWs();
      ws.simulateOpen();
      expect(ws.getAllSent().filter((m) => m.type === 'session.send')).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------
  // 6) close() 时 reject 所有 pending/queued 请求，且 closed 状态再调用抛错
  // -------------------------------------------------------------
  describe('6) Lifecycle close() and Closed State Protection', () => {
    it('rejects all pending and offline requests on close()', async () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      const p1 = client.send({
        type: 'session.send',
        sessionId: 's1',
        text: 'in flight',
        attachmentIds: [],
      });

      // Disconnect and queue p2
      ws.simulateClose();
      const p2 = client.send({
        type: 'session.send',
        sessionId: 's1',
        text: 'in queue',
        attachmentIds: [],
      });

      expect(client.getPendingCount()).toBe(2);
      expect(client.getOfflineQueueCount()).toBe(1);

      client.close();
      expect(client.getStatus()).toBe('closed');
      expect(client.getPendingCount()).toBe(0);
      expect(client.getOfflineQueueCount()).toBe(0);

      await expect(p1).rejects.toThrow('WsClient closed');
      await expect(p2).rejects.toThrow('WsClient closed');
    });

    it('clears subscriptions, listeners, resubscribing flags, and timers on close()', () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      const onStatus = vi.fn();
      const onGlobal = vi.fn();
      client.onStatusChange(onStatus);
      client.onGlobalEvent(onGlobal);
      client.subscribe('s1', () => {});

      // Trigger gap so s1 is added to resubscribingSessionIds
      ws.simulateMessage({
        type: 'event',
        envelope: {
          seq: 5,
          sessionId: 's1',
          runId: 'r1',
          ts: '2026-09-28T00:00:00Z',
          event: { type: 'message.delta', messageId: 'm1', text: '5' },
        },
      });

      expect(client.getSubscriptions()).toContain('s1');

      client.close();

      expect(client.getStatus()).toBe('closed');
      expect(client.getSubscriptions()).toHaveLength(0);
      expect((client as any).statusListeners.size).toBe(0);
      expect((client as any).globalListeners.size).toBe(0);
      expect((client as any).resubscribingSessionIds.size).toBe(0);
      expect((client as any).heartbeatTimer).toBeNull();
      expect((client as any).reconnectTimer).toBeNull();
    });

    it('rejects new send() and throws on subscribe() when closed', async () => {
      const { client } = createClient();
      client.close();

      expect(() => {
        client.subscribe('s1', () => {});
      }).toThrow('WsClient closed');

      await expect(
        client.send({
          type: 'session.send',
          sessionId: 's1',
          text: 'fail',
          attachmentIds: [],
        }),
      ).rejects.toThrow('WsClient closed');

      // Calling connect does nothing
      client.connect();
      expect(client.getStatus()).toBe('closed');
    });
  });

  // -------------------------------------------------------------
  // 7) 跳号检测触发重新订阅；重复 seq 丢弃与重订风暴防范
  // -------------------------------------------------------------
  describe('7) Sequence Alignment: In-order, Duplicate & Gap Handling', () => {
    it('processes in-order events and increments lastSeq', async () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      const events: SessionEventEnvelope[] = [];
      client.subscribe('s1', (envelope) => {
        events.push(envelope);
      });

      // Seq 1
      ws.simulateMessage({
        type: 'event',
        envelope: {
          seq: 1,
          sessionId: 's1',
          runId: 'r1',
          ts: '2026-09-28T00:00:00Z',
          event: { type: 'message.delta', messageId: 'm1', text: '1' },
        },
      });

      expect(client.getLastSeq('s1')).toBe(1);
      await flushMicrotasks();
      expect(events).toHaveLength(1);
      expect(events[0].seq).toBe(1);

      // Seq 2
      ws.simulateMessage({
        type: 'event',
        envelope: {
          seq: 2,
          sessionId: 's1',
          runId: 'r1',
          ts: '2026-09-28T00:00:01Z',
          event: { type: 'message.delta', messageId: 'm1', text: '2' },
        },
      });

      expect(client.getLastSeq('s1')).toBe(2);
      await flushMicrotasks();
      expect(events).toHaveLength(2);
      expect(events[1].seq).toBe(2);
    });

    it('discards duplicate events (seq <= lastSeq)', async () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      const events: SessionEventEnvelope[] = [];
      client.subscribe('s1', (envelope) => {
        events.push(envelope);
      });

      // Send seq 1
      ws.simulateMessage({
        type: 'event',
        envelope: {
          seq: 1,
          sessionId: 's1',
          runId: 'r1',
          ts: '2026-09-28T00:00:00Z',
          event: { type: 'message.delta', messageId: 'm1', text: '1' },
        },
      });
      await flushMicrotasks();
      expect(events).toHaveLength(1);

      // Duplicate seq 1
      ws.simulateMessage({
        type: 'event',
        envelope: {
          seq: 1,
          sessionId: 's1',
          runId: 'r1',
          ts: '2026-09-28T00:00:00Z',
          event: { type: 'message.delta', messageId: 'm1', text: 'duplicate' },
        },
      });
      await flushMicrotasks();
      expect(events).toHaveLength(1);
      expect(client.getLastSeq('s1')).toBe(1);
    });

    it('detects gap (seq > lastSeq + 1), does not advance lastSeq, and triggers resubscribe from lastSeq', async () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      const events: SessionEventEnvelope[] = [];
      client.subscribe('s1', (envelope) => {
        events.push(envelope);
      });

      // Receive seq 1
      ws.simulateMessage({
        type: 'event',
        envelope: {
          seq: 1,
          sessionId: 's1',
          runId: 'r1',
          ts: '2026-09-28T00:00:00Z',
          event: { type: 'message.delta', messageId: 'm1', text: '1' },
        },
      });
      expect(client.getLastSeq('s1')).toBe(1);

      // Next receive seq 4 (gap: skipped 2 and 3)
      ws.simulateMessage({
        type: 'event',
        envelope: {
          seq: 4,
          sessionId: 's1',
          runId: 'r1',
          ts: '2026-09-28T00:00:03Z',
          event: { type: 'message.delta', messageId: 'm1', text: '4' },
        },
      });

      // lastSeq remains 1
      expect(client.getLastSeq('s1')).toBe(1);

      // Client must send subscribe frame requesting replay from lastSeq 1
      const lastSent = ws.getLastSent();
      expect(lastSent).toEqual({
        type: 'session.subscribe',
        sessionIds: ['s1'],
        lastSeq: { s1: 1 },
      });

      await flushMicrotasks();
      // Callback should NOT have been invoked for seq 4
      expect(events).toHaveLength(1);
    });

    it('prevents resubscribe storm: deduplicates resubscribe requests when multiple gap events arrive before subscribed', async () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      const events: SessionEventEnvelope[] = [];
      client.subscribe('s1', (envelope) => {
        events.push(envelope);
      });

      // Clear the initial subscribe frame
      expect(ws.getAllSent().filter((m) => m.type === 'session.subscribe')).toHaveLength(1);

      // Normal event seq 1
      ws.simulateMessage({
        type: 'event',
        envelope: {
          seq: 1,
          sessionId: 's1',
          runId: 'r1',
          ts: '2026-09-28T00:00:00Z',
          event: { type: 'message.delta', messageId: 'm1', text: '1' },
        },
      });
      expect(client.getLastSeq('s1')).toBe(1);

      // Gap event 1: seq 4 (missing 2 and 3) -> should trigger session.subscribe
      ws.simulateMessage({
        type: 'event',
        envelope: {
          seq: 4,
          sessionId: 's1',
          runId: 'r1',
          ts: '2026-09-28T00:00:03Z',
          event: { type: 'message.delta', messageId: 'm1', text: '4' },
        },
      });

      // Gap event 2: seq 5 (still gapped, before subscribed arrived) -> should NOT send another session.subscribe
      ws.simulateMessage({
        type: 'event',
        envelope: {
          seq: 5,
          sessionId: 's1',
          runId: 'r1',
          ts: '2026-09-28T00:00:04Z',
          event: { type: 'message.delta', messageId: 'm1', text: '5' },
        },
      });

      // Gap event 3: seq 6 (still gapped) -> should NOT send another session.subscribe
      ws.simulateMessage({
        type: 'event',
        envelope: {
          seq: 6,
          sessionId: 's1',
          runId: 'r1',
          ts: '2026-09-28T00:00:05Z',
          event: { type: 'message.delta', messageId: 'm1', text: '6' },
        },
      });

      // Total session.subscribe frames sent: 1 (initial) + 1 (resubscribe) = 2
      const subFrames = ws.getAllSent().filter((m) => m.type === 'session.subscribe');
      expect(subFrames).toHaveLength(2);
      expect(subFrames[1]).toEqual({
        type: 'session.subscribe',
        sessionIds: ['s1'],
        lastSeq: { s1: 1 },
      });

      // Now server responds with replayed event seq 2 and subscribed
      ws.simulateMessage({
        type: 'event',
        envelope: {
          seq: 2,
          sessionId: 's1',
          runId: 'r1',
          ts: '2026-09-28T00:00:01Z',
          event: { type: 'message.delta', messageId: 'm1', text: '2' },
        },
      });
      ws.simulateMessage({
        type: 'subscribed',
        sessionId: 's1',
        latestSeq: 2,
        activeRunId: null,
      });

      // Resubscribe flag is now cleared. If another gap event arrives (e.g. seq 8), it can resubscribe again
      ws.simulateMessage({
        type: 'event',
        envelope: {
          seq: 8,
          sessionId: 's1',
          runId: 'r1',
          ts: '2026-09-28T00:00:07Z',
          event: { type: 'message.delta', messageId: 'm1', text: '8' },
        },
      });

      const subFramesAfter = ws.getAllSent().filter((m) => m.type === 'session.subscribe');
      expect(subFramesAfter).toHaveLength(3);
      expect(subFramesAfter[2]).toEqual({
        type: 'session.subscribe',
        sessionIds: ['s1'],
        lastSeq: { s1: 2 },
      });
    });
  });

  // -------------------------------------------------------------
  // 8) subscribed 帧 latestSeq 比较、onReset 与异常值保护
  // -------------------------------------------------------------
  describe('8) Subscribed Frame Handling & onReset', () => {
    it('triggers onReset and resets lastSeq to 0 without client-side resubscribe when latestSeq < localLastSeq', async () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      const onReset = vi.fn();
      const onEvent = vi.fn();

      client.subscribe(
        's1',
        { onEvent, onReset },
        { initialLastSeq: 50 }, // Local starts with 50
      );
      expect(client.getLastSeq('s1')).toBe(50);

      // Server says its latestSeq is only 20 (< 50)
      ws.simulateMessage({
        type: 'subscribed',
        sessionId: 's1',
        latestSeq: 20,
        activeRunId: 'run-active',
      });

      // localLastSeq reset to 0
      expect(client.getLastSeq('s1')).toBe(0);
      expect(client.getActiveRunId('s1')).toBe('run-active');

      await flushMicrotasks();
      expect(onReset).toHaveBeenCalledTimes(1);

      // ★ A-2: WS 自身不发起 session.subscribe，重载完全交给上层 session.store
      const subscribeFrames = ws.getAllSent().filter((m) => m.type === 'session.subscribe');
      expect(subscribeFrames).toHaveLength(1); // 仅有初始订阅的 1 次
    });

    it('does not advance local lastSeq or resubscribe when latestSeq > localLastSeq (live events still in flight)', () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      client.subscribe('s1', () => {});
      expect(client.getLastSeq('s1')).toBe(0);
      expect(ws.getAllSent().filter((m) => m.type === 'session.subscribe')).toHaveLength(1);

      // Server returns subscribed with latestSeq: 100 > local lastSeq (0)
      ws.simulateMessage({
        type: 'subscribed',
        sessionId: 's1',
        latestSeq: 100,
        activeRunId: null,
      });

      // local lastSeq must NOT be advanced directly to 100
      expect(client.getLastSeq('s1')).toBe(0);

      // subscribed arrives after replay, so no extra subscribe frame is sent
      expect(ws.getAllSent().filter((m) => m.type === 'session.subscribe')).toHaveLength(1);
    });

    it('leaves gap detection to event seq after subscribed, and sends only one resubscribe per gap', () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      client.subscribe('s1', () => {}, { initialLastSeq: 10 });
      expect(client.getLastSeq('s1')).toBe(10);
      expect(ws.getAllSent().filter((m) => m.type === 'session.subscribe')).toHaveLength(1);

      // Subscribed arrives with latestSeq: 20 > 10
      ws.simulateMessage({
        type: 'subscribed',
        sessionId: 's1',
        latestSeq: 20,
        activeRunId: null,
      });

      // Local lastSeq stays 10 and no resubscribe yet
      expect(client.getLastSeq('s1')).toBe(10);
      expect(ws.getAllSent().filter((m) => m.type === 'session.subscribe')).toHaveLength(1);

      // A real gap (seq 21 while holding 10) triggers exactly one resubscribe from 10
      ws.simulateMessage({
        type: 'event',
        envelope: {
          seq: 21,
          sessionId: 's1',
          runId: 'r1',
          ts: '2026-09-28T00:00:00Z',
          event: { type: 'message.delta', messageId: 'm1', text: 'gap' },
        },
      });

      const subFrames = ws.getAllSent().filter((m) => m.type === 'session.subscribe');
      expect(subFrames).toHaveLength(2);
      expect(subFrames[1]).toEqual({
        type: 'session.subscribe',
        sessionIds: ['s1'],
        lastSeq: { s1: 10 },
      });

      // Further gap events before the next subscribed must not send more subscribe frames
      ws.simulateMessage({
        type: 'event',
        envelope: {
          seq: 22,
          sessionId: 's1',
          runId: 'r1',
          ts: '2026-09-28T00:00:00Z',
          event: { type: 'message.delta', messageId: 'm1', text: 'gap' },
        },
      });

      expect(ws.getAllSent().filter((m) => m.type === 'session.subscribe')).toHaveLength(2);
      expect(client.getLastSeq('s1')).toBe(10);
    });

    it('ignores invalid latestSeq (NaN, negative, undefined, null) without corrupting local lastSeq', () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      client.subscribe('s1', () => {}, { initialLastSeq: 10 });
      expect(client.getLastSeq('s1')).toBe(10);

      // NaN
      ws.simulateMessage({
        type: 'subscribed',
        sessionId: 's1',
        latestSeq: NaN,
        activeRunId: null,
      });
      expect(client.getLastSeq('s1')).toBe(10);

      // Negative
      ws.simulateMessage({
        type: 'subscribed',
        sessionId: 's1',
        latestSeq: -5,
        activeRunId: null,
      });
      expect(client.getLastSeq('s1')).toBe(10);

      // String/null/undefined
      ws.simulateMessage({
        type: 'subscribed',
        sessionId: 's1',
        latestSeq: null as any,
        activeRunId: null,
      });
      expect(client.getLastSeq('s1')).toBe(10);
    });
  });

  // -------------------------------------------------------------
  // 9) 畸形消息与容错健壮性
  // -------------------------------------------------------------
  describe('9) Robustness to Malformed Messages & Callback Errors', () => {
    it('safely ignores JSON parse errors without throwing', () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      expect(() => {
        ws.simulateMessage('{ invalid json string ...');
      }).not.toThrow();

      expect(client.getStatus()).toBe('open');
    });

    it('safely ignores non-object or null messages', () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      expect(() => {
        ws.simulateMessage('null');
        ws.simulateMessage('12345');
        ws.simulateMessage('\"a string\"');
        ws.simulateMessage('[1, 2, 3]');
      }).not.toThrow();

      expect(client.getStatus()).toBe('open');
    });

    it('handles user callback throwing exceptions without crashing client or breaking other listeners', async () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const buggyListener = vi.fn().mockImplementation(() => {
        throw new Error('Exploding user callback');
      });
      const safeListener = vi.fn();

      client.subscribe('s1', buggyListener);
      client.subscribe('s1', safeListener);

      ws.simulateMessage({
        type: 'event',
        envelope: {
          seq: 1,
          sessionId: 's1',
          runId: 'r1',
          ts: '2026-09-28T00:00:00Z',
          event: { type: 'message.done', messageId: 'm1' },
        },
      });

      await flushMicrotasks();

      expect(buggyListener).toHaveBeenCalledTimes(1);
      expect(safeListener).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('handles onReset callback throwing without crashing', async () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      client.subscribe(
        's1',
        {
          onReset: () => {
            throw new Error('Crash in reset');
          },
        },
        { initialLastSeq: 20 },
      );

      ws.simulateMessage({
        type: 'subscribed',
        sessionId: 's1',
        latestSeq: 5,
        activeRunId: null,
      });

      await flushMicrotasks();
      expect(client.getLastSeq('s1')).toBe(0);
      consoleSpy.mockRestore();
    });

    it('handles global event dispatching safely', async () => {
      const { client, getWs } = createClient();
      const ws = getWs();
      ws.simulateOpen();

      const received: GlobalEvent[] = [];
      const unsub = client.onGlobalEvent((ev) => {
        received.push(ev);
      });

      ws.simulateMessage({
        type: 'global',
        event: {
          type: 'account.changed',
          whoami: {
            account: 'test@example.com',
            tier: 'pro',
            workspace: '/ws',
          },
        },
      });

      await flushMicrotasks();
      expect(received).toHaveLength(1);
      expect(received[0].type).toBe('account.changed');

      unsub();
      ws.simulateMessage({
        type: 'global',
        event: {
          type: 'session.deleted',
          sessionId: 's1',
        },
      });
      await flushMicrotasks();
      expect(received).toHaveLength(1);
    });

    it('catches ws.send() throwing exceptions, rejects the request, and triggers reconnect', async () => {
      const { client, getWs } = createClient({ jitter: 0 });
      const ws = getWs();
      ws.simulateOpen();

      // Mock ws.send to throw
      vi.spyOn(ws, 'send').mockImplementation(() => {
        throw new Error('Socket write failure');
      });

      const promise = client.send({
        type: 'session.send',
        sessionId: 's1',
        text: 'fail',
        attachmentIds: [],
      });

      await expect(promise).rejects.toThrow('Socket write failure');
      expect(client.getStatus()).toBe('reconnecting');
    });

    it('status change listener notifies subscribers', async () => {
      const { client, getWs } = createClient();
      const statuses: string[] = [];
      client.onStatusChange((st) => statuses.push(st));

      const ws = getWs();
      ws.simulateOpen();
      await flushMicrotasks();

      expect(statuses).toContain('open');
    });
  });

  // -------------------------------------------------------------
  // 10) 懒连接：第一次 subscribe() 或 send() 时触发连接
  // -------------------------------------------------------------
  describe('10) Lazy Connection & Singleton Behavior', () => {
    it('does not initiate WebSocket connection on creation when lazy option is enabled', () => {
      const initialWsCount = MockWebSocket.instances.length;
      const client = new WsClient({
        WebSocketClass: MockWebSocket,
        url: 'ws://127.0.0.1:8790/ws',
        lazy: true,
      });

      expect(client.getStatus()).toBe('closed');
      expect(MockWebSocket.instances.length).toBe(initialWsCount);

      // Triggers connection on subscribe()
      client.subscribe('s-lazy-sub', () => {});
      expect(client.getStatus()).toBe('connecting');
      expect(MockWebSocket.instances.length).toBe(initialWsCount + 1);

      client.close();
    });

    it('triggers connection on send() when lazy option is enabled', async () => {
      const initialWsCount = MockWebSocket.instances.length;
      const client = new WsClient({
        WebSocketClass: MockWebSocket,
        url: 'ws://127.0.0.1:8790/ws',
        lazy: true,
      });

      expect(client.getStatus()).toBe('closed');
      expect(MockWebSocket.instances.length).toBe(initialWsCount);

      // Triggers connection on send()
      const sendPromise = client.send({
        type: 'session.send',
        sessionId: 's-lazy-send',
        text: 'lazy hello',
        attachmentIds: [],
      });

      expect(client.getStatus()).toBe('connecting');
      expect(MockWebSocket.instances.length).toBe(initialWsCount + 1);

      const ws = MockWebSocket.instances[MockWebSocket.instances.length - 1];
      ws.simulateOpen();

      const lastSent = ws.getLastSent();
      expect(lastSent.type).toBe('session.send');
      expect(lastSent.text).toBe('lazy hello');

      ws.simulateMessage({
        type: 'ack',
        requestId: lastSent.requestId,
        runId: 'r-lazy',
      });

      await expect(sendPromise).resolves.toEqual({ runId: 'r-lazy' });
      client.close();
    });
  });

  // -------------------------------------------------------------
  // Default singleton helpers test
  // -------------------------------------------------------------
  describe('Singleton wsClient and standalone exports', () => {
    it('exports wsClient singleton and standalone methods', () => {
      expect(wsClient).toBeInstanceOf(WsClient);
      expect(typeof wsSubscribe).toBe('function');
      expect(typeof wsUnsubscribe).toBe('function');
      expect(typeof wsSend).toBe('function');
      expect(typeof onStatusChange).toBe('function');
      expect(typeof onGlobalEvent).toBe('function');
      expect(typeof wsClose).toBe('function');
    });
  });
});
