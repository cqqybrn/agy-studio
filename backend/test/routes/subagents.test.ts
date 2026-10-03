import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { TranscriptStep } from '@agy-studio/contracts';
import {
  createDatabase,
  EventsRepository,
  SessionsRepository,
  WorkspacesRepository,
} from '../../src/repositories/index.js';
import { SubagentTranscriptService } from '../../src/services/subagent-transcript.js';
import { subagentsRoutes } from '../../src/routes/http/subagents.routes.js';
import type { BrainPort } from '../../src/services/ports/brain.port.js';

function step(stepIndex: number, content: string): TranscriptStep {
  return {
    stepIndex,
    type: stepIndex === 0 ? 'user' : 'assistant',
    status: 'completed',
    createdAt: null,
    content,
    thinking: null,
    toolCalls: [],
    error: null,
  };
}

describe('GET /api/sessions/:sessionId/subagents/:conversationId/transcript', () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let mockBrainPort: { tailTranscript: ReturnType<typeof vi.fn> };
  let service: SubagentTranscriptService;
  let tempDir: string;

  const sessionId = 'session-route-test-1';
  const mainConvId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const subagentConvId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  const mockTail = (steps: TranscriptStep[]) =>
    mockBrainPort.tailTranscript.mockResolvedValueOnce({
      steps: (async function* () {
        for (const s of steps) yield s;
      })(),
      stop: vi.fn(),
    });

  beforeEach(async () => {
    db = createDatabase(':memory:');
    const sessionsRepo = new SessionsRepository(db);
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

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-subagents-route-test-'));
    mockBrainPort = { tailTranscript: vi.fn() };
    service = new SubagentTranscriptService({
      brainPort: mockBrainPort as unknown as BrainPort,
      sessionsRepo,
      eventsRepo: new EventsRepository(db),
      resolveConversationDir: (convId: string) => path.join(tempDir, convId),
    });

    app = Fastify();
    await app.register(subagentsRoutes, { subagentTranscriptService: service });
  });

  afterEach(async () => {
    service.dispose();
    await app.close();
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns 200 with steps and total', async () => {
    service.recordSubagent(sessionId, subagentConvId);
    mockTail([step(0, 'Run analysis'), step(1, 'Analysis done')]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/subagents/${subagentConvId}/transcript`,
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.total).toBe(2);
    expect(data.steps).toHaveLength(2);
    expect(data.steps[0].content).toBe('Run analysis');
  });

  it('supports afterStep and limit query parameters', async () => {
    service.recordSubagent(sessionId, subagentConvId);
    mockTail([step(0, '0'), step(1, '1'), step(2, '2')]);

    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/subagents/${subagentConvId}/transcript?afterStep=0&limit=1`,
    });

    expect(res.statusCode).toBe(200);
    const data = JSON.parse(res.body);
    expect(data.total).toBe(3);
    expect(data.steps).toHaveLength(1);
    expect(data.steps[0].stepIndex).toBe(1);
  });

  it('returns 400 for invalid query parameters', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/subagents/${subagentConvId}/transcript?afterStep=-1`,
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('BAD_REQUEST');
  });

  it('returns 400 for invalid UUID in conversationId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/${sessionId}/subagents/not-a-uuid/transcript`,
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error.code).toBe('BAD_REQUEST');
  });

  it('returns 404 for unknown session', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/sessions/unknown-session/subagents/${subagentConvId}/transcript`,
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).error.code).toBe('NOT_FOUND');
  });
});
