import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { AgentEvent, TranscriptStep } from '@agy-studio/contracts';
import {
  createDatabase,
  EventsRepository,
  SessionsRepository,
  WorkspacesRepository,
} from '../../src/repositories/index.js';
import { SubagentTranscriptService } from '../../src/services/subagent-transcript.js';
import type { BrainPort } from '../../src/services/ports/brain.port.js';
import type { SupervisorEventListener } from '../../src/services/run-supervisor.js';
import { AppError } from '../../src/utils/errors.js';

function step(stepIndex: number, content: string | null, extra: Partial<TranscriptStep> = {}): TranscriptStep {
  return {
    stepIndex,
    type: 'assistant',
    status: 'completed',
    createdAt: null,
    content,
    thinking: null,
    toolCalls: [],
    error: null,
    ...extra,
  };
}

describe('SubagentTranscriptService', () => {
  let db: Database.Database;
  let sessionsRepo: SessionsRepository;
  let eventsRepo: EventsRepository;
  let mockBrainPort: { tailTranscript: ReturnType<typeof vi.fn> };
  let supervisorListeners: SupervisorEventListener[];
  let service: SubagentTranscriptService;
  let tempDir: string;

  const sessionId = 'session-test-uuid-1';
  const mainConvId = '11111111-1111-4111-8111-111111111111';
  const subagentConvId = '22222222-2222-4222-8222-222222222222';

  const mockTail = (steps: TranscriptStep[]) =>
    mockBrainPort.tailTranscript.mockImplementation(() =>
      Promise.resolve({
        steps: (async function* () {
          for (const s of steps) yield s;
        })(),
        stop: vi.fn(),
      }),
    );

  beforeEach(() => {
    db = createDatabase(':memory:');
    sessionsRepo = new SessionsRepository(db);
    eventsRepo = new EventsRepository(db);
    const now = new Date().toISOString();
    new WorkspacesRepository(db).create({
      id: 'ws-test',
      name: 'Test WS',
      path: 'G:/fake/project',
      isGitRepo: false,
      createdAt: now,
      lastOpenedAt: now,
    });
    sessionsRepo.create({
      id: sessionId,
      workspaceId: 'ws-test',
      accountName: 'default-acc',
      title: 'Main Session',
      agyConversationId: mainConvId,
      status: 'idle',
      model: 'test-model',
      effort: 'medium',
      mode: 'agent',
      source: 'studio',
      lastRunId: null,
      lastSeq: 0,
      createdAt: now,
      updatedAt: now,
    });

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-subagent-transcript-test-'));
    supervisorListeners = [];
    mockBrainPort = { tailTranscript: vi.fn() };

    service = new SubagentTranscriptService({
      brainPort: mockBrainPort as unknown as BrainPort,
      sessionsRepo,
      eventsRepo,
      supervisor: {
        addEventListener: (listener) => {
          supervisorListeners.push(listener);
          return () => supervisorListeners.splice(supervisorListeners.indexOf(listener), 1);
        },
      },
      resolveConversationDir: (convId: string) => path.join(tempDir, convId),
    });
  });

  afterEach(() => {
    service.dispose();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('throws AppError(BAD_REQUEST) on non-UUID conversationId', async () => {
    await expect(service.getSubagentTranscript(sessionId, 'invalid-uuid')).rejects.toThrowError(AppError);
  });

  it('throws AppError(NOT_FOUND) on unknown session or unassociated conversation', async () => {
    const foreignConv = '44444444-4444-4444-8444-444444444444';
    await expect(service.getSubagentTranscript(sessionId, foreignConv)).rejects.toThrowError(AppError);
    await expect(service.getSubagentTranscript('no-such-session', subagentConvId)).rejects.toThrowError(
      AppError,
    );
  });

  it('retrieves subagent transcript with afterStep and limit pagination', async () => {
    service.recordSubagent(sessionId, subagentConvId);
    mockTail([step(0, 'Hello subagent', { type: 'user' }), step(1, null, { thinking: 'Thinking...' }), step(2, 'Done')]);

    const all = await service.getSubagentTranscript(sessionId, subagentConvId);
    expect(all.total).toBe(3);
    expect(all.steps).toHaveLength(3);

    const after0 = await service.getSubagentTranscript(sessionId, subagentConvId, { afterStep: 0 });
    expect(after0.total).toBe(3);
    expect(after0.steps.map((s) => s.stepIndex)).toEqual([1, 2]);

    const limit1 = await service.getSubagentTranscript(sessionId, subagentConvId, { limit: 1 });
    expect(limit1.steps.map((s) => s.stepIndex)).toEqual([0]);
  });

  it('accepts subagents announced by the supervisor while a run is in progress', async () => {
    const spawned = {
      type: 'subagent.spawned',
      subagent: { conversationId: subagentConvId },
    } as unknown as AgentEvent;
    for (const listener of supervisorListeners) await listener(sessionId, 'run-1', spawned);

    expect(service.isSubagentOfSession(sessionId, subagentConvId)).toBe(true);
    service.dispose();
    expect(supervisorListeners).toHaveLength(0);
  });

  it('reads transcript.jsonl from disk before falling back to tailTranscript', async () => {
    service.recordSubagent(sessionId, subagentConvId);
    const logs = path.join(tempDir, subagentConvId, '.system_generated', 'logs');
    fs.mkdirSync(logs, { recursive: true });
    fs.writeFileSync(
      path.join(logs, 'transcript.jsonl'),
      [
        JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', content: 'second' }),
        'not json',
        JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'first' }),
      ].join('\n'),
    );

    const res = await service.getSubagentTranscript(sessionId, subagentConvId);
    expect(res.steps.map((s) => [s.stepIndex, s.type, s.content])).toEqual([
      [0, 'USER_INPUT', 'first'],
      [1, 'PLANNER_RESPONSE', 'second'],
    ]);
    expect(mockBrainPort.tailTranscript).not.toHaveBeenCalled();
  });
});
