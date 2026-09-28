import {
  WS_LIMITS,
  WS_PATH,
  type ApiErrorBody,
  type ClientFrame,
  type GlobalEvent,
  type ServerFrame,
  type SessionEventEnvelope,
} from '@agy-studio/contracts';
import { ApiError, getAuthToken } from './http';

export type WsStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export type SessionEventHandler = (envelope: SessionEventEnvelope) => void;

export interface SessionCallbacks {
  onEvent?: SessionEventHandler;
  onReset?: () => void;
}

export type SessionSubscriber = SessionEventHandler | SessionCallbacks;

export type GlobalEventHandler = (event: GlobalEvent) => void;

export type StatusChangeHandler = (status: WsStatus) => void;

export type SendFrameInput =
  | (Omit<Extract<ClientFrame, { type: 'session.send' }>, 'requestId'> & { requestId?: string })
  | (Omit<Extract<ClientFrame, { type: 'run.abort' }>, 'requestId'> & { requestId?: string });

export interface WsClientOptions {
  url?: string | (() => string);
  token?: string | null | (() => string | null);
  autoConnect?: boolean;
  lazy?: boolean;
  heartbeatIntervalMs?: number;
  reconnectBaseMs?: number;
  reconnectMaxMs?: number;
  ackTimeoutMs?: number;
  jitter?: number | (() => number);
  WebSocketClass?: any;
  isPageHidden?: () => boolean;
}

interface SessionSubscription {
  sessionId: string;
  lastSeq: number;
  activeRunId: string | null;
  entries: Map<number, SessionSubscriber>;
}

interface PendingRequest {
  requestId: string;
  frame: ClientFrame & { requestId: string };
  resolve: (res: { runId?: string }) => void;
  reject: (err: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
  createdAt: number;
}

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export class WsClient {
  private status: WsStatus = 'connecting';
  private ws: WebSocket | null = null;
  private readonly options: WsClientOptions;
  private isClosed = false;

  private nextSubId = 0;
  private readonly subscriptions = new Map<string, SessionSubscription>();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private offlineQueue: PendingRequest[] = [];
  private readonly resubscribingSessionIds = new Set<string>();

  private readonly statusListeners = new Set<StatusChangeHandler>();
  private readonly globalListeners = new Set<GlobalEventHandler>();

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private missedHeartbeats = 0;
  private pongReceivedInCycle = false;

  readonly heartbeatIntervalMs: number;
  readonly reconnectBaseMs: number;
  readonly reconnectMaxMs: number;
  readonly ackTimeoutMs: number;

  constructor(options: WsClientOptions = {}) {
    this.options = options;
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? WS_LIMITS.heartbeatIntervalMs;
    this.reconnectBaseMs = options.reconnectBaseMs ?? WS_LIMITS.reconnectBaseMs;
    this.reconnectMaxMs = options.reconnectMaxMs ?? WS_LIMITS.reconnectMaxMs;
    this.ackTimeoutMs = options.ackTimeoutMs ?? 10_000;

    if (options.lazy) {
      this.status = 'closed';
    } else if (options.autoConnect !== false) {
      this.connect();
    } else {
      this.status = 'closed';
    }
  }

  public getStatus(): WsStatus {
    return this.status;
  }

  public getLastSeq(sessionId: string): number | undefined {
    return this.subscriptions.get(sessionId)?.lastSeq;
  }

  public getActiveRunId(sessionId: string): string | null | undefined {
    return this.subscriptions.get(sessionId)?.activeRunId;
  }

  public getSubscriptions(): string[] {
    return Array.from(this.subscriptions.keys());
  }

  public getPendingCount(): number {
    return this.pendingRequests.size;
  }

  public getOfflineQueueCount(): number {
    return this.offlineQueue.length;
  }

  public getReconnectAttempt(): number {
    return this.reconnectAttempt;
  }

  public onStatusChange(handler: StatusChangeHandler): () => void {
    this.statusListeners.add(handler);
    return () => {
      this.statusListeners.delete(handler);
    };
  }

  public onGlobalEvent(handler: GlobalEventHandler): () => void {
    this.globalListeners.add(handler);
    return () => {
      this.globalListeners.delete(handler);
    };
  }

  public connect(): void {
    if (this.isClosed) {
      return;
    }

    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
      return;
    }

    this.clearReconnectTimer();
    this.setStatus('connecting');

    const WS = this.options.WebSocketClass ?? (typeof WebSocket !== 'undefined' ? WebSocket : null);
    if (!WS) {
      return;
    }

    const url = this.resolveUrl();
    try {
      const ws = new WS(url);
      this.ws = ws;

      ws.onopen = () => this.handleOpen();
      ws.onclose = () => this.handleClose();
      ws.onerror = () => this.handleError();
      ws.onmessage = (event: MessageEvent) => this.handleMessage(event.data);
    } catch {
      this.handleConnectionFailure();
    }
  }

  private ensureConnected(): void {
    if (this.isClosed) return;
    if (this.options.autoConnect === false && !this.options.lazy) {
      return;
    }
    if (this.ws || this.status === 'connecting' || this.status === 'open' || this.status === 'reconnecting') {
      return;
    }
    this.connect();
  }

  public subscribe(
    sessionId: string,
    callbacks: SessionSubscriber,
    options?: { initialLastSeq?: number },
  ): () => void {
    if (this.isClosed) {
      throw new Error('WsClient closed');
    }

    this.ensureConnected();

    let sub = this.subscriptions.get(sessionId);
    const isNew = !sub;

    if (!sub) {
      const initialLastSeq =
        typeof options?.initialLastSeq === 'number' &&
        !Number.isNaN(options.initialLastSeq) &&
        options.initialLastSeq >= 0
          ? options.initialLastSeq
          : 0;

      sub = {
        sessionId,
        lastSeq: initialLastSeq,
        activeRunId: null,
        entries: new Map<number, SessionSubscriber>(),
      };
      this.subscriptions.set(sessionId, sub);
    }

    const subId = ++this.nextSubId;
    sub.entries.set(subId, callbacks);

    if (isNew && this.status === 'open') {
      this.sendRaw({
        type: 'session.subscribe',
        sessionIds: [sessionId],
        lastSeq: { [sessionId]: sub.lastSeq },
      });
    }

    let unsubscribed = false;
    return () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.removeSubscriptionEntry(sessionId, subId);
    };
  }

  private removeSubscriptionEntry(sessionId: string, subId: number): void {
    const sub = this.subscriptions.get(sessionId);
    if (!sub) return;

    sub.entries.delete(subId);

    if (sub.entries.size === 0) {
      this.subscriptions.delete(sessionId);
      this.resubscribingSessionIds.delete(sessionId);
      if (this.status === 'open') {
        this.sendRaw({
          type: 'session.unsubscribe',
          sessionIds: [sessionId],
        });
      }
    }
  }

  public unsubscribe(sessionId: string, subscriber?: SessionSubscriber): void {
    const sub = this.subscriptions.get(sessionId);
    if (!sub) return;

    if (!subscriber) {
      sub.entries.clear();
    } else {
      for (const [id, entry] of sub.entries.entries()) {
        if (entry === subscriber) {
          sub.entries.delete(id);
          break;
        }
      }
    }

    if (sub.entries.size === 0) {
      this.subscriptions.delete(sessionId);
      this.resubscribingSessionIds.delete(sessionId);
      if (this.status === 'open') {
        this.sendRaw({
          type: 'session.unsubscribe',
          sessionIds: [sessionId],
        });
      }
    }
  }

  /**
   * 发送客户端请求帧（如 `session.send` 或 `run.abort`）。
   *
   * 返回 Promise，在收到服务端对应的 `ack` 时 resolve，收到 `nack` 时以 ApiError reject。
   * 若请求超时（默认 10 秒）未收到响应，将以超时错误 reject。
   *
   * 注意：断线时已发出但未收到 ack 的请求会在超时后 reject，调用方重试时需自行保证幂等。
   *
   * @param frame 发送内容（若未指定 requestId 将自动生成）
   */
  public send(frame: SendFrameInput): Promise<{ runId?: string }> {
    if (this.isClosed) {
      return Promise.reject(new Error('WsClient closed'));
    }

    this.ensureConnected();

    const requestId = frame.requestId || generateRequestId();
    const fullFrame = {
      ...frame,
      requestId,
    } as ClientFrame & { requestId: string };

    return new Promise<{ runId?: string }>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        const idx = this.offlineQueue.findIndex((item) => item.requestId === requestId);
        if (idx !== -1) {
          this.offlineQueue.splice(idx, 1);
        }
        reject(
          new ApiError('AGY_TIMEOUT', `Request timed out after ${this.ackTimeoutMs}ms`, {
            retryable: true,
          }),
        );
      }, this.ackTimeoutMs);

      const pendingItem: PendingRequest = {
        requestId,
        frame: fullFrame,
        resolve,
        reject,
        timer,
        createdAt: Date.now(),
      };

      this.pendingRequests.set(requestId, pendingItem);

      const WS_OPEN = typeof WebSocket !== 'undefined' ? WebSocket.OPEN : 1;
      if (this.status === 'open' && this.ws && this.ws.readyState === WS_OPEN) {
        try {
          this.ws.send(JSON.stringify(fullFrame));
        } catch (err) {
          clearTimeout(timer);
          this.pendingRequests.delete(requestId);
          reject(err instanceof Error ? err : new Error(String(err)));
          this.handleConnectionFailure();
        }
      } else {
        this.offlineQueue.push(pendingItem);
      }
    });
  }

  public close(): void {
    this.isClosed = true;
    this.setStatus('closed');
    this.stopHeartbeat();
    this.clearReconnectTimer();

    this.resubscribingSessionIds.clear();
    this.subscriptions.clear();
    this.statusListeners.clear();
    this.globalListeners.clear();

    this.cleanupSocket();

    const closeError = new Error('WsClient closed');
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timer);
      try {
        pending.reject(closeError);
      } catch {
        // ignore
      }
    }
    this.pendingRequests.clear();
    this.offlineQueue = [];
  }

  public calculateReconnectDelay(attempt: number, isHidden?: boolean): number {
    const hidden = isHidden ?? this.isPageHidden();
    const base = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * Math.pow(2, attempt));
    const jitter = this.getJitter();
    return base * (hidden ? 4 : 1) + jitter;
  }

  protected getJitter(): number {
    if (typeof this.options.jitter === 'function') {
      return this.options.jitter();
    }
    if (typeof this.options.jitter === 'number') {
      return this.options.jitter;
    }
    return Math.floor(Math.random() * 100);
  }

  protected isPageHidden(): boolean {
    if (this.options.isPageHidden) {
      return this.options.isPageHidden();
    }
    return typeof document !== 'undefined' && document.visibilityState === 'hidden';
  }

  private setStatus(newStatus: WsStatus): void {
    if (this.status === newStatus) return;
    this.status = newStatus;
    for (const listener of this.statusListeners) {
      queueMicrotask(() => {
        try {
          listener(newStatus);
        } catch (err) {
          console.error('Error in onStatusChange listener:', err);
        }
      });
    }
  }

  private resolveUrl(): string {
    if (this.options.url) {
      if (typeof this.options.url === 'function') {
        return this.options.url();
      }
      return this.options.url;
    }

    let token: string | null = null;
    if (this.options.token !== undefined) {
      token = typeof this.options.token === 'function' ? this.options.token() : this.options.token;
    } else {
      token = getAuthToken();
    }

    let base = 'ws://localhost/ws';
    if (typeof window !== 'undefined' && window.location) {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      base = `${protocol}//${window.location.host}${WS_PATH}`;
    }

    if (token) {
      base += (base.includes('?') ? '&' : '?') + `token=${encodeURIComponent(token)}`;
    }
    return base;
  }

  private handleOpen(): void {
    if (this.isClosed) return;
    this.reconnectAttempt = 0;
    this.setStatus('open');
    this.startHeartbeat();
    this.resubscribeAll();
    this.flushOfflineQueue();
  }

  private handleClose(): void {
    this.cleanupSocket();
    if (this.isClosed) return;
    this.triggerReconnect();
  }

  private handleError(): void {
    this.handleConnectionFailure();
  }

  private handleConnectionFailure(): void {
    this.cleanupSocket();
    if (this.isClosed) return;
    this.triggerReconnect();
  }

  private cleanupSocket(): void {
    this.resubscribingSessionIds.clear();
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        this.ws.close();
      } catch {
        // ignore
      }
      this.ws = null;
    }
  }

  private triggerReconnect(): void {
    if (this.isClosed) return;
    this.stopHeartbeat();
    this.clearReconnectTimer();
    this.resubscribingSessionIds.clear();
    this.setStatus('reconnecting');

    const delay = this.calculateReconnectDelay(this.reconnectAttempt);
    this.reconnectAttempt++;

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.missedHeartbeats = 0;
    this.pongReceivedInCycle = true;

    this.heartbeatTimer = setInterval(() => {
      if (this.status !== 'open') return;

      if (!this.pongReceivedInCycle) {
        this.missedHeartbeats++;
        if (this.missedHeartbeats >= 2) {
          this.handleConnectionFailure();
          return;
        }
      } else {
        this.missedHeartbeats = 0;
        this.pongReceivedInCycle = false;
      }

      this.sendRaw({
        type: 'ping',
        ts: Date.now(),
      });
    }, this.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private resubscribeAll(): void {
    if (this.subscriptions.size === 0) return;
    const sessionIds: string[] = [];
    const lastSeq: Record<string, number> = {};

    for (const [sessionId, sub] of this.subscriptions.entries()) {
      if (sub.entries.size > 0) {
        sessionIds.push(sessionId);
        lastSeq[sessionId] = sub.lastSeq;
      }
    }

    if (sessionIds.length > 0) {
      this.sendRaw({
        type: 'session.subscribe',
        sessionIds,
        lastSeq,
      });
    }
  }

  private requestResubscribe(sessionId: string, fromSeq: number): void {
    if (this.resubscribingSessionIds.has(sessionId)) {
      return;
    }
    this.resubscribingSessionIds.add(sessionId);
    const sent = this.sendRaw({
      type: 'session.subscribe',
      sessionIds: [sessionId],
      lastSeq: { [sessionId]: fromSeq },
    });
    if (!sent) {
      this.resubscribingSessionIds.delete(sessionId);
    }
  }

  private flushOfflineQueue(): void {
    const WS_OPEN = typeof WebSocket !== 'undefined' ? WebSocket.OPEN : 1;
    const queue = [...this.offlineQueue];
    this.offlineQueue = [];

    for (const item of queue) {
      if (!this.pendingRequests.has(item.requestId)) {
        continue;
      }

      if (this.status !== 'open' || !this.ws || this.ws.readyState !== WS_OPEN) {
        this.offlineQueue.push(item);
        continue;
      }

      try {
        this.ws.send(JSON.stringify(item.frame));
      } catch (err) {
        clearTimeout(item.timer);
        this.pendingRequests.delete(item.requestId);
        item.reject(err instanceof Error ? err : new Error(String(err)));
        this.handleConnectionFailure();
        break;
      }
    }
  }

  private sendRaw(frame: ClientFrame): boolean {
    const WS_OPEN = typeof WebSocket !== 'undefined' ? WebSocket.OPEN : 1;
    if (this.status !== 'open' || !this.ws || this.ws.readyState !== WS_OPEN) {
      return false;
    }
    try {
      this.ws.send(JSON.stringify(frame));
      return true;
    } catch (err) {
      console.error('Failed to send raw frame:', err);
      this.handleConnectionFailure();
      return false;
    }
  }

  private handleMessage(data: unknown): void {
    let text: string;
    if (typeof data === 'string') {
      text = data;
    } else if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
      text = new TextDecoder().decode(data);
    } else if (typeof data === 'object' && data !== null && 'toString' in data) {
      text = String(data);
    } else {
      return;
    }

    let frame: ServerFrame;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }

    if (!frame || typeof frame !== 'object' || Array.isArray(frame)) {
      return;
    }

    switch (frame.type) {
      case 'pong':
        this.pongReceivedInCycle = true;
        this.missedHeartbeats = 0;
        break;

      case 'ack': {
        const pending = this.pendingRequests.get(frame.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(frame.requestId);
          pending.resolve({ runId: frame.runId });
        }
        break;
      }

      case 'nack': {
        const pending = this.pendingRequests.get(frame.requestId);
        if (pending) {
          clearTimeout(pending.timer);
          this.pendingRequests.delete(frame.requestId);
          const errorBody: ApiErrorBody = frame.error ?? {
            code: 'INTERNAL',
            message: 'Unknown error',
            retryable: false,
          };
          const err = new ApiError(errorBody.code, errorBody.message, {
            retryable: errorBody.retryable,
            details: errorBody.details,
          });
          pending.reject(err);
        }
        break;
      }

      case 'subscribed': {
        const { sessionId, latestSeq, activeRunId } = frame;
        const sub = this.subscriptions.get(sessionId);
        if (!sub) break;

        this.resubscribingSessionIds.delete(sessionId);

        if (activeRunId !== undefined) {
          sub.activeRunId = activeRunId;
        }

        const isValidSeq =
          typeof latestSeq === 'number' && !Number.isNaN(latestSeq) && latestSeq >= 0;
        if (!isValidSeq) {
          break;
        }

        // The server sends `subscribed` only after replay has finished, so
        // latestSeq > lastSeq just means live events are still in flight;
        // real gaps are caught by the seq check on incoming events.
        if (latestSeq < sub.lastSeq) {
          sub.lastSeq = 0;
          this.notifyReset(sub);
          // ★ 修复 A-2：移除 WS 侧的重订阅，
          // 重载控制权完全交给上层 session.store 的 handleSlotReset → openSession
          // openSession 会重新 subscribe 并通过 initialLastSeq 让服务端补发
        }
        break;
      }

      case 'event': {
        const envelope = frame.envelope;
        if (!envelope || typeof envelope.seq !== 'number' || !envelope.sessionId) {
          break;
        }

        const sub = this.subscriptions.get(envelope.sessionId);
        if (!sub) break;

        const seq = envelope.seq;
        if (seq <= sub.lastSeq) {
          break;
        }

        if (seq > sub.lastSeq + 1) {
          this.requestResubscribe(envelope.sessionId, sub.lastSeq);
          break;
        }

        sub.lastSeq = seq;
        this.notifyEvent(sub, envelope);
        break;
      }

      case 'global': {
        const event = frame.event;
        if (!event) break;
        for (const listener of this.globalListeners) {
          queueMicrotask(() => {
            try {
              listener(event);
            } catch (err) {
              console.error('Error in onGlobalEvent callback:', err);
            }
          });
        }
        break;
      }

      default:
        break;
    }
  }

  private notifyReset(sub: SessionSubscription): void {
    for (const cb of sub.entries.values()) {
      if (typeof cb === 'object' && cb !== null && typeof cb.onReset === 'function') {
        const onReset = cb.onReset;
        queueMicrotask(() => {
          try {
            onReset();
          } catch (err) {
            console.error('Error in onReset callback:', err);
          }
        });
      }
    }
  }

  private notifyEvent(sub: SessionSubscription, envelope: SessionEventEnvelope): void {
    for (const cb of sub.entries.values()) {
      const handler = typeof cb === 'function' ? cb : cb.onEvent;
      if (typeof handler === 'function') {
        queueMicrotask(() => {
          try {
            handler(envelope);
          } catch (err) {
            console.error('Error in onEvent callback:', err);
          }
        });
      }
    }
  }
}

export const wsClient: WsClient = new WsClient({ lazy: true });

export function subscribe(
  sessionId: string,
  callbacks: SessionSubscriber,
  options?: { initialLastSeq?: number },
): () => void {
  return wsClient.subscribe(sessionId, callbacks, options);
}

export function unsubscribe(sessionId: string, callbacks?: SessionSubscriber): void {
  wsClient.unsubscribe(sessionId, callbacks);
}

/**
 * 发送客户端请求帧（如 `session.send` 或 `run.abort`）。
 *
 * 断线时已发出但未收到 ack 的请求会在超时后 reject，调用方重试时需自行保证幂等。
 */
export function send(frame: SendFrameInput): Promise<{ runId?: string }> {
  return wsClient.send(frame);
}

export function onStatusChange(handler: StatusChangeHandler): () => void {
  return wsClient.onStatusChange(handler);
}

export function onGlobalEvent(handler: GlobalEventHandler): () => void {
  return wsClient.onGlobalEvent(handler);
}

export function close(): void {
  wsClient.close();
}

export default wsClient;
