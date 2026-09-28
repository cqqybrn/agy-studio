import { create } from 'zustand';
import type {
  AgentMode,
  ApiEndpoints,
  Effort,
  ISODateString,
  Run,
  RunStatus,
  Session,
  SessionEventEnvelope,
  SessionStatus,
} from '@agy-studio/contracts';
import { getSessionEvents, getSessions } from '../api/endpoints';
import { wsClient } from '../api/ws';
import type { TimelineState } from '../domain/timeline.types';
import { createInitialTimelineState, reduce, reduceAll } from '../domain/timelineReducer';

export interface SessionSlot {
  events: SessionEventEnvelope[];
  timeline: TimelineState;
  lastSeq: number;
  activeRunId: string | null;
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
}

export function createEmptySlot(loading = false): SessionSlot {
  return {
    events: [],
    timeline: createInitialTimelineState(),
    lastSeq: 0,
    activeRunId: null,
    loading,
    error: null,
  };
}

// Active WebSocket subscriptions map to avoid leaking subscribers across re-opens.
const activeSubscriptions = new Map<string, () => void>();

export function clearActiveSubscriptions(): void {
  for (const unsub of activeSubscriptions.values()) {
    try {
      unsub();
    } catch {
      // ignore
    }
  }
  activeSubscriptions.clear();
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
      if (!slot) {
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

      set((state) => ({
        slots: {
          ...state.slots,
          [sessionId]: {
            events: allEvents,
            timeline,
            lastSeq,
            activeRunId,
            loading: false,
            error: null,
          },
        },
      }));

      // Clean up any existing subscription for this session
      const existingUnsub = activeSubscriptions.get(sessionId);
      if (existingUnsub) {
        try {
          existingUnsub();
        } catch {
          // ignore
        }
        activeSubscriptions.delete(sessionId);
      }

      // Subscribe to real-time events via wsClient
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
    const unsub = activeSubscriptions.get(sessionId);
    if (unsub) {
      try {
        unsub();
      } catch {
        // ignore
      }
      activeSubscriptions.delete(sessionId);
    }
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

    if (res.runId) {
      set((state) => {
        const slot = state.slots[sessionId];
        if (!slot) return state;
        return {
          slots: {
            ...state.slots,
            [sessionId]: {
              ...slot,
              activeRunId: res.runId!,
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
          },
        },
      };
    });
  },

  handleSlotReset: (sessionId: string) => {
    set((state) => ({
      slots: {
        ...state.slots,
        [sessionId]: createEmptySlot(true),
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
            run.status === 'running' || run.status === 'starting'
              ? 'running'
              : run.status === 'failed'
                ? 'error'
                : 'idle';
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
}));
