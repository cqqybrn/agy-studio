import { create } from 'zustand';
import type {
  AgentMode,
  ApiEndpoints,
  CreateSessionBody,
  Effort,
  ImportSessionsBody,
  ISODateString,
  Run,
  RunStatus,
  Session,
  SessionEventEnvelope,
  SessionStatus,
} from '@agy-studio/contracts';
import {
  createSession as apiCreateSession,
  deleteSession as apiDeleteSession,
  getSessionEvents,
  getSessions,
  importSessions as apiImportSessions,
  updateSession as apiUpdateSession,
} from '../api/endpoints';
import { wsClient } from '../api/ws';
import type { TimelineState } from '../domain/timeline.types';
import { createInitialTimelineState, reduce, reduceAll } from '../domain/timelineReducer';

export interface SessionSlot {
  events: SessionEventEnvelope[];
  timeline: TimelineState;
  lastSeq: number;
  /** Always mirrors `timeline.activeRunId`; only run.started / run.completed change it. */
  activeRunId: string | null;
  /** runId acked by `session.send` whose run.started has not arrived yet. */
  pendingRunId: string | null;
  loading: boolean;
  error: string | null;
}

export interface SendMessageOptions {
  attachmentIds?: string[];
  model?: string;
  effort?: Effort;
  mode?: AgentMode;
  requestId?: string;
}

export interface SessionState {
  slots: Record<string, SessionSlot>;
  activeSessionId: string | null;
  list: Session[];
  listLoading: boolean;
  listError: string | null;

  setActiveSessionId: (sessionId: string | null) => void;
  fetchSessions: (query?: ApiEndpoints['GET /api/sessions']['query']) => Promise<Session[]>;
  openSession: (sessionId: string) => Promise<void>;
  closeSession: (sessionId: string) => void;
  send: (
    sessionId: string,
    text: string,
    options?: SendMessageOptions,
  ) => Promise<{ runId?: string }>;
  abort: (sessionId: string, runId: string) => Promise<{ runId?: string }>;

  handleLiveEvent: (sessionId: string, envelope: SessionEventEnvelope) => void;
  handleSlotReset: (sessionId: string) => void;
  handleSessionUpserted: (session: Session) => void;
  handleSessionDeleted: (sessionId: string) => void;
  handleRunStatus: (run: Pick<Run, 'id' | 'sessionId'> & { status: RunStatus }) => void;
  createSession: (body: CreateSessionBody) => Promise<Session>;
  renameSession: (sessionId: string, title: string) => Promise<Session>;
  deleteSession: (sessionId: string, purge?: boolean) => Promise<void>;
  importSessions: (body: ImportSessionsBody) => Promise<Session[]>;
}

export function createEmptySlot(loading = false): SessionSlot {
  return {
    events: [],
    timeline: createInitialTimelineState(),
    lastSeq: 0,
    activeRunId: null,
    pendingRunId: null,
    loading,
    error: null,
  };
}

// Active WebSocket subscriptions map to avoid leaking subscribers across re-opens.
const activeSubscriptions = new Map<string, () => void>();

// Bumped on every openSession / closeSession so an in-flight openSession can
// tell it has been superseded or cancelled after each await.
const openGenerations = new Map<string, number>();

function nextGeneration(sessionId: string): number {
  const gen = (openGenerations.get(sessionId) ?? 0) + 1;
  openGenerations.set(sessionId, gen);
  return gen;
}

function releaseSubscription(sessionId: string): void {
  const unsub = activeSubscriptions.get(sessionId);
  if (!unsub) return;
  try {
    unsub();
  } catch {
    // ignore
  }
  activeSubscriptions.delete(sessionId);
}

function resolvePendingRunId(
  pendingRunId: string | null,
  envelope: SessionEventEnvelope,
): string | null {
  if (pendingRunId === null) return null;
  const { event } = envelope;
  if (event.type === 'run.started' && event.runId === pendingRunId) return null;
  if (event.type === 'run.completed' && envelope.runId === pendingRunId) return null;
  return pendingRunId;
}

export function clearActiveSubscriptions(): void {
  for (const unsub of activeSubscriptions.values()) {
    try {
      unsub();
    } catch {
      // ignore
    }
  }
  activeSubscriptions.clear();
  openGenerations.clear();
}

export const useSessionStore = create<SessionState>()((set, get) => ({
  slots: {},
  activeSessionId: null,
  list: [],
  listLoading: false,
  listError: null,

  setActiveSessionId: (sessionId: string | null) => {
    set({ activeSessionId: sessionId });
    if (sessionId) {
      const slot = get().slots[sessionId];
      const needsOpen =
        !slot ||
        (!slot.loading && (slot.error !== null || !activeSubscriptions.has(sessionId)));
      if (needsOpen) {
        void get().openSession(sessionId);
      }
    }
  },

  fetchSessions: async (query?: ApiEndpoints['GET /api/sessions']['query']) => {
    set({ listLoading: true, listError: null });
    try {
      const page = await getSessions(query);
      set({ list: page.items, listLoading: false });
      return page.items;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ listLoading: false, listError: msg });
      return [];
    }
  },

  openSession: async (sessionId: string) => {
    const generation = nextGeneration(sessionId);
    const isCurrent = () => openGenerations.get(sessionId) === generation;

    // ★ 修复 A-1：在 HTTP 拉取前立即断开旧订阅，阻止脏事件干扰
    releaseSubscription(sessionId);

    // Initialize or mark slot as loading
    set((state) => {
      const existing = state.slots[sessionId];
      return {
        slots: {
          ...state.slots,
          [sessionId]: existing
            ? { ...existing, loading: true, error: null }
            : createEmptySlot(true),
        },
      };
    });

    let allEvents: SessionEventEnvelope[] = [];
    let afterSeq = 0;
    let hasMore = true;

    try {
      while (hasMore) {
        const res = await getSessionEvents(sessionId, { afterSeq, limit: 100 });
        if (!isCurrent()) return;
        if (res.items && res.items.length > 0) {
          allEvents.push(...res.items);
          afterSeq = res.items[res.items.length - 1].seq;
        }
        hasMore = Boolean(res.hasMore && res.items.length > 0);
        if (!res.items || res.items.length === 0) {
          break;
        }
      }

      const timeline = reduceAll(allEvents);
      const lastSeq = allEvents.length > 0 ? allEvents[allEvents.length - 1].seq : 0;
      const activeRunId = timeline.activeRunId;

      set((state) => {
        let pendingRunId = state.slots[sessionId]?.pendingRunId ?? null;
        for (const envelope of allEvents) {
          pendingRunId = resolvePendingRunId(pendingRunId, envelope);
        }
        return {
          slots: {
            ...state.slots,
            [sessionId]: {
              events: allEvents,
              timeline,
              lastSeq,
              activeRunId,
              pendingRunId,
              loading: false,
              error: null,
            },
          },
        };
      });

      // ★ 旧的 releaseSubscription 已移到顶部，这里直接建新订阅
      // 服务端会从 lastSeq 之后补发 HTTP 期间产生的新事件
      const unsub = wsClient.subscribe(
        sessionId,
        {
          onEvent: (envelope) => {
            get().handleLiveEvent(sessionId, envelope);
          },
          onReset: () => {
            get().handleSlotReset(sessionId);
          },
        },
        { initialLastSeq: lastSeq },
      );

      activeSubscriptions.set(sessionId, unsub);
    } catch (err: unknown) {
      if (!isCurrent()) return;
      const msg = err instanceof Error ? err.message : String(err);
      set((state) => ({
        slots: {
          ...state.slots,
          [sessionId]: {
            ...(state.slots[sessionId] ?? createEmptySlot()),
            loading: false,
            error: msg,
          },
        },
      }));
    }
  },

  closeSession: (sessionId: string) => {
    nextGeneration(sessionId);
    releaseSubscription(sessionId);
    set((state) => {
      if (!(sessionId in state.slots)) return state;
      const slots = { ...state.slots };
      delete slots[sessionId];
      return { slots };
    });
  },

  send: async (sessionId: string, text: string, options?: SendMessageOptions) => {
    const res = await wsClient.send({
      type: 'session.send',
      sessionId,
      text,
      attachmentIds: options?.attachmentIds ?? [],
      model: options?.model,
      effort: options?.effort,
      mode: options?.mode,
      requestId: options?.requestId,
    });

    const ackedRunId = res.runId;
    if (ackedRunId) {
      set((state) => {
        const slot = state.slots[sessionId];
        if (!slot) return state;
        const alreadyStarted = slot.events.some(
          (e) => e.event.type === 'run.started' && e.event.runId === ackedRunId,
        );
        if (alreadyStarted) return state;
        return {
          slots: {
            ...state.slots,
            [sessionId]: {
              ...slot,
              pendingRunId: ackedRunId,
            },
          },
        };
      });
    }

    return res;
  },

  abort: async (sessionId: string, runId: string) => {
    return await wsClient.send({
      type: 'run.abort',
      runId,
    });
  },

  handleLiveEvent: (sessionId: string, envelope: SessionEventEnvelope) => {
    set((state) => {
      const slot = state.slots[sessionId];
      if (!slot) return state;

      // Discard duplicates if already in slot
      if (envelope.seq <= slot.lastSeq && slot.events.some((e) => e.seq === envelope.seq)) {
        return state;
      }

      const nextEvents = [...slot.events, envelope];
      const nextTimeline = reduce(slot.timeline, envelope);
      const nextLastSeq = Math.max(slot.lastSeq, envelope.seq);
      const nextActiveRunId = nextTimeline.activeRunId;

      return {
        slots: {
          ...state.slots,
          [sessionId]: {
            ...slot,
            events: nextEvents,
            timeline: nextTimeline,
            lastSeq: nextLastSeq,
            activeRunId: nextActiveRunId,
            pendingRunId: resolvePendingRunId(slot.pendingRunId, envelope),
          },
        },
      };
    });
  },

  handleSlotReset: (sessionId: string) => {
    set((state) => ({
      slots: {
        ...state.slots,
        [sessionId]: {
          ...createEmptySlot(true),
          pendingRunId: state.slots[sessionId]?.pendingRunId ?? null,
        },
      },
    }));
    void get().openSession(sessionId);
  },

  handleSessionUpserted: (session: Session) => {
    set((state) => {
      const index = state.list.findIndex((s) => s.id === session.id);
      let nextList: Session[];
      if (index !== -1) {
        nextList = state.list.map((s, i) => (i === index ? session : s));
      } else {
        nextList = [session, ...state.list];
      }
      return { list: nextList };
    });
  },

  handleSessionDeleted: (sessionId: string) => {
    get().closeSession(sessionId);
    set((state) => {
      const nextList = state.list.filter((s) => s.id !== sessionId);
      const nextActiveId = state.activeSessionId === sessionId ? null : state.activeSessionId;
      return {
        list: nextList,
        activeSessionId: nextActiveId,
      };
    });
  },

  handleRunStatus: (run: Pick<Run, 'id' | 'sessionId'> & { status: RunStatus }) => {
    set((state) => {
      const nextList = state.list.map((s) => {
        if (s.id === run.sessionId) {
          const sessionStatus: SessionStatus =
            run.status === 'failed'
              ? 'error'
              : run.status === 'completed' || run.status === 'aborted'
                ? 'idle'
                : 'running';
          return {
            ...s,
            status: sessionStatus,
            lastRunId: run.id,
          };
        }
        return s;
      });
      return { list: nextList };
    });
  },

  createSession: async (body: CreateSessionBody) => {
    const session = await apiCreateSession(body);
    get().handleSessionUpserted(session);
    get().setActiveSessionId(session.id);
    return session;
  },

  renameSession: async (sessionId: string, title: string) => {
    const updated = await apiUpdateSession(sessionId, { title });
    get().handleSessionUpserted(updated);
    return updated;
  },

  deleteSession: async (sessionId: string, purge?: boolean) => {
    await apiDeleteSession(sessionId, { purge });
    get().handleSessionDeleted(sessionId);
  },

  importSessions: async (body: ImportSessionsBody) => {
    const res = await apiImportSessions(body);
    for (const session of res.imported) {
      get().handleSessionUpserted(session);
    }
    return res.imported;
  },
}));
