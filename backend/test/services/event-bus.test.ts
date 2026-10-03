import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { createDatabase, EventsRepository, SessionsRepository, WorkspacesRepository } from '../../src/repositories/index.js';
import { EventBus } from '../../src/services/event-bus.js';
import type { AgentEvent, SessionEventEnvelope } from '@agy-studio/contracts';

describe('EventBus', () => {
  let tempDir: string;
  let db: Database.Database;
  let eventsRepo: EventsRepository;
  let sessionsRepo: SessionsRepository;
  let workspacesRepo: WorkspacesRepository;
  let eventBus: EventBus;
  const workspaceId = 'ws-test-1';
  const sessionId = 'session-test-1';

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-event-bus-test-'));
    const dbPath = path.join(tempDir, 'test.db');
    db = createDatabase({ dbPath });
    eventsRepo = new EventsRepository(db);
    sessionsRepo = new SessionsRepository(db);
    workspacesRepo = new WorkspacesRepository(db);

    const now = new Date().toISOString();
    workspacesRepo.create({
      id: workspaceId,
      name: 'Test WS',
      path: '/tmp',
      isGitRepo: false,
      createdAt: now,
      lastOpenedAt: now,
    });
    sessionsRepo.create({
      id: sessionId,
      workspaceId,
      accountName: null,
      title: 'Test Session',
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
  });

  afterEach(async () => {
    await eventBus.close();
    try {
      db.close();
    } catch {
      // ignore
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('publishes and persists events with monotonic continuous seq', async () => {
    const received: SessionEventEnvelope[] = [];
    eventBus.subscribe(sessionId, (env) => {
      received.push(env);
    });

    const event1: AgentEvent = {
      type: 'run.started',
      runId: 'run-1',
      model: 'test-model',
      cwd: '/tmp',
    };
    const event2: AgentEvent = {
      type: 'user.message',
      messageId: 'msg-1',
      text: 'hello',
      attachments: [],
    };

    const p1 = eventBus.publish(sessionId, 'run-1', event1);
    const p2 = eventBus.publish(sessionId, 'run-1', event2);

    await Promise.all([p1, p2]);

    expect(received).toHaveLength(2);
    expect(received[0].seq).toBe(1);
    expect(received[1].seq).toBe(2);

    const inDb = eventsRepo.listAfter(sessionId, 0);
    expect(inDb).toHaveLength(2);
    expect(inDb[0].seq).toBe(1);
    expect(inDb[1].seq).toBe(2);
    expect(eventsRepo.latestSeq(sessionId)).toBe(2);

    // Continue publishing from existing seq
    const event3: AgentEvent = {
      type: 'message.done',
      messageId: 'msg-1',
    };
    await eventBus.publish(sessionId, 'run-1', event3);
    expect(eventsRepo.latestSeq(sessionId)).toBe(3);
  });

  it('coalesces message.delta within deltaCoalesceMs window and keeps seq strictly continuous', async () => {
    const received: SessionEventEnvelope[] = [];
    eventBus.subscribe(sessionId, (env) => {
      received.push(env);
    });

    const d1: AgentEvent = { type: 'message.delta', messageId: 'm1', text: 'Hello' };
    const d2: AgentEvent = { type: 'message.delta', messageId: 'm1', text: ' ' };
    const d3: AgentEvent = { type: 'message.delta', messageId: 'm1', text: 'World!' };
    const done: AgentEvent = { type: 'message.done', messageId: 'm1' };

    // Publish rapidly within coalesce window
    const p1 = eventBus.publish(sessionId, 'run-1', d1);
    const p2 = eventBus.publish(sessionId, 'run-1', d2);
    const p3 = eventBus.publish(sessionId, 'run-1', d3);
    const p4 = eventBus.publish(sessionId, 'run-1', done);

    await Promise.all([p1, p2, p3, p4]);

    // Should coalesce d1, d2, d3 into 1 envelope, followed by message.done
    expect(received).toHaveLength(2);
    expect(received[0].seq).toBe(1);
    expect(received[0].event).toEqual({
      type: 'message.delta',
      messageId: 'm1',
      text: 'Hello World!',
    });
    expect(received[1].seq).toBe(2);
    expect(received[1].event).toEqual({
      type: 'message.done',
      messageId: 'm1',
    });

    // Check DB records
    const inDb = eventsRepo.listAfter(sessionId, 0);
    expect(inDb).toHaveLength(2);
    expect(inDb[0].seq).toBe(1);
    expect((inDb[0].event as any).text).toBe('Hello World!');
    expect(inDb[1].seq).toBe(2);
  });

  it('coalesces thinking.delta within deltaCoalesceMs window', async () => {
    const received: SessionEventEnvelope[] = [];
    eventBus.subscribe(sessionId, (env) => {
      received.push(env);
    });

    const t1: AgentEvent = { type: 'thinking.delta', blockId: 'b1', source: 'stream', text: 'Thinking' };
    const t2: AgentEvent = { type: 'thinking.delta', blockId: 'b1', source: 'stream', text: '...' };

    await Promise.all([
      eventBus.publish(sessionId, 'run-1', t1),
      eventBus.publish(sessionId, 'run-1', t2),
    ]);

    expect(received).toHaveLength(1);
    expect(received[0].seq).toBe(1);
    expect(received[0].event).toEqual({
      type: 'thinking.delta',
      blockId: 'b1',
      source: 'stream',
      text: 'Thinking...',
    });
  });

  it('does not coalesce deltas with different messageId or blockId', async () => {
    const received: SessionEventEnvelope[] = [];
    eventBus.subscribe(sessionId, (env) => {
      received.push(env);
    });

    const m1: AgentEvent = { type: 'message.delta', messageId: 'm1', text: 'Alpha' };
    const m2: AgentEvent = { type: 'message.delta', messageId: 'm2', text: 'Beta' };

    await Promise.all([
      eventBus.publish(sessionId, 'run-1', m1),
      eventBus.publish(sessionId, 'run-1', m2),
    ]);

    expect(received).toHaveLength(2);
    expect(received[0].seq).toBe(1);
    expect(received[1].seq).toBe(2);
  });

  it('triggers immediate flush when batchSize is reached', async () => {
    const smallBatchBus = new EventBus({
      eventsRepo,
      batchSize: 5,
      flushIntervalMs: 5000, // Very long interval, so flush must come from batch size
    });

    const received: SessionEventEnvelope[] = [];
    smallBatchBus.subscribe(sessionId, (env) => received.push(env));

    const promises: Promise<void>[] = [];
    for (let i = 1; i <= 5; i++) {
      promises.push(
        smallBatchBus.publish(sessionId, 'run-1', {
          type: 'user.message',
          messageId: `msg-${i}`,
          text: `Message ${i}`,
          attachments: [],
        }),
      );
    }

    await Promise.all(promises);
    expect(received).toHaveLength(5);
    expect(eventsRepo.latestSeq(sessionId)).toBe(5);

    await smallBatchBus.close();
  });

  it('NEVER pushes to subscribers if DB write fails, and rejects publish callers', async () => {
    const received: SessionEventEnvelope[] = [];
    eventBus.subscribe(sessionId, (env) => {
      received.push(env);
    });

    // Spy and force appendBatch to throw
    const error = new Error('Disk I/O error');
    vi.spyOn(eventsRepo, 'appendBatch').mockImplementationOnce(() => {
      throw error;
    });

    const event: AgentEvent = {
      type: 'run.error',
      error: { code: 'INTERNAL', message: 'fail', retryable: false },
    };

    let caughtError: unknown;
    try {
      await eventBus.publish(sessionId, 'run-1', event);
    } catch (err) {
      caughtError = err;
    }

    expect(caughtError).toBe(error);
    // Crucial invariant: never pushed to subscribers!
    expect(received).toHaveLength(0);

    // Latest seq should be intact (0)
    expect(eventsRepo.latestSeq(sessionId)).toBe(0);

    // Next publish should still work with seq = 1
    await eventBus.publish(sessionId, 'run-1', {
      type: 'run.started',
      runId: 'run-2',
      model: null,
      cwd: '/tmp',
    });

    expect(received).toHaveLength(1);
    expect(received[0].seq).toBe(1);
    expect(eventsRepo.latestSeq(sessionId)).toBe(1);
  });

  it('handles multiple concurrent subscribers and unsubscribes cleanly', async () => {
    const sub1Events: SessionEventEnvelope[] = [];
    const sub2Events: SessionEventEnvelope[] = [];

    const unsub1 = eventBus.subscribe(sessionId, (e) => sub1Events.push(e));
    const unsub2 = eventBus.subscribe(sessionId, (e) => sub2Events.push(e));

    await eventBus.publish(sessionId, 'run-1', {
      type: 'message.done',
      messageId: 'm1',
    });

    expect(sub1Events).toHaveLength(1);
    expect(sub2Events).toHaveLength(1);

    // Unsubscribe sub1
    unsub1();

    await eventBus.publish(sessionId, 'run-1', {
      type: 'message.done',
      messageId: 'm2',
    });

    expect(sub1Events).toHaveLength(1);
    expect(sub2Events).toHaveLength(2);

    unsub2();
  });

  it('handles global events publication and subscription', () => {
    const received: any[] = [];
    const unsub = eventBus.subscribeGlobal((g) => received.push(g));

    eventBus.publishGlobal({
      type: 'session.deleted',
      sessionId: 'sess-deleted-1',
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      type: 'session.deleted',
      sessionId: 'sess-deleted-1',
    });

    unsub();
    eventBus.publishGlobal({
      type: 'session.deleted',
      sessionId: 'sess-deleted-2',
    });
    expect(received).toHaveLength(1);
  });

  it('supports explicit flush() for specific session or all sessions', async () => {
    const longTimerBus = new EventBus({
      eventsRepo,
      flushIntervalMs: 10_000,
    });

    const received: SessionEventEnvelope[] = [];
    longTimerBus.subscribe(sessionId, (e) => received.push(e));

    const p = longTimerBus.publish(sessionId, 'run-1', {
      type: 'message.done',
      messageId: 'm-flush',
    });

    expect(eventsRepo.latestSeq(sessionId)).toBe(0);
    await longTimerBus.flush(sessionId);
    await p;

    expect(eventsRepo.latestSeq(sessionId)).toBe(1);
    expect(received).toHaveLength(1);

    await longTimerBus.close();
  });
});
