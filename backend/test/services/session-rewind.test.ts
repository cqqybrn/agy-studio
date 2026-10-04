import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import type { AgentEvent, GlobalEvent } from '@agy-studio/contracts';
import {
  createDatabase,
  EventsRepository,
  RunsRepository,
  SessionsRepository,
  WorkspacesRepository,
} from '../../src/repositories/index.js';
import { EventBus } from '../../src/services/event-bus.js';
import { SessionService } from '../../src/services/session.js';
import type { ConversationRewindPort } from '../../src/services/ports/conversation-rewind.port.js';
import { AppError } from '../../src/utils/errors.js';

describe('SessionService.rewindToMessage', () => {
  let db: Database.Database;
  let sessionsRepo: SessionsRepository;
  let runsRepo: RunsRepository;
  let eventsRepo: EventsRepository;
  let eventBus: EventBus;
  let activeRun: { id: string } | null;
  let rewind: ConversationRewindPort & { rewindToMessage: ReturnType<typeof vi.fn> };
  let lease: { accountName: string | null; env: Record<string, string>; release: ReturnType<typeof vi.fn> };
  let acquireLease: ReturnType<typeof vi.fn>;
  let globals: GlobalEvent[];
  let service: SessionService;

  const SESSION = 'sess-1';
  const now = () => new Date().toISOString();

  const userMessage = (messageId: string, text: string): AgentEvent => ({
    type: 'user.message',
    messageId,
    text,
    attachments: [],
  });
  const answer = (runId: string): AgentEvent => ({ type: 'raw', payload: { answerFor: runId } });

  async function addTurn(messageId: string, text: string, runId: string) {
    await eventBus.publish(SESSION, null, userMessage(messageId, text));
    runsRepo.create({
      id: runId,
      sessionId: SESSION,
      status: 'completed',
      model: null,
      accountName: 'acc',
      pid: null,
      usage: null,
      error: null,
      startedAt: now(),
      endedAt: now(),
    });
    await eventBus.publish(SESSION, runId, answer(runId));
    await eventBus.flush(SESSION);
  }

  beforeEach(async () => {
    db = createDatabase(':memory:');
    sessionsRepo = new SessionsRepository(db);
    runsRepo = new RunsRepository(db);
    eventsRepo = new EventsRepository(db);
    eventBus = new EventBus({ eventsRepo, deltaCoalesceMs: 0, flushIntervalMs: 1 });
    globals = [];
    eventBus.subscribeGlobal((e) => globals.push(e));

    new WorkspacesRepository(db).create({
      id: 'ws-1',
      name: 'W',
      path: 'C:/work/project',
      isGitRepo: false,
      createdAt: now(),
      lastOpenedAt: now(),
    });
    sessionsRepo.create({
      id: SESSION,
      workspaceId: 'ws-1',
      title: 'S',
      agyConversationId: 'conv-1',
      status: 'idle',
      model: null,
      effort: null,
      mode: null,
      source: 'studio',
      accountName: 'acc',
      lastRunId: null,
      lastSeq: 0,
      createdAt: now(),
      updatedAt: now(),
    });

    activeRun = null;
    rewind = { rewindToMessage: vi.fn().mockResolvedValue(undefined) };
    lease = { accountName: 'acc', env: { AGY_TEST: '1' }, release: vi.fn() };
    acquireLease = vi.fn().mockResolvedValue(lease);
    service = new SessionService({
      sessionsRepo,
      workspacesRepo: new WorkspacesRepository(db),
      runsRepo,
      eventsRepo,
      eventBus,
      supervisor: {
        getActiveRunBySessionId: () => activeRun,
        addEventListener: () => () => {},
      } as never,
      conversationRewind: rewind,
      acquireLease,
    });

    // seq 1-2: "first" / r1, seq 3-4: "second" / r2, seq 5-6: "first" again / r3
    await addTurn('m1', 'first', 'r1');
    await addTurn('m2', 'second', 'r2');
    await addTurn('m3', 'first', 'r3');
    sessionsRepo.update(SESSION, { lastRunId: 'r3' });
  });

  afterEach(() => {
    db.close();
  });

  it('rewinds agy, then truncates history from the message and keeps the sequence gap-free', async () => {
    await service.rewindToMessage(SESSION, 'm2');

    expect(rewind.rewindToMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      cwd: 'C:/work/project',
      messageText: 'second',
      occurrenceFromEnd: 1,
      previousMessageText: 'first',
      env: { AGY_TEST: '1' },
    });
    expect(eventsRepo.listBySessionId(SESSION).map((e) => e.seq)).toEqual([1, 2]);
    expect(sessionsRepo.findById(SESSION)?.lastSeq).toBe(2);

    // The next event continues at seq 3
    await eventBus.publish(SESSION, null, userMessage('m4', 'edited'));
    await eventBus.flush(SESSION);
    expect(eventsRepo.listBySessionId(SESSION).map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('deletes the runs that only belonged to the removed turns and fixes lastRunId', async () => {
    await service.rewindToMessage(SESSION, 'm2');

    expect(runsRepo.findById('r1')).not.toBeNull();
    expect(runsRepo.findById('r2')).toBeNull();
    expect(runsRepo.findById('r3')).toBeNull();
    expect(sessionsRepo.findById(SESSION)?.lastRunId).toBe('r1');
  });

  it('tells clients to reload the session', async () => {
    await service.rewindToMessage(SESSION, 'm2');

    expect(globals.map((e) => e.type)).toEqual(['session.reset', 'session.upserted']);
    expect(globals[0]).toEqual({ type: 'session.reset', sessionId: SESSION });
  });

  it('skips later messages with the same text to reach the right one in agy', async () => {
    await service.rewindToMessage(SESSION, 'm1');

    expect(rewind.rewindToMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageText: 'first', occurrenceFromEnd: 2, previousMessageText: null }),
    );
    expect(eventsRepo.listBySessionId(SESSION)).toHaveLength(0);
    expect(sessionsRepo.findById(SESSION)?.lastRunId).toBeNull();
  });

  it('holds the account lease while agy is rewound and releases it afterwards', async () => {
    rewind.rewindToMessage.mockImplementation(async () => {
      expect(lease.release).not.toHaveBeenCalled();
    });
    await service.rewindToMessage(SESSION, 'm3');

    expect(acquireLease).toHaveBeenCalledWith('acc');
    expect(lease.release).toHaveBeenCalledTimes(1);
  });

  it('leaves everything untouched when agy cannot be rewound', async () => {
    rewind.rewindToMessage.mockRejectedValue(new AppError('CONFLICT', 'not in agy history'));

    await expect(service.rewindToMessage(SESSION, 'm2')).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(eventsRepo.listBySessionId(SESSION)).toHaveLength(6);
    expect(runsRepo.findById('r2')).not.toBeNull();
    expect(lease.release).toHaveBeenCalledTimes(1);
    expect(globals).toEqual([]);
  });

  it('rejects while the session is running', async () => {
    activeRun = { id: 'r-live' };

    await expect(service.rewindToMessage(SESSION, 'm2')).rejects.toMatchObject({ code: 'SESSION_BUSY' });
    expect(rewind.rewindToMessage).not.toHaveBeenCalled();
    expect(eventsRepo.listBySessionId(SESSION)).toHaveLength(6);
  });

  it('rejects an unknown message', async () => {
    await expect(service.rewindToMessage(SESSION, 'nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(rewind.rewindToMessage).not.toHaveBeenCalled();
  });

  it('only truncates when agy never started a conversation for the session', async () => {
    sessionsRepo.update(SESSION, { agyConversationId: null });

    await service.rewindToMessage(SESSION, 'm3');

    expect(rewind.rewindToMessage).not.toHaveBeenCalled();
    expect(acquireLease).not.toHaveBeenCalled();
    expect(eventsRepo.listBySessionId(SESSION).map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });
});
