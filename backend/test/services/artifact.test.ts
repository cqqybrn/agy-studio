import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type {
  AgentEvent,
  Artifact,
  Session,
  TranscriptStep,
} from '@agy-studio/contracts';
import {
  createDatabase,
  EventsRepository,
  SessionsRepository,
  WorkspacesRepository,
} from '../../src/repositories/index.js';
import { EventBus } from '../../src/services/event-bus.js';
import { ArtifactService } from '../../src/services/artifact.js';
import type { ArtifactWatchHandle, BrainPort } from '../../src/services/ports/brain.port.js';
import type { SupervisorEventListener } from '../../src/services/run-supervisor.js';
import { AppError } from '../../src/utils/errors.js';

describe('ArtifactService', () => {
  let db: Database.Database;
  let sessionsRepo: SessionsRepository;
  let workspacesRepo: WorkspacesRepository;
  let eventsRepo: EventsRepository;
  let eventBus: EventBus;
  let mockBrainPort: {
    listConversations: ReturnType<typeof vi.fn>;
    tailTranscript: ReturnType<typeof vi.fn>;
    listArtifacts: ReturnType<typeof vi.fn>;
    watchArtifacts: ReturnType<typeof vi.fn>;
    purgeConversation: ReturnType<typeof vi.fn>;
    resolveConversationDir: ReturnType<typeof vi.fn>;
  };
  let supervisorListeners: SupervisorEventListener[];
  let mockSupervisor: {
    addEventListener: ReturnType<typeof vi.fn>;
  };
  let artifactService: ArtifactService;
  let tempDir: string;

  const sessionId = 'session-test-uuid-1';
  const mainConvId = '11111111-1111-4111-8111-111111111111';
  const subagentConvId = '22222222-2222-4222-8222-222222222222';

  beforeEach(() => {
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

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-artifact-test-'));

    supervisorListeners = [];
    mockSupervisor = {
      addEventListener: vi.fn((listener: SupervisorEventListener) => {
        supervisorListeners.push(listener);
        return () => {
          const idx = supervisorListeners.indexOf(listener);
          if (idx >= 0) supervisorListeners.splice(idx, 1);
        };
      }),
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
      debounceMs: 300,
      cleanupDelayMs: 5000,
      resolveConversationDir: (convId: string) => path.join(tempDir, convId),
    });
  });

  afterEach(() => {
    artifactService.dispose();
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    vi.useRealTimers();
  });

  const emitSupervisorEvent = async (sid: string, rid: string, event: AgentEvent) => {
    for (const listener of supervisorListeners) {
      await listener(sid, rid, event);
    }
  };

  describe('Supervisor Event Listening & Dynamic Watching', () => {
    it('watches main conversation when run.started is emitted', async () => {
      const runId = 'run-1';
      await emitSupervisorEvent(sessionId, runId, {
        type: 'run.started',
        runId,
        model: 'test-model',
        cwd: 'G:/fake',
        checkpointId: null,
      });

      expect(mockBrainPort.watchArtifacts).toHaveBeenCalledTimes(1);
      expect(mockBrainPort.watchArtifacts).toHaveBeenCalledWith(
        mainConvId,
        sessionId,
        expect.any(Function),
        undefined,
      );
    });

    it('dynamically watches subagent conversation when subagent.spawned is emitted', async () => {
      const runId = 'run-1';
      await emitSupervisorEvent(sessionId, runId, {
        type: 'run.started',
        runId,
        model: 'test-model',
        cwd: 'G:/fake',
        checkpointId: null,
      });

      await emitSupervisorEvent(sessionId, runId, {
        type: 'subagent.spawned',
        parentToolCallId: 'tool-call-1',
        subagent: {
          conversationId: subagentConvId,
          role: 'reviewer',
          typeName: 'code_reviewer',
          initialPrompt: 'Review changes',
          status: 'running',
        },
      });

      expect(mockBrainPort.watchArtifacts).toHaveBeenCalledTimes(2);
      expect(mockBrainPort.watchArtifacts).toHaveBeenNthCalledWith(
        2,
        subagentConvId,
        sessionId,
        expect.any(Function),
        undefined,
      );
    });

    it('cleans up all watch handles 5 seconds after run.completed', async () => {
      vi.useFakeTimers();

      const mainHandle: ArtifactWatchHandle = { stop: vi.fn() };
      const subHandle: ArtifactWatchHandle = { stop: vi.fn() };

      mockBrainPort.watchArtifacts
        .mockResolvedValueOnce(mainHandle)
        .mockResolvedValueOnce(subHandle);

      const runId = 'run-1';
      await emitSupervisorEvent(sessionId, runId, {
        type: 'run.started',
        runId,
        model: 'test-model',
        cwd: 'G:/fake',
        checkpointId: null,
      });

      await emitSupervisorEvent(sessionId, runId, {
        type: 'subagent.spawned',
        parentToolCallId: 'tool-1',
        subagent: {
          conversationId: subagentConvId,
          role: 'sub',
          typeName: 'sub',
          initialPrompt: null,
          status: 'running',
        },
      });

      await emitSupervisorEvent(sessionId, runId, {
        type: 'run.completed',
        status: 'completed',
        usage: null,
        error: null,
        durationMs: 1000,
        agyConversationId: mainConvId,
      });

      // Before 5 seconds, handles must NOT be stopped
      vi.advanceTimersByTime(4000);
      expect(mainHandle.stop).not.toHaveBeenCalled();
      expect(subHandle.stop).not.toHaveBeenCalled();

      // At 5 seconds (5000ms), all handles must be stopped
      vi.advanceTimersByTime(1000);
      expect(mainHandle.stop).toHaveBeenCalledTimes(1);
      expect(subHandle.stop).toHaveBeenCalledTimes(1);
    });
  });

  describe('300ms Debounce Mechanism & Version Increment', () => {
    it('debounces rapid onChange events by 300ms and increments version', async () => {
      vi.useFakeTimers();
      const publishSpy = vi.spyOn(eventBus, 'publish').mockResolvedValue(undefined);

      let onChangeCallback: ((artifact: Artifact) => void) | undefined;
      mockBrainPort.watchArtifacts.mockImplementation(
        async (_convId, _sid, onChange: (artifact: Artifact) => void) => {
          onChangeCallback = onChange;
          return { stop: vi.fn() };
        },
      );

      const runId = 'run-1';
      await emitSupervisorEvent(sessionId, runId, {
        type: 'run.started',
        runId,
        model: 'test-model',
        cwd: 'G:/fake',
        checkpointId: null,
      });

      expect(onChangeCallback).toBeDefined();

      const sampleArtifact: Artifact = {
        id: Buffer.from(`${mainConvId}/task.md`).toString('base64url'),
        sessionId,
        conversationId: mainConvId,
        kind: 'task',
        name: 'task.md',
        relativePath: 'task.md',
        mimeType: 'text/markdown',
        size: 100,
        version: 1,
        updatedAt: new Date().toISOString(),
      };

      // 1st change
      onChangeCallback!(sampleArtifact);

      // Advance by 100ms (not yet 300ms)
      vi.advanceTimersByTime(100);
      expect(publishSpy).not.toHaveBeenCalled();

      // 2nd change (same artifact, content updated)
      onChangeCallback!({ ...sampleArtifact, size: 200 });

      // Advance another 200ms (300ms from start, but only 200ms from second update)
      vi.advanceTimersByTime(200);
      expect(publishSpy).not.toHaveBeenCalled();

      // Advance 100ms more (300ms has elapsed since second update)
      vi.advanceTimersByTime(100);
      expect(publishSpy).toHaveBeenCalledTimes(1);

      const published = publishSpy.mock.calls[0];
      expect(published[0]).toBe(sessionId);
      expect(published[1]).toBe(runId);
      expect(published[2].type).toBe('artifact.updated');
      if (published[2].type === 'artifact.updated') {
        expect(published[2].artifact.size).toBe(200);
        // Version should be incremented to 2
        expect(published[2].artifact.version).toBe(2);
      }
    });
  });

  describe('listArtifacts', () => {
    it('returns empty array when session has no agyConversationId', async () => {
      const emptySession: Session = {
        id: 'session-no-agy',
        workspaceId: 'ws-test',
        accountName: 'default-acc',
        title: 'Unbound Session',
        agyConversationId: null,
        status: 'idle',
        model: null,
        effort: null,
        mode: null,
        source: 'studio',
        lastRunId: null,
        lastSeq: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      sessionsRepo.create(emptySession);

      const list = await artifactService.listArtifacts('session-no-agy');
      expect(list).toEqual([]);
      expect(mockBrainPort.listArtifacts).not.toHaveBeenCalled();
    });

    it('throws AppError(NOT_FOUND) when session does not exist', async () => {
      await expect(artifactService.listArtifacts('non-existent')).rejects.toThrowError(AppError);
    });

    it('lists main conversation artifacts and includes subagent artifacts', async () => {
      const mainArtifact: Artifact = {
        id: Buffer.from(`${mainConvId}/plan.md`).toString('base64url'),
        sessionId,
        conversationId: mainConvId,
        kind: 'implementation_plan',
        name: 'plan.md',
        relativePath: 'plan.md',
        mimeType: 'text/markdown',
        size: 500,
        version: 1,
        updatedAt: new Date().toISOString(),
      };

      const subArtifact: Artifact = {
        id: Buffer.from(`${subagentConvId}/review.md`).toString('base64url'),
        sessionId,
        conversationId: subagentConvId,
        kind: 'walkthrough',
        name: 'review.md',
        relativePath: 'review.md',
        mimeType: 'text/markdown',
        size: 300,
        version: 1,
        updatedAt: new Date().toISOString(),
      };

      mockBrainPort.listArtifacts.mockImplementation(async (convId: string) => {
        if (convId === mainConvId) return [mainArtifact];
        if (convId === subagentConvId) return [subArtifact];
        return [];
      });

      // Register subagent
      artifactService.recordSubagent(sessionId, subagentConvId);

      const result = await artifactService.listArtifacts(sessionId);
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.name)).toEqual(['plan.md', 'review.md']);
    });
  });

  describe('getArtifactRaw & Security Checks', () => {
    let mainConvDir: string;

    beforeEach(() => {
      mainConvDir = path.join(tempDir, mainConvId);
      fs.mkdirSync(mainConvDir, { recursive: true });
    });

    it('returns raw file stream, mimeType and isSvg: false for normal file', async () => {
      const filePath = path.join(mainConvDir, 'doc.md');
      fs.writeFileSync(filePath, '# Hello World\nSome markdown contents', 'utf-8');

      const artifactId = Buffer.from(`${mainConvId}/doc.md`).toString('base64url');
      const raw = await artifactService.getArtifactRaw(sessionId, artifactId);

      expect(raw.fileName).toBe('doc.md');
      expect(raw.mimeType).toBe('text/markdown');
      expect(raw.isSvg).toBe(false);

      const chunks: Buffer[] = [];
      for await (const chunk of raw.stream as NodeJS.ReadableStream) {
        chunks.push(Buffer.from(chunk));
      }
      expect(Buffer.concat(chunks).toString('utf-8')).toBe(
        '# Hello World\nSome markdown contents',
      );
    });

    it('identifies SVG files and marks isSvg = true', async () => {
      const filePath = path.join(mainConvDir, 'diagram.svg');
      fs.writeFileSync(filePath, '<svg><circle cx="50" cy="50" r="40"/></svg>', 'utf-8');

      const artifactId = Buffer.from(`${mainConvId}/diagram.svg`).toString('base64url');
      const raw = await artifactService.getArtifactRaw(sessionId, artifactId);

      expect(raw.fileName).toBe('diagram.svg');
      expect(raw.mimeType).toBe('image/svg+xml');
      expect(raw.isSvg).toBe(true);

      for await (const _ of raw.stream as NodeJS.ReadableStream) {
        // fully consume stream
      }
    });

    it('rejects invalid base64url or malformed artifactId', async () => {
      // Missing slash in decoded ID
      const noSlashId = Buffer.from('justAStringNoSlash').toString('base64url');
      await expect(artifactService.getArtifactRaw(sessionId, noSlashId)).rejects.toThrowError(
        AppError,
      );

      // Empty relative path
      const emptyRelId = Buffer.from(`${mainConvId}/`).toString('base64url');
      await expect(artifactService.getArtifactRaw(sessionId, emptyRelId)).rejects.toThrowError(
        AppError,
      );
    });

    it('rejects invalid UUID in conversationId', async () => {
      const badUuidId = Buffer.from('not-a-uuid/file.txt').toString('base64url');
      await expect(artifactService.getArtifactRaw(sessionId, badUuidId)).rejects.toThrowError(
        AppError,
      );
    });

    it('rejects path traversal with ..', async () => {
      const traversalId = Buffer.from(`${mainConvId}/../../etc/passwd`).toString('base64url');
      try {
        await artifactService.getArtifactRaw(sessionId, traversalId);
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.code).toBe('PATH_OUTSIDE_WORKSPACE');
      }
    });

    it('rejects absolute paths', async () => {
      const absId = Buffer.from(`${mainConvId}//etc/passwd`).toString('base64url');
      try {
        await artifactService.getArtifactRaw(sessionId, absId);
        expect.unreachable('Should have thrown');
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.code).toBe('PATH_OUTSIDE_WORKSPACE');
      }
    });

    it('rejects symbolic links', async () => {
      const outsideFile = path.join(tempDir, 'outside.txt');
      fs.writeFileSync(outsideFile, 'secret contents');

      const symlinkPath = path.join(mainConvDir, 'link.txt');
      try {
        fs.symlinkSync(outsideFile, symlinkPath);
      } catch {
        // Windows privilege fallback: if symlink cannot be created without elevation, skip
        return;
      }

      const symlinkArtifactId = Buffer.from(`${mainConvId}/link.txt`).toString('base64url');
      try {
        await artifactService.getArtifactRaw(sessionId, symlinkArtifactId);
        expect.unreachable('Should have thrown on symlink');
      } catch (err: any) {
        expect(err).toBeInstanceOf(AppError);
        expect(err.code).toBe('PATH_OUTSIDE_WORKSPACE');
      }
    });

    it('throws AppError(NOT_FOUND) when file does not exist', async () => {
      const missingId = Buffer.from(`${mainConvId}/missing.md`).toString('base64url');
      await expect(artifactService.getArtifactRaw(sessionId, missingId)).rejects.toThrowError(
        AppError,
      );
    });

    it('throws AppError(NOT_FOUND) when conversation does not match session', async () => {
      const otherConvId = '33333333-3333-4333-8333-333333333333';
      const foreignId = Buffer.from(`${otherConvId}/file.md`).toString('base64url');
      await expect(artifactService.getArtifactRaw(sessionId, foreignId)).rejects.toThrowError(
        AppError,
      );
    });
  });

  describe('getSubagentTranscript', () => {
    it('throws AppError(BAD_REQUEST) on non-UUID conversationId', async () => {
      await expect(
        artifactService.getSubagentTranscript(sessionId, 'invalid-uuid'),
      ).rejects.toThrowError(AppError);
    });

    it('throws AppError(NOT_FOUND) on unknown session or unassociated conversation', async () => {
      const foreignConv = '44444444-4444-4444-8444-444444444444';
      await expect(
        artifactService.getSubagentTranscript(sessionId, foreignConv),
      ).rejects.toThrowError(AppError);
    });

    it('retrieves subagent transcript with afterStep and limit pagination', async () => {
      artifactService.recordSubagent(sessionId, subagentConvId);

      const mockSteps: TranscriptStep[] = [
        {
          stepIndex: 0,
          type: 'user',
          status: 'completed',
          createdAt: '2026-09-28T10:00:00.000Z',
          content: 'Hello subagent',
          thinking: null,
          toolCalls: [],
          error: null,
        },
        {
          stepIndex: 1,
          type: 'thought',
          status: 'completed',
          createdAt: '2026-09-28T10:00:01.000Z',
          content: null,
          thinking: 'Thinking about the task...',
          toolCalls: [],
          error: null,
        },
        {
          stepIndex: 2,
          type: 'assistant',
          status: 'completed',
          createdAt: '2026-09-28T10:00:02.000Z',
          content: 'I have finished',
          thinking: null,
          toolCalls: [],
          error: null,
        },
      ];

      mockBrainPort.tailTranscript.mockImplementation(() =>
        Promise.resolve({
          steps: (async function* () {
            for (const s of mockSteps) yield s;
          })(),
          stop: vi.fn(),
        }),
      );

      // 1. All steps
      const resAll = await artifactService.getSubagentTranscript(sessionId, subagentConvId);
      expect(resAll.total).toBe(3);
      expect(resAll.steps).toHaveLength(3);

      // 2. afterStep = 0
      const resAfter0 = await artifactService.getSubagentTranscript(sessionId, subagentConvId, {
        afterStep: 0,
      });
      expect(resAfter0.total).toBe(3);
      expect(resAfter0.steps.map((s) => s.stepIndex)).toEqual([1, 2]);

      // 3. limit = 1
      const resLimit1 = await artifactService.getSubagentTranscript(sessionId, subagentConvId, {
        limit: 1,
      });
      expect(resLimit1.total).toBe(3);
      expect(resLimit1.steps).toHaveLength(1);
      expect(resLimit1.steps[0].stepIndex).toBe(0);
    });
  });
});
