import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type Database from 'better-sqlite3';
import type { Session } from '@agy-studio/contracts';
import {
  AccountsRepository,
  createDatabase,
  EventsRepository,
  RunsRepository,
  SessionsRepository,
  WorkspacesRepository,
} from '../../src/repositories/index.js';
import { EventBus } from '../../src/services/event-bus.js';
import { SessionService } from '../../src/services/session.js';
import { sessionsRoutes } from '../../src/routes/http/sessions.routes.js';

describe('Sessions HTTP Routes', () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let workspacesRepo: WorkspacesRepository;
  let sessionsRepo: SessionsRepository;
  let runsRepo: RunsRepository;
  let eventsRepo: EventsRepository;
  let accountsRepo: AccountsRepository;
  let eventBus: EventBus;
  let mockSupervisor: any;
  let sessionService: SessionService;
  let workspaceId: string;

  beforeEach(async () => {
    db = createDatabase(':memory:');
    workspacesRepo = new WorkspacesRepository(db);
    sessionsRepo = new SessionsRepository(db);
    runsRepo = new RunsRepository(db);
    eventsRepo = new EventsRepository(db);
    accountsRepo = new AccountsRepository(db);
    eventBus = new EventBus({ eventsRepo, deltaCoalesceMs: 10 });

    const ws = workspacesRepo.create({
      id: 'ws-test',
      name: 'Test Project',
      path: 'G:/fake/project',
      isGitRepo: false,
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    });
    workspaceId = ws.id;

    mockSupervisor = {
      activeRunsMap: new Map(),
      activeSessions: new Map(),
      listeners: [],
      addEventListener: vi.fn().mockReturnValue(() => {}),
      getActiveRunBySessionId: vi.fn().mockReturnValue(null),
      start: vi.fn(),
      abort: vi.fn().mockResolvedValue(true),
    };

    sessionService = new SessionService({
      sessionsRepo,
      workspacesRepo,
      runsRepo,
      eventsRepo,
      accountsRepo,
      eventBus,
      supervisor: mockSupervisor,
    });

    app = Fastify();
    await app.register(sessionsRoutes, { sessionService });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    db.close();
  });

  it('GET /api/sessions returns empty page initially', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/sessions',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('POST /api/sessions creates session with 201', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        workspaceId,
        title: 'Chat Session',
        model: 'gemini-3.8-flash',
        effort: 'medium',
      },
    });

    expect(res.statusCode).toBe(201);
    const body: Session = JSON.parse(res.body);
    expect(body.id).toBeTruthy();
    expect(body.workspaceId).toBe(workspaceId);
    expect(body.title).toBe('Chat Session');
    expect(body.model).toBe('gemini-3.8-flash');
    expect(body.effort).toBe('medium');
    expect(body.status).toBe('idle');
  });

  it('POST /api/sessions validates schema and returns 400 with ApiErrorResponse', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions',
      payload: {
        workspaceId: '',
      },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error.code).toBe('BAD_REQUEST');
  });

  it('GET /api/sessions/:sessionId returns session or 404', async () => {
    const created = await sessionService.createSession({ workspaceId, title: 'Session A' });

    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${created.id}`,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).id).toBe(created.id);

    const notFoundRes = await app.inject({
      method: 'GET',
      url: '/api/sessions/unknown-id',
    });
    expect(notFoundRes.statusCode).toBe(404);
    expect(JSON.parse(notFoundRes.body).error.code).toBe('NOT_FOUND');
  });

  it('PATCH /api/sessions/:sessionId updates session', async () => {
    const created = await sessionService.createSession({ workspaceId, title: 'Initial' });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/sessions/${created.id}`,
      payload: {
        title: 'New Title',
        effort: 'high',
      },
    });

    expect(res.statusCode).toBe(200);
    const body: Session = JSON.parse(res.body);
    expect(body.title).toBe('New Title');
    expect(body.effort).toBe('high');
  });

  it('DELETE /api/sessions/:sessionId deletes session and supports ?purge=true', async () => {
    const created = await sessionService.createSession({ workspaceId });

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/sessions/${created.id}?purge=true`,
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });

    expect(sessionsRepo.findById(created.id)).toBeNull();
  });

  it('POST /api/sessions/import returns imported sessions', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/sessions/import',
      payload: {
        workspaceId,
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.imported)).toBe(true);
  });

  it('GET /api/sessions/:sessionId/events returns events list with pagination info', async () => {
    const created = await sessionService.createSession({ workspaceId });
    eventsRepo.appendBatch(created.id, [
      {
        seq: 1,
        sessionId: created.id,
        runId: null,
        ts: new Date().toISOString(),
        event: { type: 'message.delta', messageId: 'm1', text: 'hi' },
      },
    ]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${created.id}/events?afterSeq=0&limit=10`,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.items.length).toBe(1);
    expect(body.latestSeq).toBe(1);
    expect(body.hasMore).toBe(false);
  });

  it('GET /api/sessions/:sessionId/runs returns runs list', async () => {
    const created = await sessionService.createSession({ workspaceId });
    runsRepo.create({
      id: 'r-1',
      sessionId: created.id,
      status: 'completed',
      model: null,
      accountName: null,
      checkpointId: null,
      pid: null,
      usage: null,
      error: null,
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${created.id}/runs`,
    });

    expect(res.statusCode).toBe(200);
    const runs = JSON.parse(res.body);
    expect(runs.length).toBe(1);
    expect(runs[0].id).toBe('r-1');
  });
});
