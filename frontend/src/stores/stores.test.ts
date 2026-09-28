import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Account,
  GlobalEvent,
  Prefs,
  QuotaSnapshot,
  Run,
  RunStatus,
  Session,
  SessionEventEnvelope,
  WhoAmI,
  Workspace,
} from '@agy-studio/contracts';

// Mock wsClient module
const mockWsSubscriptions = new Map<string, { callbacks: any; options?: any }>();
const mockStatusListeners = new Set<(status: any) => void>();
const mockGlobalListeners = new Set<(event: any) => void>();

vi.mock('../api/ws', () => {
  const mockWs = {
    getStatus: vi.fn(() => 'open'),
    connect: vi.fn(),
    close: vi.fn(),
    subscribe: vi.fn((sessionId: string, callbacks: any, options?: any) => {
      mockWsSubscriptions.set(sessionId, { callbacks, options });
      return () => {
        mockWsSubscriptions.delete(sessionId);
      };
    }),
    unsubscribe: vi.fn((sessionId: string) => {
      mockWsSubscriptions.delete(sessionId);
    }),
    send: vi.fn(async (frame: any) => {
      if (frame.type === 'session.send') {
        return { runId: 'run-mock-123' };
      }
      if (frame.type === 'run.abort') {
        return { runId: frame.runId };
      }
      return {};
    }),
    onStatusChange: vi.fn((handler: any) => {
      mockStatusListeners.add(handler);
      return () => {
        mockStatusListeners.delete(handler);
      };
    }),
    onGlobalEvent: vi.fn((handler: any) => {
      mockGlobalListeners.add(handler);
      return () => {
        mockGlobalListeners.delete(handler);
      };
    }),
  };

  return {
    wsClient: mockWs,
    subscribe: mockWs.subscribe,
    unsubscribe: mockWs.unsubscribe,
    send: mockWs.send,
    onStatusChange: mockWs.onStatusChange,
    onGlobalEvent: mockWs.onGlobalEvent,
    close: mockWs.close,
  };
});

// Mock endpoints module
vi.mock('../api/endpoints', () => ({
  getSessionEvents: vi.fn(),
  getSessions: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  importSessions: vi.fn(),
  getWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
  getPrefs: vi.fn(),
  updatePrefs: vi.fn(),
  getQuota: vi.fn(),
  getAccounts: vi.fn(),
  switchAccount: vi.fn(),
  saveAccount: vi.fn(),
  deleteAccount: vi.fn(),
}));

import * as endpoints from '../api/endpoints';
import { wsClient } from '../api/ws';
import {
  clearActiveSubscriptions,
  initializeApp,
  useAccountStore,
  useConnectionStore,
  usePrefsStore,
  useQuotaStore,
  useSessionStore,
  useUiStore,
  useWorkspaceStore,
} from './index';

describe('Frontend Stores', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWsSubscriptions.clear();
    mockStatusListeners.clear();
    mockGlobalListeners.clear();
    clearActiveSubscriptions();

    // Reset stores to initial state
    useSessionStore.setState({
      slots: {},
      activeSessionId: null,
      list: [],
      listLoading: false,
      listError: null,
    });
    useWorkspaceStore.setState({
      workspaces: [],
      currentWorkspace: null,
      loading: false,
      error: null,
    });
    usePrefsStore.setState({
      prefs: null,
      loading: false,
      error: null,
    });
    useQuotaStore.setState({
      quota: null,
      loading: false,
      error: null,
    });
    useAccountStore.setState({
      accounts: [],
      whoami: null,
      loading: false,
      error: null,
    });
    useConnectionStore.setState({
      status: 'open',
    });
    useUiStore.setState({
      rightPanelCollapsed: false,
      activeArtifactTab: 'Task',
      showThinkingOverride: null,
      readSeqMap: {},
    });
  });

  describe('session.store', () => {
    it('openSession: fetches paginated history with afterSeq and subscribes to wsClient', async () => {
      const page1Envelope: SessionEventEnvelope = {
        sessionId: 'sess-1',
        seq: 1,
        runId: 'run-1',
        ts: '2026-09-28T10:00:00.000Z',
        event: {
          type: 'run.started',
          runId: 'run-1',
          model: 'gemini-2.5-pro',
          cwd: '/workspace',
          checkpointId: null,
        },
      };

      const page2Envelope: SessionEventEnvelope = {
        sessionId: 'sess-1',
        seq: 2,
        runId: 'run-1',
        ts: '2026-09-28T10:00:01.000Z',
        event: {
          type: 'message.delta',
          messageId: 'msg-1',
          text: 'Hello world',
        },
      };

      // Mock paginated getSessionEvents: page 1 returns page1Envelope with hasMore=true,
      // page 2 returns page2Envelope with hasMore=false.
      vi.mocked(endpoints.getSessionEvents).mockImplementation(
        async (_id: string, query?: { afterSeq?: number; limit?: number }) => {
          if (!query?.afterSeq || query.afterSeq === 0) {
            return {
              items: [page1Envelope],
              latestSeq: 2,
              hasMore: true,
            };
          }
          if (query.afterSeq === 1) {
            return {
              items: [page2Envelope],
              latestSeq: 2,
              hasMore: false,
            };
          }
          return { items: [], latestSeq: 2, hasMore: false };
        },
      );

      await useSessionStore.getState().openSession('sess-1');

      // Verify REST calls
      expect(endpoints.getSessionEvents).toHaveBeenCalledTimes(2);
      expect(endpoints.getSessionEvents).toHaveBeenNthCalledWith(1, 'sess-1', {
        afterSeq: 0,
        limit: 100,
      });
      expect(endpoints.getSessionEvents).toHaveBeenNthCalledWith(2, 'sess-1', {
        afterSeq: 1,
        limit: 100,
      });

      // Verify slot in store
      const slot = useSessionStore.getState().slots['sess-1'];
      expect(slot).toBeDefined();
      expect(slot.events).toHaveLength(2);
      expect(slot.lastSeq).toBe(2);
      expect(slot.activeRunId).toBe('run-1');
      expect(slot.loading).toBe(false);
      expect(slot.error).toBeNull();
      expect(slot.timeline.items).toHaveLength(1);
      expect(slot.timeline.items[0].kind).toBe('assistant_message');

      // Verify wsClient subscribe
      expect(wsClient.subscribe).toHaveBeenCalledWith(
        'sess-1',
        expect.objectContaining({
          onEvent: expect.any(Function),
          onReset: expect.any(Function),
        }),
        { initialLastSeq: 2 },
      );
    });

    it('openSession: handles REST error gracefully', async () => {
      vi.mocked(endpoints.getSessionEvents).mockRejectedValueOnce(
        new Error('Failed to connect to backend'),
      );

      await useSessionStore.getState().openSession('sess-err');

      const slot = useSessionStore.getState().slots['sess-err'];
      expect(slot).toBeDefined();
      expect(slot.loading).toBe(false);
      expect(slot.error).toBe('Failed to connect to backend');
      expect(slot.events).toEqual([]);
    });

    it('live incremental reduce: updates slot events, timeline, lastSeq, and activeRunId', async () => {
      vi.mocked(endpoints.getSessionEvents).mockResolvedValueOnce({
        items: [],
        latestSeq: 0,
        hasMore: false,
      });

      await useSessionStore.getState().openSession('sess-live');
      expect(mockWsSubscriptions.has('sess-live')).toBe(true);

      const subscription = mockWsSubscriptions.get('sess-live')!;

      // Send live run.started
      const startEnv: SessionEventEnvelope = {
        sessionId: 'sess-live',
        seq: 1,
        runId: 'run-live-1',
        ts: '2026-09-28T10:05:00.000Z',
        event: {
          type: 'run.started',
          runId: 'run-live-1',
          model: 'gemini-2.5-pro',
          cwd: '/workspace',
          checkpointId: null,
        },
      };
      subscription.callbacks.onEvent(startEnv);

      let slot = useSessionStore.getState().slots['sess-live'];
      expect(slot.events).toHaveLength(1);
      expect(slot.lastSeq).toBe(1);
      expect(slot.activeRunId).toBe('run-live-1');

      // Send live message.delta
      const deltaEnv: SessionEventEnvelope = {
        sessionId: 'sess-live',
        seq: 2,
        runId: 'run-live-1',
        ts: '2026-09-28T10:05:01.000Z',
        event: {
          type: 'message.delta',
          messageId: 'm-1',
          text: 'Streaming text...',
        },
      };
      subscription.callbacks.onEvent(deltaEnv);

      slot = useSessionStore.getState().slots['sess-live'];
      expect(slot.events).toHaveLength(2);
      expect(slot.lastSeq).toBe(2);
      expect(slot.timeline.items[0]).toMatchObject({
        kind: 'assistant_message',
        text: 'Streaming text...',
      });

      // Duplicate event with seq <= lastSeq is ignored
      subscription.callbacks.onEvent(deltaEnv);
      expect(useSessionStore.getState().slots['sess-live'].events).toHaveLength(2);

      // Send run.completed
      const completedEnv: SessionEventEnvelope = {
        sessionId: 'sess-live',
        seq: 3,
        runId: 'run-live-1',
        ts: '2026-09-28T10:05:02.000Z',
        event: {
          type: 'run.completed',
          status: 'completed',
          durationMs: 2000,
          usage: null,
          error: null,
          agyConversationId: 'agy-conv-1',
        },
      };
      subscription.callbacks.onEvent(completedEnv);

      slot = useSessionStore.getState().slots['sess-live'];
      expect(slot.lastSeq).toBe(3);
      expect(slot.activeRunId).toBeNull();
    });

    it('onReset: clears slot and re-runs openSession', async () => {
      vi.mocked(endpoints.getSessionEvents)
        .mockResolvedValueOnce({
          items: [
            {
              sessionId: 'sess-reset',
              seq: 1,
              runId: 'run-1',
              ts: '2026-09-28T10:00:00.000Z',
              event: {
                type: 'run.started',
                runId: 'run-1',
                model: 'gemini-2.5-pro',
                cwd: '/workspace',
                checkpointId: null,
              },
            },
          ],
          latestSeq: 1,
          hasMore: false,
        })
        .mockResolvedValueOnce({
          items: [],
          latestSeq: 0,
          hasMore: false,
        });

      await useSessionStore.getState().openSession('sess-reset');
      expect(useSessionStore.getState().slots['sess-reset'].lastSeq).toBe(1);

      const subscription = mockWsSubscriptions.get('sess-reset')!;
      // Trigger onReset
      subscription.callbacks.onReset();

      // Check that openSession was re-invoked
      await vi.waitFor(() => {
        expect(endpoints.getSessionEvents).toHaveBeenCalledTimes(2);
      });
    });

    it('send: sends session.send via wsClient and records pendingRunId until run.started', async () => {
      vi.mocked(endpoints.getSessionEvents).mockResolvedValueOnce({
        items: [],
        latestSeq: 0,
        hasMore: false,
      });
      await useSessionStore.getState().openSession('sess-send');

      const res = await useSessionStore.getState().send('sess-send', 'Please check this code', {
        attachmentIds: ['att-1'],
        model: 'gemini-2.5-flash',
        effort: 'high',
        mode: 'code',
      });

      expect(res.runId).toBe('run-mock-123');
      expect(wsClient.send).toHaveBeenCalledWith({
        type: 'session.send',
        sessionId: 'sess-send',
        text: 'Please check this code',
        attachmentIds: ['att-1'],
        model: 'gemini-2.5-flash',
        effort: 'high',
        mode: 'code',
        requestId: undefined,
      });

      let slot = useSessionStore.getState().slots['sess-send'];
      expect(slot.pendingRunId).toBe('run-mock-123');
      expect(slot.activeRunId).toBeNull();

      // A straggler from an older run must not touch either field
      const subscription = mockWsSubscriptions.get('sess-send')!;
      subscription.callbacks.onEvent({
        sessionId: 'sess-send',
        seq: 1,
        runId: 'run-old',
        ts: '2026-09-28T10:00:00.000Z',
        event: { type: 'usage', usage: { inputTokens: 1, outputTokens: 1, thinkingTokens: 0, cacheReadTokens: 0, totalTokens: 2 } },
      });
      slot = useSessionStore.getState().slots['sess-send'];
      expect(slot.pendingRunId).toBe('run-mock-123');
      expect(slot.activeRunId).toBeNull();

      subscription.callbacks.onEvent({
        sessionId: 'sess-send',
        seq: 2,
        runId: 'run-mock-123',
        ts: '2026-09-28T10:00:08.000Z',
        event: { type: 'run.started', runId: 'run-mock-123', model: null, cwd: '/workspace', checkpointId: null },
      });
      slot = useSessionStore.getState().slots['sess-send'];
      expect(slot.pendingRunId).toBeNull();
      expect(slot.activeRunId).toBe('run-mock-123');
    });

    it('abort: sends run.abort via wsClient', async () => {
      const res = await useSessionStore.getState().abort('sess-abort', 'run-xyz');
      expect(res.runId).toBe('run-xyz');
      expect(wsClient.send).toHaveBeenCalledWith({
        type: 'run.abort',
        runId: 'run-xyz',
      });
    });

    it('retains slot states when switching active sessions', async () => {
      vi.mocked(endpoints.getSessionEvents).mockImplementation(async (id) => {
        return {
          items: [
            {
              sessionId: id,
              seq: 1,
              runId: `run-${id}`,
              ts: '2026-09-28T10:00:00.000Z',
              event: {
                type: 'run.started',
                runId: `run-${id}`,
                model: 'gemini-2.5-pro',
                cwd: '/workspace',
                checkpointId: null,
              },
            },
          ],
          latestSeq: 1,
          hasMore: false,
        };
      });

      await useSessionStore.getState().openSession('slot-1');
      await useSessionStore.getState().openSession('slot-2');

      useSessionStore.getState().setActiveSessionId('slot-1');
      expect(useSessionStore.getState().activeSessionId).toBe('slot-1');
      expect(useSessionStore.getState().slots['slot-1']).toBeDefined();
      expect(useSessionStore.getState().slots['slot-2']).toBeDefined();

      // Switch to slot-2
      useSessionStore.getState().setActiveSessionId('slot-2');
      expect(useSessionStore.getState().activeSessionId).toBe('slot-2');
      // Both slots still retained
      expect(useSessionStore.getState().slots['slot-1'].lastSeq).toBe(1);
      expect(useSessionStore.getState().slots['slot-2'].lastSeq).toBe(1);
    });

    it('fetchSessions: loads session list', async () => {
      const mockSessions: Session[] = [
        {
          id: 's-1',
          workspaceId: 'w-1',
          title: 'Session 1',
          agyConversationId: null,
          status: 'idle',
          model: null,
          effort: null,
          mode: null,
          source: 'studio',
          accountName: null,
          lastRunId: null,
          lastSeq: 0,
          createdAt: '2026-09-28T10:00:00.000Z',
          updatedAt: '2026-09-28T10:00:00.000Z',
        },
      ];

      vi.mocked(endpoints.getSessions).mockResolvedValueOnce({
        items: mockSessions,
        total: 1,
        hasMore: false,
        nextCursor: null,
      });

      const list = await useSessionStore.getState().fetchSessions();
      expect(list).toEqual(mockSessions);
      expect(useSessionStore.getState().list).toEqual(mockSessions);
    });

    it('responds to session.upserted and session.deleted', () => {
      const initialSession: Session = {
        id: 's-1',
        workspaceId: 'w-1',
        title: 'Initial Title',
        agyConversationId: null,
        status: 'idle',
        model: null,
        effort: null,
        mode: null,
        source: 'studio',
        accountName: null,
        lastRunId: null,
        lastSeq: 0,
        createdAt: '2026-09-28T10:00:00.000Z',
        updatedAt: '2026-09-28T10:00:00.000Z',
      };

      useSessionStore.setState({ list: [initialSession], activeSessionId: 's-1' });

      // Upsert update
      const updatedSession: Session = {
        ...initialSession,
        title: 'Updated Title',
        status: 'running',
      };
      useSessionStore.getState().handleSessionUpserted(updatedSession);
      expect(useSessionStore.getState().list).toHaveLength(1);
      expect(useSessionStore.getState().list[0].title).toBe('Updated Title');

      // Upsert insert new session
      const newSession: Session = {
        ...initialSession,
        id: 's-2',
        title: 'New Session',
      };
      useSessionStore.getState().handleSessionUpserted(newSession);
      expect(useSessionStore.getState().list).toHaveLength(2);
      expect(useSessionStore.getState().list[0].id).toBe('s-2');

      // Delete s-1
      useSessionStore.getState().handleSessionDeleted('s-1');
      expect(useSessionStore.getState().list.map((s) => s.id)).toEqual(['s-2']);
      expect(useSessionStore.getState().activeSessionId).toBeNull();
    });

    it('creates, deletes, and imports sessions', async () => {
      const createdSession: Session = {
        id: 's-created',
        workspaceId: 'w-1',
        title: 'Created Session',
        agyConversationId: null,
        status: 'idle',
        model: null,
        effort: null,
        mode: null,
        source: 'studio',
        accountName: null,
        lastRunId: null,
        lastSeq: 0,
        createdAt: '2026-09-28T10:00:00.000Z',
        updatedAt: '2026-09-28T10:00:00.000Z',
      };
      (endpoints.createSession as any).mockResolvedValueOnce(createdSession);

      const resCreated = await useSessionStore.getState().createSession({
        workspaceId: 'w-1',
        title: 'Created Session',
      });
      expect(resCreated).toEqual(createdSession);
      expect(useSessionStore.getState().activeSessionId).toBe('s-created');
      expect(useSessionStore.getState().list.some((s) => s.id === 's-created')).toBe(true);

      // deleteSession
      (endpoints.deleteSession as any).mockResolvedValueOnce({ ok: true });
      await useSessionStore.getState().deleteSession('s-created');
      expect(useSessionStore.getState().list.some((s) => s.id === 's-created')).toBe(false);
      expect(useSessionStore.getState().activeSessionId).toBeNull();

      // importSessions
      const importedSession: Session = {
        ...createdSession,
        id: 's-imported',
        source: 'imported',
      };
      (endpoints.importSessions as any).mockResolvedValueOnce({ imported: [importedSession] });
      const imported = await useSessionStore.getState().importSessions({ workspaceId: 'w-1' });
      expect(imported).toEqual([importedSession]);
      expect(useSessionStore.getState().list.some((s) => s.id === 's-imported')).toBe(true);
    });

    it('handles run.status global updates', () => {
      const session: Session = {
        id: 's-run',
        workspaceId: 'w-1',
        title: 'Run test',
        agyConversationId: null,
        status: 'idle',
        model: null,
        effort: null,
        mode: null,
        source: 'studio',
        accountName: null,
        lastRunId: null,
        lastSeq: 0,
        createdAt: '2026-09-28T10:00:00.000Z',
        updatedAt: '2026-09-28T10:00:00.000Z',
      };
      useSessionStore.setState({ list: [session] });

      useSessionStore.getState().handleRunStatus({
        id: 'run-new',
        sessionId: 's-run',
        status: 'running',
      });

      expect(useSessionStore.getState().list[0].status).toBe('running');
      expect(useSessionStore.getState().list[0].lastRunId).toBe('run-new');

      useSessionStore.getState().handleRunStatus({
        id: 'run-new',
        sessionId: 's-run',
        status: 'failed',
      });
      expect(useSessionStore.getState().list[0].status).toBe('error');

      const expected: Array<[RunStatus, string]> = [
        ['queued', 'running'],
        ['starting', 'running'],
        ['stalled', 'running'],
        ['completed', 'idle'],
        ['aborted', 'idle'],
      ];
      for (const [status, sessionStatus] of expected) {
        useSessionStore.getState().handleRunStatus({ id: 'run-new', sessionId: 's-run', status });
        expect(useSessionStore.getState().list[0].status).toBe(sessionStatus);
      }
    });

    it('closeSession: unsubscribes and drops the slot, so re-activating reopens with a fresh subscription', async () => {
      vi.mocked(endpoints.getSessionEvents).mockResolvedValue({
        items: [],
        latestSeq: 0,
        hasMore: false,
      });

      await useSessionStore.getState().openSession('sess-close');
      expect(mockWsSubscriptions.has('sess-close')).toBe(true);

      useSessionStore.getState().closeSession('sess-close');
      expect(mockWsSubscriptions.has('sess-close')).toBe(false);
      expect(useSessionStore.getState().slots['sess-close']).toBeUndefined();

      useSessionStore.getState().setActiveSessionId('sess-close');
      await vi.waitFor(() => {
        expect(mockWsSubscriptions.has('sess-close')).toBe(true);
      });
      expect(endpoints.getSessionEvents).toHaveBeenCalledTimes(2);
    });

    it('closeSession during an in-flight openSession prevents the late subscribe', async () => {
      let resolveFetch!: (value: { items: SessionEventEnvelope[]; latestSeq: number; hasMore: boolean }) => void;
      vi.mocked(endpoints.getSessionEvents).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFetch = resolve;
          }),
      );

      const opening = useSessionStore.getState().openSession('sess-race');
      useSessionStore.getState().closeSession('sess-race');
      resolveFetch({ items: [], latestSeq: 0, hasMore: false });
      await opening;

      expect(wsClient.subscribe).not.toHaveBeenCalled();
      expect(mockWsSubscriptions.has('sess-race')).toBe(false);
      expect(useSessionStore.getState().slots['sess-race']).toBeUndefined();
    });

    it('setActiveSessionId retries a slot whose previous load failed', async () => {
      vi.mocked(endpoints.getSessionEvents)
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce({ items: [], latestSeq: 0, hasMore: false });

      await useSessionStore.getState().openSession('sess-retry');
      expect(useSessionStore.getState().slots['sess-retry'].error).toBe('offline');

      useSessionStore.getState().setActiveSessionId('sess-retry');
      await vi.waitFor(() => {
        expect(useSessionStore.getState().slots['sess-retry'].error).toBeNull();
      });
      expect(mockWsSubscriptions.has('sess-retry')).toBe(true);
    });

    it('handleSessionDeleted drops the slot and its subscription', async () => {
      vi.mocked(endpoints.getSessionEvents).mockResolvedValueOnce({
        items: [],
        latestSeq: 0,
        hasMore: false,
      });
      await useSessionStore.getState().openSession('sess-del');

      useSessionStore.getState().handleSessionDeleted('sess-del');
      expect(useSessionStore.getState().slots['sess-del']).toBeUndefined();
      expect(mockWsSubscriptions.has('sess-del')).toBe(false);
    });
  });

  describe('workspace.store', () => {
    it('fetchWorkspaces: loads list and selects current workspace', async () => {
      const ws1: Workspace = {
        id: 'ws-1',
        name: 'Project 1',
        path: '/path/1',
        isGitRepo: true,
        createdAt: '2026-09-28T10:00:00.000Z',
        lastOpenedAt: '2026-09-28T10:00:00.000Z',
      };
      const ws2: Workspace = {
        id: 'ws-2',
        name: 'Project 2',
        path: '/path/2',
        isGitRepo: false,
        createdAt: '2026-09-28T10:00:00.000Z',
        lastOpenedAt: '2026-09-28T10:00:00.000Z',
      };

      vi.mocked(endpoints.getWorkspaces).mockResolvedValueOnce([ws1, ws2]);

      const result = await useWorkspaceStore.getState().fetchWorkspaces();
      expect(result).toHaveLength(2);
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(2);
      expect(useWorkspaceStore.getState().currentWorkspace?.id).toBe('ws-1');

      // Select specific workspace
      useWorkspaceStore.getState().selectWorkspace('ws-2');
      expect(useWorkspaceStore.getState().currentWorkspace?.id).toBe('ws-2');
    });

    it('createWorkspace and deleteWorkspace', async () => {
      const newWs: Workspace = {
        id: 'ws-new',
        name: 'New Project',
        path: '/path/new',
        isGitRepo: false,
        createdAt: '2026-09-28T10:00:00.000Z',
        lastOpenedAt: '2026-09-28T10:00:00.000Z',
      };

      vi.mocked(endpoints.createWorkspace).mockResolvedValueOnce(newWs);
      const created = await useWorkspaceStore.getState().createWorkspace({
        name: 'New Project',
        path: '/path/new',
      });

      expect(created.id).toBe('ws-new');
      expect(useWorkspaceStore.getState().currentWorkspace?.id).toBe('ws-new');

      vi.mocked(endpoints.deleteWorkspace).mockResolvedValueOnce({ ok: true });
      await useWorkspaceStore.getState().deleteWorkspace('ws-new');
      expect(useWorkspaceStore.getState().workspaces).toHaveLength(0);
      expect(useWorkspaceStore.getState().currentWorkspace).toBeNull();
    });
  });

  describe('prefs.store', () => {
    it('fetchPrefs and updatePrefs', async () => {
      const mockPrefs: Prefs = {
        defaultModel: 'gemini-2.5-pro',
        defaultEffort: 'medium',
        defaultMode: 'code',
        defaultWorkspaceId: null,
        showThinking: true,
        checkpointsEnabled: true,
        maxConcurrentRuns: 3,
        stallTimeoutSeconds: 180,
      };

      vi.mocked(endpoints.getPrefs).mockResolvedValueOnce(mockPrefs);
      const fetched = await usePrefsStore.getState().fetchPrefs();
      expect(fetched).toEqual(mockPrefs);
      expect(usePrefsStore.getState().prefs).toEqual(mockPrefs);

      const updatedPrefs = { ...mockPrefs, defaultEffort: 'high' as const };
      vi.mocked(endpoints.updatePrefs).mockResolvedValueOnce(updatedPrefs);

      const updated = await usePrefsStore.getState().updatePrefs({ defaultEffort: 'high' });
      expect(updated.defaultEffort).toBe('high');
      expect(usePrefsStore.getState().prefs?.defaultEffort).toBe('high');
    });
  });

  describe('quota.store', () => {
    it('fetchQuota, setQuota and refreshQuota', async () => {
      const mockQuota: QuotaSnapshot = {
        source: 'cli_probe',
        accountName: 'work-account',
        email: 'dev@company.com',
        planTier: 'pro',
        title: 'Quota usage',
        description: null,
        groups: [],
        credits: { available: true, balance: 100 },
        fetchedAt: '2026-09-28T10:00:00.000Z',
        cached: false,
        stale: false,
      };

      vi.mocked(endpoints.getQuota).mockResolvedValueOnce(mockQuota);
      await useQuotaStore.getState().fetchQuota();
      expect(useQuotaStore.getState().quota).toEqual(mockQuota);

      // setQuota directly
      const updatedSnapshot = { ...mockQuota, planTier: 'enterprise' };
      useQuotaStore.getState().setQuota(updatedSnapshot);
      expect(useQuotaStore.getState().quota?.planTier).toBe('enterprise');

      // refreshQuota passes refresh: true
      vi.mocked(endpoints.getQuota).mockResolvedValueOnce(mockQuota);
      await useQuotaStore.getState().refreshQuota('acc-1');
      expect(endpoints.getQuota).toHaveBeenCalledWith({ account: 'acc-1', refresh: true });
    });
  });

  describe('account.store', () => {
    it('fetchAccounts and switchAccount', async () => {
      const mockAccounts: Account[] = [
        {
          name: 'acc-1',
          type: 'oauth',
          isolation: 'isolated_home',
          email: 'acc1@example.com',
          note: null,
          savedAt: '2026-09-28T10:00:00.000Z',
          active: true,
          activeRuns: 0,
        },
      ];
      const mockWhoami: WhoAmI = {
        activeProfile: 'acc-1',
        email: 'acc1@example.com',
        accountType: 'oauth',
        isolation: 'isolated_home',
        credentialPresent: true,
      };

      vi.mocked(endpoints.getAccounts).mockResolvedValue({
        accounts: mockAccounts,
        whoami: mockWhoami,
      });

      await useAccountStore.getState().fetchAccounts();
      expect(useAccountStore.getState().accounts).toHaveLength(1);
      expect(useAccountStore.getState().whoami?.activeProfile).toBe('acc-1');

      // switchAccount
      vi.mocked(endpoints.switchAccount).mockResolvedValueOnce({
        whoami: { ...mockWhoami, activeProfile: 'acc-2' },
      });
      await useAccountStore.getState().switchAccount('acc-2');
      expect(endpoints.switchAccount).toHaveBeenCalledWith({ name: 'acc-2' });
      expect(endpoints.getAccounts).toHaveBeenCalled();
    });

    it('handleAccountChanged: updates whoami and triggers quota refresh', async () => {
      const fetchQuotaSpy = vi.spyOn(useQuotaStore.getState(), 'fetchQuota');

      const newWhoami: WhoAmI = {
        activeProfile: 'acc-switched',
        email: 'switched@example.com',
        accountType: 'oauth',
        isolation: 'isolated_home',
        credentialPresent: true,
      };

      useAccountStore.getState().handleAccountChanged(newWhoami);
      expect(useAccountStore.getState().whoami?.activeProfile).toBe('acc-switched');
      expect(fetchQuotaSpy).toHaveBeenCalledWith({ refresh: true });
    });
  });

  describe('connection.store', () => {
    it('setStatus updates connection status', () => {
      useConnectionStore.getState().setStatus('reconnecting');
      expect(useConnectionStore.getState().status).toBe('reconnecting');
    });
  });

  describe('ui.store', () => {
    it('toggles right panel, sets tabs, and records read sequence numbers', () => {
      expect(useUiStore.getState().rightPanelCollapsed).toBe(false);

      useUiStore.getState().toggleRightPanel();
      expect(useUiStore.getState().rightPanelCollapsed).toBe(true);

      useUiStore.getState().setRightPanelCollapsed(false);
      expect(useUiStore.getState().rightPanelCollapsed).toBe(false);

      useUiStore.getState().setActiveArtifactTab('Plan');
      expect(useUiStore.getState().activeArtifactTab).toBe('Plan');

      useUiStore.getState().setShowThinkingOverride(true);
      expect(useUiStore.getState().showThinkingOverride).toBe(true);

      // markSessionAsRead increases monotonically
      useUiStore.getState().markSessionAsRead('sess-ui', 5);
      expect(useUiStore.getState().getReadSeq('sess-ui')).toBe(5);

      useUiStore.getState().markSessionAsRead('sess-ui', 3); // lower seq ignored
      expect(useUiStore.getState().getReadSeq('sess-ui')).toBe(5);

      useUiStore.getState().markSessionAsRead('sess-ui', 8);
      expect(useUiStore.getState().getReadSeq('sess-ui')).toBe(8);
    });
  });

  describe('bootstrap.ts (initializeApp)', () => {
    it('mirrors connection status and dispatches global events to respective stores', () => {
      const teardown = initializeApp({ connectWs: true });

      expect(wsClient.connect).toHaveBeenCalled();
      expect(wsClient.onStatusChange).toHaveBeenCalled();
      expect(wsClient.onGlobalEvent).toHaveBeenCalled();

      // Trigger status change
      for (const listener of mockStatusListeners) {
        listener('reconnecting');
      }
      expect(useConnectionStore.getState().status).toBe('reconnecting');

      // Trigger session.upserted
      const mockSession: Session = {
        id: 's-global',
        workspaceId: 'w-1',
        title: 'Global Upserted',
        agyConversationId: null,
        status: 'idle',
        model: null,
        effort: null,
        mode: null,
        source: 'studio',
        accountName: null,
        lastRunId: null,
        lastSeq: 0,
        createdAt: '2026-09-28T10:00:00.000Z',
        updatedAt: '2026-09-28T10:00:00.000Z',
      };
      for (const listener of mockGlobalListeners) {
        listener({ type: 'session.upserted', session: mockSession });
      }
      expect(useSessionStore.getState().list.some((s) => s.id === 's-global')).toBe(true);

      // Trigger quota.updated
      const mockQuota: QuotaSnapshot = {
        source: 'statusline',
        accountName: 'acc-1',
        email: null,
        planTier: null,
        title: 'Statusline Quota',
        description: null,
        groups: [],
        credits: { available: false, balance: null },
        fetchedAt: '2026-09-28T10:00:00.000Z',
        cached: false,
        stale: false,
      };
      for (const listener of mockGlobalListeners) {
        listener({ type: 'quota.updated', snapshot: mockQuota });
      }
      expect(useQuotaStore.getState().quota?.title).toBe('Statusline Quota');

      // Trigger account.changed
      const mockWhoami: WhoAmI = {
        activeProfile: 'acc-new',
        email: 'new@example.com',
        accountType: 'oauth',
        isolation: 'isolated_home',
        credentialPresent: true,
      };
      for (const listener of mockGlobalListeners) {
        listener({ type: 'account.changed', whoami: mockWhoami });
      }
      expect(useAccountStore.getState().whoami?.activeProfile).toBe('acc-new');

      // Trigger session.deleted
      for (const listener of mockGlobalListeners) {
        listener({ type: 'session.deleted', sessionId: 's-global' });
      }
      expect(useSessionStore.getState().list.some((s) => s.id === 's-global')).toBe(false);

      // Teardown
      teardown();
      expect(mockStatusListeners.size).toBe(0);
      expect(mockGlobalListeners.size).toBe(0);
    });
  });
});
