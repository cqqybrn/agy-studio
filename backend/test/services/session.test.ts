import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import type { AgentEvent, GlobalEvent } from '@agy-studio/contracts';
import {
  AccountsRepository,
  AttachmentsRepository,
  createDatabase,
  EventsRepository,
  RunsRepository,
  SessionsRepository,
  WorkspacesRepository,
} from '../../src/repositories/index.js';
import { EventBus } from '../../src/services/event-bus.js';
import { SessionService } from '../../src/services/session.js';
import { AppError } from '../../src/utils/errors.js';
import type { DiskConversationSummary, TranscriptTailHandle } from '../../src/services/ports/brain.port.js';

describe('SessionService', () => {
  let db: Database.Database;
  let workspacesRepo: WorkspacesRepository;
  let sessionsRepo: SessionsRepository;
  let runsRepo: RunsRepository;
  let eventsRepo: EventsRepository;
  let attachmentsRepo: AttachmentsRepository;
  let accountsRepo: AccountsRepository;
  let eventBus: EventBus;

  let mockSupervisor: any;
  let mockBrainPort: any;
  let mockHomeIsolation: any;
  let sessionService: SessionService;
  let workspaceId: string;

  beforeEach(() => {
    db = createDatabase(':memory:');
    workspacesRepo = new WorkspacesRepository(db);
    sessionsRepo = new SessionsRepository(db);
    runsRepo = new RunsRepository(db);
    eventsRepo = new EventsRepository(db);
    attachmentsRepo = new AttachmentsRepository(db);
    accountsRepo = new AccountsRepository(db);
    eventBus = new EventBus({ eventsRepo, deltaCoalesceMs: 10 });

    const ws = workspacesRepo.create({
      id: 'ws-1',
      name: 'Test Workspace',
      path: 'G:/fake/project',
      isGitRepo: false,
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    });
    workspaceId = ws.id;

    accountsRepo.save({
      name: 'default-acc',
      type: 'oauth',
      isolation: 'isolated_home',
      email: 'user@example.com',
      note: null,
      savedAt: new Date().toISOString(),
      active: true,
    });

    mockSupervisor = {
      activeRunsMap: new Map(),
      activeSessions: new Map(),
      listeners: [] as Array<(sId: string, rId: string, event: AgentEvent) => void>,
      addEventListener(fn: any) {
        this.listeners.push(fn);
        return () => {
          this.listeners = this.listeners.filter((l: any) => l !== fn);
        };
      },
      getActiveRunBySessionId: vi.fn().mockReturnValue(null),
      start: vi.fn(),
      abort: vi.fn().mockResolvedValue(true),
    };

    mockBrainPort = {
      listConversations: vi.fn().mockResolvedValue([]),
      tailTranscript: vi.fn(),
      purgeConversation: vi.fn().mockResolvedValue(undefined),
    };

    mockHomeIsolation = {
      createHome: vi.fn().mockResolvedValue('/data/profiles/default-acc/home'),
      envFor: vi.fn().mockResolvedValue({}),
      getHomePath: vi.fn().mockReturnValue('/data/profiles/default-acc/home'),
    };

    sessionService = new SessionService({
      sessionsRepo,
      workspacesRepo,
      runsRepo,
      eventsRepo,
      attachmentsRepo,
      accountsRepo,
      eventBus,
      supervisor: mockSupervisor,
      brainPort: mockBrainPort,
      homeIsolation: mockHomeIsolation,
      isolationMode: 'isolated_home',
    });
  });

  afterEach(() => {
    db.close();
  });

  describe('createSession', () => {
    it('creates a session in isolated_home mode using default account', async () => {
      const globalEvents: GlobalEvent[] = [];
      eventBus.subscribeGlobal((e) => globalEvents.push(e));

      const session = await sessionService.createSession({
        workspaceId,
        title: 'My Chat',
        model: 'gemini-3.8-high',
        effort: 'high',
        mode: 'plan',
      });

      expect(session.id).toBeTruthy();
      expect(session.workspaceId).toBe(workspaceId);
      expect(session.title).toBe('My Chat');
      expect(session.accountName).toBe('default-acc');
      expect(session.model).toBe('gemini-3.8-high');
      expect(session.effort).toBe('high');
      expect(session.mode).toBe('plan');
      expect(session.status).toBe('idle');

      expect(globalEvents.some((e) => e.type === 'session.upserted')).toBe(true);
    });

    it('creates a session in credential_snapshot mode with null accountName', async () => {
      const snapSessionService = new SessionService({
        sessionsRepo,
        workspacesRepo,
        runsRepo,
        eventsRepo,
        eventBus,
        supervisor: mockSupervisor,
        isolationMode: 'credential_snapshot',
      });

      const session = await snapSessionService.createSession({
        workspaceId,
        accountName: 'ignored-account',
      });

      expect(session.accountName).toBeNull();
    });

    it('rejects nonexistent workspaceId with NOT_FOUND', async () => {
      await expect(
        sessionService.createSession({ workspaceId: 'nonexistent' }),
      ).rejects.toThrowError(AppError);
    });
  });

  describe('listSessions, getSession, updateSession', () => {
    it('lists and paginates sessions', async () => {
      await sessionService.createSession({ workspaceId, title: 'Session 1' });
      await sessionService.createSession({ workspaceId, title: 'Session 2' });

      const page = await sessionService.listSessions({ workspaceId });
      expect(page.items.length).toBe(2);
      expect(page.total).toBe(2);
    });

    it('gets session by id or throws NOT_FOUND', async () => {
      const created = await sessionService.createSession({ workspaceId });
      const found = await sessionService.getSession(created.id);
      expect(found.id).toBe(created.id);

      await expect(sessionService.getSession('unknown')).rejects.toThrowError(AppError);
    });

    it('updates session and broadcasts session.upserted', async () => {
      const created = await sessionService.createSession({ workspaceId, title: 'Initial' });
      const globalEvents: GlobalEvent[] = [];
      eventBus.subscribeGlobal((e) => globalEvents.push(e));

      const updated = await sessionService.updateSession(created.id, {
        title: 'Updated Title',
        effort: 'low',
      });

      expect(updated.title).toBe('Updated Title');
      expect(updated.effort).toBe('low');
      expect(globalEvents.some((e) => e.type === 'session.upserted')).toBe(true);
    });
  });

  describe('deleteSession', () => {
    it('deletes session and broadcasts session.deleted', async () => {
      const created = await sessionService.createSession({ workspaceId });
      const globalEvents: GlobalEvent[] = [];
      eventBus.subscribeGlobal((e) => globalEvents.push(e));

      await sessionService.deleteSession(created.id);
      expect(sessionsRepo.findById(created.id)).toBeNull();
      expect(
        globalEvents.some((e) => e.type === 'session.deleted' && (e as any).sessionId === created.id),
      ).toBe(true);
    });

    it('rejects delete when session is active with SESSION_BUSY', async () => {
      const created = await sessionService.createSession({ workspaceId });
      mockSupervisor.getActiveRunBySessionId.mockReturnValue({ id: 'run-123' });

      await expect(sessionService.deleteSession(created.id)).rejects.toThrowError(AppError);
      try {
        await sessionService.deleteSession(created.id);
      } catch (err) {
        expect((err as AppError).code).toBe('SESSION_BUSY');
      }
    });

    it('purges conversation directory when purge=true and agyConversationId exists', async () => {
      const created = await sessionService.createSession({ workspaceId });
      sessionsRepo.update(created.id, { agyConversationId: 'agy-conv-1' });

      await sessionService.deleteSession(created.id, true);
      expect(mockBrainPort.purgeConversation).toHaveBeenCalledWith(
        'agy-conv-1',
        '/data/profiles/default-acc/home',
      );
    });
  });

  describe('send', () => {
    it('broadcasts the running session as soon as the run starts', async () => {
      const session = await sessionService.createSession({ workspaceId, title: 'New Session' });
      mockSupervisor.start.mockImplementation(async (sessionId: string) => {
        // the real supervisor marks the session running before returning
        sessionsRepo.update(sessionId, { status: 'running', lastRunId: 'run-live' });
        return { runId: 'run-live', completion: new Promise<void>(() => {}) };
      });
      const globalEvents: GlobalEvent[] = [];
      eventBus.subscribeGlobal((e) => globalEvents.push(e));

      await sessionService.send({ sessionId: session.id, text: 'hello', attachmentIds: [] });

      const upserts = globalEvents.filter(
        (e): e is Extract<GlobalEvent, { type: 'session.upserted' }> => e.type === 'session.upserted',
      );
      expect(upserts.at(-1)?.session).toMatchObject({ id: session.id, status: 'running', lastRunId: 'run-live' });
    });

    it('publishes user.message, updates title if default, starts run, and backfills conversationId', async () => {
      const session = await sessionService.createSession({
        workspaceId,
        title: 'New Session',
      });

      let completionResolve: () => void = () => {};
      const completionPromise = new Promise<void>((resolve) => {
        completionResolve = resolve;
      });

      mockSupervisor.start.mockResolvedValue({
        runId: 'run-abc',
        completion: completionPromise,
      });

      const res = await sessionService.send({
        sessionId: session.id,
        text: 'Fix the bug in src/index.ts please and make sure it builds',
        attachmentIds: [],
      });

      expect(res.runId).toBe('run-abc');

      // Title should be updated to first message snippet
      const updated = sessionsRepo.findById(session.id);
      expect(updated?.title).toBe('Fix the bug in src/index.ts please and make sure i');

      // Check user.message published
      const events = eventsRepo.listBySessionId(session.id);
      expect(events.some((e) => e.event.type === 'user.message')).toBe(true);

      // Verify supervisor start parameters
      expect(mockSupervisor.start).toHaveBeenCalledWith(
        session.id,
        expect.objectContaining({
          prompt: 'Fix the bug in src/index.ts please and make sure it builds',
          accountName: 'default-acc',
          cwd: 'G:/fake/project',
        }),
      );

      // Trigger listener with conversationId
      for (const l of mockSupervisor.listeners) {
        l(session.id, 'run-abc', {
          type: 'run.completed',
          status: 'completed',
          usage: null,
          error: null,
          durationMs: 100,
          agyConversationId: 'agy-uuid-999',
        });
      }

      const backfilled = sessionsRepo.findById(session.id);
      expect(backfilled?.agyConversationId).toBe('agy-uuid-999');

      completionResolve();
      await completionPromise;
    });

    it('modifies supervisor prompt using prompt-inject when attachments are provided', async () => {
      const session = await sessionService.createSession({
        workspaceId,
        title: 'Session with Attachments',
      });

      const att = attachmentsRepo.create({
        id: 'att-123',
        workspaceId,
        sessionId: session.id,
        kind: 'image',
        originalName: 'test.png',
        mimeType: 'image/png',
        size: 100,
        storedPath: 'G:/fake/project/.agy-attachments/2026-09-28/att-123-test.png',
        derivedTextPath: null,
        createdAt: new Date().toISOString(),
      });

      let completionResolve: () => void = () => {};
      const completionPromise = new Promise<void>((resolve) => {
        completionResolve = resolve;
      });

      mockSupervisor.start.mockResolvedValue({
        runId: 'run-xyz',
        completion: completionPromise,
      });

      await sessionService.send({
        sessionId: session.id,
        text: 'Please check this image',
        attachmentIds: [att.id],
      });

      expect(mockSupervisor.start).toHaveBeenCalledWith(
        session.id,
        expect.objectContaining({
          prompt: expect.stringContaining('<images_input>'),
        }),
      );

      completionResolve();
      await completionPromise;
    });

    it('forwards a chosen agent to supervisor.start and drops the built-in default', async () => {
      const session = await sessionService.createSession({ workspaceId, title: 'Agent chat' });
      mockSupervisor.start.mockResolvedValue({ runId: 'run-agent', completion: new Promise(() => {}) });

      await sessionService.send({
        sessionId: session.id,
        text: 'review',
        attachmentIds: [],
        agent: 'code-reviewer',
      });
      expect(mockSupervisor.start.mock.calls[0][1].agent).toBe('code-reviewer');

      mockSupervisor.start.mockClear();
      await sessionService.send({ sessionId: session.id, text: 'hi', attachmentIds: [], agent: 'default' });
      expect(mockSupervisor.start.mock.calls[0][1]).not.toHaveProperty('agent');
    });

    it('rejects agent names with path or flag characters that are not listed', async () => {
      const session = await sessionService.createSession({ workspaceId, title: 'Agent chat' });
      for (const agent of ['../evil', '--model', 'a b', 'x\\y']) {
        await expect(
          sessionService.send({ sessionId: session.id, text: 'hi', attachmentIds: [], agent }),
        ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
      }
      expect(mockSupervisor.start).not.toHaveBeenCalled();
    });

    it('implements getActiveRunId and abortRun for gateway.ts SessionServicePort', async () => {
      mockSupervisor.getActiveRunBySessionId.mockReturnValue({ id: 'run-active-1' });
      expect(sessionService.getActiveRunId('sess-1')).toBe('run-active-1');

      await sessionService.abortRun({ runId: 'run-active-1' });
      expect(mockSupervisor.abort).toHaveBeenCalledWith('run-active-1');
    });
  });

  describe('importSessions', () => {
    it('scans BrainPort conversations, converts transcript steps to events, and creates Session', async () => {
      const convSummary: DiskConversationSummary = {
        id: 'agy-disk-conv-1',
        title: 'Disk Conversation 1',
        createdAt: '2026-09-28T10:00:00.000Z',
        updatedAt: '2026-09-28T10:05:00.000Z',
      };
      mockBrainPort.listConversations.mockResolvedValue([convSummary]);

      const steps = [
        {
          stepIndex: 0,
          type: 'USER_INPUT',
          status: 'DONE',
          createdAt: '2026-09-28T10:00:01.000Z',
          content: 'Hello agent',
          thinking: null,
          toolCalls: [],
          error: null,
        },
        {
          stepIndex: 1,
          type: 'thought',
          status: 'DONE',
          createdAt: '2026-09-28T10:00:02.000Z',
          content: null,
          thinking: 'Thinking about reply...',
          toolCalls: [],
          error: null,
        },
        {
          stepIndex: 2,
          type: 'PLANNER_RESPONSE',
          status: 'DONE',
          createdAt: '2026-09-28T10:00:03.000Z',
          content: 'Hello! How can I help you?',
          thinking: null,
          toolCalls: [],
          error: null,
        },
      ];

      mockBrainPort.tailTranscript.mockResolvedValue({
        steps: (async function* () {
          for (const s of steps) yield s;
        })(),
        stop: vi.fn(),
      } as unknown as TranscriptTailHandle);

      const result = await sessionService.importSessions({
        workspaceId,
      });

      expect(result.imported.length).toBe(1);
      const importedSession = result.imported[0];
      expect(importedSession.agyConversationId).toBe('agy-disk-conv-1');
      expect(importedSession.title).toBe('Disk Conversation 1');
      expect(importedSession.source).toBe('imported');
      expect(importedSession.accountName).toBe('default-acc');

      const events = eventsRepo.listBySessionId(importedSession.id);
      expect(events.length).toBe(3);
      expect(events[0].event.type).toBe('user.message');
      expect(events[1].event.type).toBe('thinking.delta');
      expect(events[2].event.type).toBe('message.delta');

      // Second import should not re-import the same agyConversationId
      const secondImport = await sessionService.importSessions({ workspaceId });
      expect(secondImport.imported.length).toBe(0);
    });
  });

  describe('listEvents and listRuns', () => {
    it('lists events with pagination', async () => {
      const session = await sessionService.createSession({ workspaceId });
      eventsRepo.appendBatch(session.id, [
        {
          seq: 1,
          sessionId: session.id,
          runId: null,
          ts: new Date().toISOString(),
          event: { type: 'message.delta', messageId: 'm1', text: 'part 1' },
        },
        {
          seq: 2,
          sessionId: session.id,
          runId: null,
          ts: new Date().toISOString(),
          event: { type: 'message.delta', messageId: 'm1', text: 'part 2' },
        },
      ]);

      const res = await sessionService.listEvents(session.id, 0, 1);
      expect(res.items.length).toBe(1);
      expect(res.hasMore).toBe(true);
      expect(res.latestSeq).toBe(2);

      const res2 = await sessionService.listEvents(session.id, 1, 10);
      expect(res2.items.length).toBe(1);
      expect(res2.hasMore).toBe(false);
    });

    it('lists runs for a session', async () => {
      const session = await sessionService.createSession({ workspaceId });
      runsRepo.create({
        id: 'run-1',
        sessionId: session.id,
        status: 'completed',
        model: 'gemini',
        accountName: null,
        pid: null,
        usage: null,
        error: null,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
      });

      const runs = await sessionService.listRuns(session.id);
      expect(runs.length).toBe(1);
      expect(runs[0].id).toBe('run-1');
    });
  });
});
