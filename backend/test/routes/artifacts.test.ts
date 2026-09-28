import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { Artifact, TranscriptStep } from '@agy-studio/contracts';
import {
  createDatabase,
  EventsRepository,
  SessionsRepository,
  WorkspacesRepository,
} from '../../src/repositories/index.js';
import { EventBus } from '../../src/services/event-bus.js';
import { ArtifactService } from '../../src/services/artifact.js';
import { artifactsRoutes } from '../../src/routes/http/artifacts.routes.js';
import type { BrainPort } from '../../src/services/ports/brain.port.js';

describe('Artifacts HTTP Routes', () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let sessionsRepo: SessionsRepository;
  let workspacesRepo: WorkspacesRepository;
  let eventsRepo: EventsRepository;
  let eventBus: EventBus;
  let mockBrainPort: any;
  let mockSupervisor: any;
  let artifactService: ArtifactService;
  let tempDir: string;

  const sessionId = 'session-route-test-1';
  const mainConvId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const subagentConvId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  beforeEach(async () => {
    db = createDatabase(':memory:');
    sessionsRepo = new SessionsRepository(db);
    workspacesRepo = new WorkspacesRepository(db);
    eventsRepo = new EventsRepository(db);
    eventBus = new EventBus({ eventsRepo, deltaCoalesceMs: 10 });

    workspacesRepo.create({
      id: 'ws-test',
      name: 'Test WS',
      path: 'G:/fake/project',
      isGitRepo: false,
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-artifacts-route-test-'));

    mockSupervisor = {
      addEventListener: vi.fn().mockReturnValue(() => {}),
    };

    mockBrainPort = {
      listConversations: vi.fn().mockResolvedValue([]),
      tailTranscript: vi.fn(),
      listArtifacts: vi.fn().mockResolvedValue([]),
      watchArtifacts: vi.fn().mockResolvedValue({ stop: vi.fn() }),
      purgeConversation: vi.fn().mockResolvedValue(undefined),
      resolveConversationDir: vi.fn((convId: string) => path.join(tempDir, convId)),
    };

    artifactService = new ArtifactService({
      brainPort: mockBrainPort as unknown as BrainPort,
      sessionsRepo,
      eventBus,
      supervisor: mockSupervisor,
      eventsRepo,
      resolveConversationDir: (convId: string) => path.join(tempDir, convId),
    });

    app = Fastify();
    await app.register(artifactsRoutes, { artifactService });
  });

  afterEach(async () => {
    artifactService.dispose();
    await app.close();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('GET /api/sessions/:sessionId/artifacts', () => {
    it('returns 200 with list of artifacts', async () => {
      const mockArtifact: Artifact = {
        id: Buffer.from(`${mainConvId}/task.md`).toString('base64url'),
        sessionId,
        conversationId: mainConvId,
        kind: 'task',
        name: 'task.md',
        relativePath: 'task.md',
        mimeType: 'text/markdown',
        size: 120,
        version: 1,
        updatedAt: new Date().toISOString(),
      };

      mockBrainPort.listArtifacts.mockResolvedValueOnce([mockArtifact]);

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}/artifacts`,
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(Array.isArray(data)).toBe(true);
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe('task.md');
      expect(data[0].id).toBe(mockArtifact.id);
    });

    it('returns 404 when session is not found', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/sessions/non-existent-session/artifacts',
      });

      expect(res.statusCode).toBe(404);
      const data = JSON.parse(res.body);
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /api/sessions/:sessionId/artifacts/:artifactId/raw', () => {
    let convDir: string;

    beforeEach(() => {
      convDir = path.join(tempDir, mainConvId);
      fs.mkdirSync(convDir, { recursive: true });
    });

    it('streams raw file content with mimeType and nosniff header', async () => {
      const filePath = path.join(convDir, 'readme.txt');
      fs.writeFileSync(filePath, 'plain text content', 'utf-8');

      const artifactId = Buffer.from(`${mainConvId}/readme.txt`).toString('base64url');

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}/artifacts/${artifactId}/raw`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('plain text content');
      expect(res.headers['content-type']).toBe('text/plain');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-disposition']).toBe('inline; filename="readme.txt"');
    });

    it('sets Content-Disposition attachment header for SVG files', async () => {
      const svgPath = path.join(convDir, 'chart.svg');
      fs.writeFileSync(svgPath, '<svg><rect width="100" height="100"/></svg>', 'utf-8');

      const artifactId = Buffer.from(`${mainConvId}/chart.svg`).toString('base64url');

      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}/artifacts/${artifactId}/raw`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('image/svg+xml');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-disposition']).toBe('attachment; filename="chart.svg"');
      expect(res.body).toContain('<svg>');
    });

    it('returns 400 for malformed or non-UUID artifact ID', async () => {
      const badId = Buffer.from('bad_id_no_slash').toString('base64url');
      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}/artifacts/${badId}/raw`,
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.body);
      expect(data.error.code).toBe('BAD_REQUEST');
    });

    it('returns 403 when artifact path escapes directory (path traversal)', async () => {
      const traversalId = Buffer.from(`${mainConvId}/../../etc/passwd`).toString('base64url');
      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}/artifacts/${traversalId}/raw`,
      });

      expect(res.statusCode).toBe(403);
      const data = JSON.parse(res.body);
      expect(data.error.code).toBe('PATH_OUTSIDE_WORKSPACE');
    });

    it('returns 404 when artifact file does not exist', async () => {
      const missingId = Buffer.from(`${mainConvId}/non-existent.txt`).toString('base64url');
      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}/artifacts/${missingId}/raw`,
      });

      expect(res.statusCode).toBe(404);
      const data = JSON.parse(res.body);
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });

  describe('GET /api/sessions/:sessionId/subagents/:conversationId/transcript', () => {
    it('returns 200 with steps and total', async () => {
      artifactService.recordSubagent(sessionId, subagentConvId);

      const mockSteps: TranscriptStep[] = [
        {
          stepIndex: 0,
          type: 'user',
          status: 'completed',
          createdAt: '2026-09-28T10:00:00.000Z',
          content: 'Run analysis',
          thinking: null,
          toolCalls: [],
          error: null,
        },
        {
          stepIndex: 1,
          type: 'assistant',
          status: 'completed',
          createdAt: '2026-09-28T10:00:01.000Z',
          content: 'Analysis done',
          thinking: null,
          toolCalls: [],
          error: null,
        },
      ];

      mockBrainPort.tailTranscript.mockResolvedValueOnce({
        steps: (async function* () {
          for (const s of mockSteps) yield s;
        })(),
        stop: vi.fn(),
      });

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
      artifactService.recordSubagent(sessionId, subagentConvId);

      const mockSteps: TranscriptStep[] = [
        {
          stepIndex: 0,
          type: 'user',
          status: 'completed',
          createdAt: null,
          content: '0',
          thinking: null,
          toolCalls: [],
          error: null,
        },
        {
          stepIndex: 1,
          type: 'assistant',
          status: 'completed',
          createdAt: null,
          content: '1',
          thinking: null,
          toolCalls: [],
          error: null,
        },
        {
          stepIndex: 2,
          type: 'assistant',
          status: 'completed',
          createdAt: null,
          content: '2',
          thinking: null,
          toolCalls: [],
          error: null,
        },
      ];

      mockBrainPort.tailTranscript.mockResolvedValueOnce({
        steps: (async function* () {
          for (const s of mockSteps) yield s;
        })(),
        stop: vi.fn(),
      });

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
      const data = JSON.parse(res.body);
      expect(data.error.code).toBe('BAD_REQUEST');
    });

    it('returns 400 for invalid UUID in conversationId', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/${sessionId}/subagents/not-a-uuid/transcript`,
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.body);
      expect(data.error.code).toBe('BAD_REQUEST');
    });

    it('returns 404 for unknown session', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/sessions/unknown-session/subagents/${subagentConvId}/transcript`,
      });

      expect(res.statusCode).toBe(404);
      const data = JSON.parse(res.body);
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });
});
