import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import {
  createDatabase,
  getCurrentVersion,
  migrations,
  WorkspacesRepository,
  SessionsRepository,
  RunsRepository,
  EventsRepository,
  AttachmentsRepository,
  CheckpointsRepository,
  AccountsRepository,
  QuotaCacheRepository,
  PrefsRepository,
  DEFAULT_PREFS,
} from '../../src/repositories/index.js';
import type {
  RunRecord,
  StoredAccount,
} from '../../src/repositories/index.js';
import type {
  Attachment,
  Checkpoint,
  Session,
  SessionEventEnvelope,
  Workspace,
  QuotaSnapshot,
} from '@agy-studio/contracts';

describe('Repositories Integration Tests', () => {
  let tempDir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-repo-test-'));
    dbPath = path.join(tempDir, 'test.db');
    db = createDatabase({ dbPath });
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  describe('db and migrations', () => {
    it('creates database with WAL mode and runs migrations', () => {
      const pragmaJournal = db.pragma('journal_mode', { simple: true });
      expect(pragmaJournal).toBe('wal');

      const pragmaBusyTimeout = db.pragma('busy_timeout', { simple: true });
      expect(pragmaBusyTimeout).toBe(5000);

      const version = getCurrentVersion(db);
      expect(version).toBe(migrations.length);

      const migrationRows = db.prepare('SELECT * FROM schema_migrations').all();
      expect(migrationRows.length).toBe(migrations.length);
    });

    it('supports in-memory database', () => {
      const memDb = createDatabase(':memory:');
      expect(getCurrentVersion(memDb)).toBe(migrations.length);
      memDb.close();
    });
  });

  describe('WorkspacesRepository', () => {
    it('creates, finds, lists, updates and deletes workspaces', () => {
      const repo = new WorkspacesRepository(db);

      const now = new Date().toISOString();
      const ws: Workspace = {
        id: 'ws-1',
        name: 'Project Alpha',
        path: '/path/to/project-alpha',
        isGitRepo: true,
        createdAt: now,
        lastOpenedAt: now,
      };

      repo.create(ws);

      const found = repo.findById('ws-1');
      expect(found).toEqual(ws);

      const foundByPath = repo.findByPath('/path/to/project-alpha');
      expect(foundByPath).toEqual(ws);

      const list = repo.list();
      expect(list.length).toBe(1);
      expect(list[0]).toEqual(ws);

      const updated = repo.update('ws-1', { name: 'Alpha Renamed', isGitRepo: false });
      expect(updated?.name).toBe('Alpha Renamed');
      expect(updated?.isGitRepo).toBe(false);

      const touched = repo.touchLastOpened('ws-1', '2026-09-28T12:00:00.000Z');
      expect(touched?.lastOpenedAt).toBe('2026-09-28T12:00:00.000Z');

      expect(repo.delete('ws-1')).toBe(true);
      expect(repo.findById('ws-1')).toBeNull();
    });
  });

  describe('SessionsRepository', () => {
    it('creates, queries, paginates, updates, and deletes sessions', () => {
      const wsRepo = new WorkspacesRepository(db);
      const sessionRepo = new SessionsRepository(db);

      const now = new Date().toISOString();
      wsRepo.create({
        id: 'ws-1',
        name: 'Workspace 1',
        path: '/workspace/1',
        isGitRepo: false,
        createdAt: now,
        lastOpenedAt: now,
      });

      const session1: Session = {
        id: 'sess-1',
        workspaceId: 'ws-1',
        accountName: 'acct-1',
        title: 'Session One',
        agyConversationId: 'agy-conv-1',
        status: 'idle',
        model: 'gemini-2.5-pro',
        effort: 'high',
        mode: 'code',
        source: 'studio',
        lastRunId: null,
        lastSeq: 0,
        createdAt: '2026-09-28T10:00:00.000Z',
        updatedAt: '2026-09-28T10:00:00.000Z',
      };

      const session2: Session = {
        id: 'sess-2',
        workspaceId: 'ws-1',
        accountName: null,
        title: 'Session Two',
        agyConversationId: null,
        status: 'running',
        model: null,
        effort: null,
        mode: null,
        source: 'imported',
        lastRunId: 'run-1',
        lastSeq: 5,
        createdAt: '2026-09-28T11:00:00.000Z',
        updatedAt: '2026-09-28T11:00:00.000Z',
      };

      sessionRepo.create(session1);
      sessionRepo.create(session2);

      expect(sessionRepo.findById('sess-1')).toEqual(session1);
      expect(sessionRepo.findByAgyConversationId('agy-conv-1')).toEqual(session1);

      // Pagination test
      const page1 = sessionRepo.list({ workspaceId: 'ws-1', limit: 1 });
      expect(page1.items.length).toBe(1);
      expect(page1.total).toBe(2);
      expect(page1.hasMore).toBe(true);
      expect(page1.items[0].id).toBe('sess-2'); // ordered by updatedAt DESC
      expect(page1.nextCursor).not.toBeNull();

      const page2 = sessionRepo.list({
        workspaceId: 'ws-1',
        cursor: page1.nextCursor ?? undefined,
        limit: 1,
      });
      expect(page2.items.length).toBe(1);
      expect(page2.items[0].id).toBe('sess-1');
      expect(page2.hasMore).toBe(false);

      // Update
      const updated = sessionRepo.update('sess-1', {
        title: 'Session One Updated',
        status: 'error',
      });
      expect(updated?.title).toBe('Session One Updated');
      expect(updated?.status).toBe('error');

      // Update lastSeq
      sessionRepo.updateLastSeq('sess-1', 42);
      expect(sessionRepo.findById('sess-1')?.lastSeq).toBe(42);

      // Delete
      expect(sessionRepo.delete('sess-1')).toBe(true);
      expect(sessionRepo.findById('sess-1')).toBeNull();
    });
  });

  describe('RunsRepository', () => {
    it('creates, finds, lists non-terminal runs, updates and deletes', () => {
      const wsRepo = new WorkspacesRepository(db);
      const sessionRepo = new SessionsRepository(db);
      const runsRepo = new RunsRepository(db);

      const now = new Date().toISOString();
      wsRepo.create({
        id: 'ws-1',
        name: 'Workspace 1',
        path: '/workspace/1',
        isGitRepo: false,
        createdAt: now,
        lastOpenedAt: now,
      });
      sessionRepo.create({
        id: 'sess-1',
        workspaceId: 'ws-1',
        accountName: null,
        title: 'Session 1',
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

      const run1: RunRecord = {
        id: 'run-1',
        sessionId: 'sess-1',
        status: 'running',
        model: 'gemini-2.5-pro',
        accountName: 'acct-1',
        checkpointId: null,
        pid: 12345,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          thinkingTokens: 20,
          cacheReadTokens: 10,
          totalTokens: 180,
        },
        error: null,
        startedAt: now,
        endedAt: null,
      };

      const run2: RunRecord = {
        id: 'run-2',
        sessionId: 'sess-1',
        status: 'completed',
        model: 'gemini-2.5-pro',
        accountName: 'acct-1',
        checkpointId: 'chk-1',
        pid: null,
        usage: null,
        error: null,
        startedAt: now,
        endedAt: now,
      };

      const run3: RunRecord = {
        id: 'run-3',
        sessionId: 'sess-1',
        status: 'stalled',
        model: null,
        accountName: null,
        checkpointId: null,
        pid: 54321,
        usage: null,
        error: null,
        startedAt: now,
        endedAt: null,
      };

      runsRepo.create(run1);
      runsRepo.create(run2);
      runsRepo.create(run3);

      expect(runsRepo.findById('run-1')).toEqual(run1);

      const nonTerminal = runsRepo.listNonTerminal();
      expect(nonTerminal.map((r) => r.id).sort()).toEqual(['run-1', 'run-3']);

      // Update to terminal
      runsRepo.update('run-1', {
        status: 'failed',
        error: { code: 'AGY_TIMEOUT', message: 'Timed out', retryable: false },
        endedAt: now,
      });

      const nonTerminalAfter = runsRepo.listNonTerminal();
      expect(nonTerminalAfter.map((r) => r.id)).toEqual(['run-3']);

      expect(runsRepo.delete('run-2')).toBe(true);
      expect(runsRepo.findById('run-2')).toBeNull();
    });
  });

  describe('EventsRepository', () => {
    it('appends batch within transaction and updates sessions.last_seq', () => {
      const wsRepo = new WorkspacesRepository(db);
      const sessionRepo = new SessionsRepository(db);
      const eventsRepo = new EventsRepository(db);

      const now = new Date().toISOString();
      wsRepo.create({
        id: 'ws-1',
        name: 'Workspace 1',
        path: '/workspace/1',
        isGitRepo: false,
        createdAt: now,
        lastOpenedAt: now,
      });
      sessionRepo.create({
        id: 'sess-1',
        workspaceId: 'ws-1',
        accountName: null,
        title: 'Session 1',
        agyConversationId: null,
        status: 'running',
        model: null,
        effort: null,
        mode: null,
        source: 'studio',
        lastRunId: 'run-1',
        lastSeq: 0,
        createdAt: now,
        updatedAt: now,
      });

      const envelopes: SessionEventEnvelope[] = [
        {
          seq: 1,
          sessionId: 'sess-1',
          runId: 'run-1',
          ts: '2026-09-28T10:00:00.000Z',
          event: {
            type: 'run.started',
            runId: 'run-1',
            model: 'gemini-pro',
            cwd: '/workspace/1',
            checkpointId: null,
          },
        },
        {
          seq: 2,
          sessionId: 'sess-1',
          runId: 'run-1',
          ts: '2026-09-28T10:00:01.000Z',
          event: {
            type: 'user.message',
            messageId: 'msg-1',
            text: 'Hello',
            attachments: [],
          },
        },
        {
          seq: 3,
          sessionId: 'sess-1',
          runId: 'run-1',
          ts: '2026-09-28T10:00:02.000Z',
          event: {
            type: 'message.delta',
            messageId: 'msg-2',
            text: 'World',
          },
        },
      ];

      eventsRepo.appendBatch('sess-1', envelopes);

      // Verify sessions.last_seq updated
      const sess = sessionRepo.findById('sess-1');
      expect(sess?.lastSeq).toBe(3);

      // Verify latestSeq
      expect(eventsRepo.latestSeq('sess-1')).toBe(3);

      // Verify listAfter
      const after1 = eventsRepo.listAfter('sess-1', 1);
      expect(after1.length).toBe(2);
      expect(after1[0].seq).toBe(2);
      expect(after1[1].seq).toBe(3);

      const afterLimited = eventsRepo.listAfter('sess-1', 0, 2);
      expect(afterLimited.length).toBe(2);
      expect(afterLimited[0].seq).toBe(1);
      expect(afterLimited[1].seq).toBe(2);

      // Atomic rollback test: invalid envelope fails transaction and does not update lastSeq
      expect(() => {
        eventsRepo.appendBatch('sess-1', [
          {
            seq: 2, // duplicate primary key (sess-1, 2)
            sessionId: 'sess-1',
            runId: 'run-1',
            ts: '2026-09-28T10:00:03.000Z',
            event: { type: 'message.done', messageId: 'msg-2' },
          },
        ]);
      }).toThrow();

      expect(sessionRepo.findById('sess-1')?.lastSeq).toBe(3);
    });
  });

  describe('AttachmentsRepository', () => {
    it('creates, queries by id and ids, lists by session/workspace, updates, and deletes', () => {
      const wsRepo = new WorkspacesRepository(db);
      const sessionRepo = new SessionsRepository(db);
      const attachmentsRepo = new AttachmentsRepository(db);

      const now = new Date().toISOString();
      wsRepo.create({
        id: 'ws-1',
        name: 'Workspace 1',
        path: '/workspace/1',
        isGitRepo: false,
        createdAt: now,
        lastOpenedAt: now,
      });
      sessionRepo.create({
        id: 'sess-1',
        workspaceId: 'ws-1',
        accountName: null,
        title: 'Session 1',
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

      const att1: Attachment = {
        id: 'att-1',
        workspaceId: 'ws-1',
        sessionId: 'sess-1',
        kind: 'image',
        originalName: 'photo.png',
        mimeType: 'image/png',
        size: 1024,
        storedPath: '/workspace/1/.agy-attachments/photo.png',
        derivedTextPath: null,
        createdAt: now,
      };

      const att2: Attachment = {
        id: 'att-2',
        workspaceId: 'ws-1',
        sessionId: null,
        kind: 'file',
        originalName: 'report.pdf',
        mimeType: 'application/pdf',
        size: 2048,
        storedPath: '/workspace/1/.agy-attachments/report.pdf',
        derivedTextPath: '/workspace/1/.agy-attachments/report.txt',
        createdAt: now,
      };

      attachmentsRepo.create(att1);
      attachmentsRepo.create(att2);

      expect(attachmentsRepo.findById('att-1')).toEqual(att1);
      expect(attachmentsRepo.findByIds(['att-1', 'att-2']).length).toBe(2);

      expect(attachmentsRepo.listBySessionId('sess-1').length).toBe(1);
      expect(attachmentsRepo.listByWorkspaceId('ws-1').length).toBe(2);

      attachmentsRepo.update('att-2', { sessionId: 'sess-1' });
      expect(attachmentsRepo.findById('att-2')?.sessionId).toBe('sess-1');

      expect(attachmentsRepo.delete('att-1')).toBe(true);
      expect(attachmentsRepo.findById('att-1')).toBeNull();
    });
  });

  describe('CheckpointsRepository', () => {
    it('creates, finds by id and runId, lists, and deletes checkpoints', () => {
      const wsRepo = new WorkspacesRepository(db);
      const sessionRepo = new SessionsRepository(db);
      const runsRepo = new RunsRepository(db);
      const checkpointsRepo = new CheckpointsRepository(db);

      const now = new Date().toISOString();
      wsRepo.create({
        id: 'ws-1',
        name: 'Workspace 1',
        path: '/workspace/1',
        isGitRepo: true,
        createdAt: now,
        lastOpenedAt: now,
      });
      sessionRepo.create({
        id: 'sess-1',
        workspaceId: 'ws-1',
        accountName: null,
        title: 'Session 1',
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
      runsRepo.create({
        id: 'run-1',
        sessionId: 'sess-1',
        status: 'running',
        model: null,
        accountName: null,
        checkpointId: null,
        pid: null,
        usage: null,
        error: null,
        startedAt: now,
        endedAt: null,
      });

      const chk: Checkpoint = {
        id: 'chk-1',
        workspaceId: 'ws-1',
        sessionId: 'sess-1',
        runId: 'run-1',
        commitSha: 'abcdef1234567890',
        filesChanged: 3,
        createdAt: now,
      };

      checkpointsRepo.create(chk);

      expect(checkpointsRepo.findById('chk-1')).toEqual(chk);
      expect(checkpointsRepo.findByRunId('run-1')).toEqual(chk);
      expect(checkpointsRepo.listBySessionId('sess-1')).toEqual([chk]);
      expect(checkpointsRepo.listByWorkspaceId('ws-1')).toEqual([chk]);

      expect(checkpointsRepo.delete('chk-1')).toBe(true);
      expect(checkpointsRepo.findById('chk-1')).toBeNull();
    });
  });

  describe('AccountsRepository', () => {
    it('saves accounts, ensures no credentials are stored, and manages active/default account', () => {
      const repo = new AccountsRepository(db);
      const now = new Date().toISOString();

      const acct1: StoredAccount = {
        name: 'user-oauth',
        type: 'oauth',
        isolation: 'isolated_home',
        email: 'user@example.com',
        note: 'Default OAuth account',
        savedAt: now,
        active: true,
      };

      const acct2: StoredAccount = {
        name: 'user-apikey',
        type: 'apikey',
        isolation: 'isolated_home',
        email: null,
        note: 'Secondary key',
        savedAt: now,
        active: false,
      };

      repo.save(acct1);
      repo.save(acct2);

      expect(repo.findByName('user-oauth')).toEqual(acct1);
      expect(repo.findDefault()?.name).toBe('user-oauth');

      // Check table schema has no credential / secret columns
      const tableInfo = db.prepare('PRAGMA table_info(accounts)').all() as { name: string }[];
      const colNames = tableInfo.map((c) => c.name);
      expect(colNames).not.toContain('credential');
      expect(colNames).not.toContain('password');
      expect(colNames).not.toContain('token');
      expect(colNames).not.toContain('secret');
      expect(colNames).not.toContain('api_key');

      // Switch default
      expect(repo.setDefault('user-apikey')).toBe(true);
      expect(repo.findDefault()?.name).toBe('user-apikey');
      expect(repo.findByName('user-oauth')?.active).toBe(false);

      expect(repo.delete('user-oauth')).toBe(true);
      expect(repo.findByName('user-oauth')).toBeNull();
    });
  });

  describe('QuotaCacheRepository', () => {
    it('sets, gets, lists by account, and clears cache records', () => {
      const repo = new QuotaCacheRepository(db);

      const snapshot: QuotaSnapshot = {
        source: 'statusline',
        accountName: 'acct-1',
        email: 'test@example.com',
        planTier: 'Pro',
        title: 'Statusline Quota',
        description: null,
        groups: [
          {
            displayName: 'Default Group',
            description: null,
            buckets: [
              {
                bucketId: 'b-1',
                displayName: 'Weekly Quota',
                window: 'weekly',
                remainingFraction: 0.85,
                resetTime: '2026-10-01T00:00:00.000Z',
                resetInSeconds: 3600,
                description: null,
                disabled: false,
              },
            ],
          },
        ],
        credits: { available: true, balance: 50 },
        fetchedAt: '2026-09-28T10:00:00.000Z',
        cached: true,
        stale: false,
      };

      repo.set('acct-1', 'statusline', snapshot);

      const cached = repo.get('acct-1', 'statusline');
      expect(cached).not.toBeNull();
      expect(cached?.accountName).toBe('acct-1');
      expect(cached?.source).toBe('statusline');
      expect(cached?.snapshot).toEqual(snapshot);

      expect(repo.listByAccount('acct-1').length).toBe(1);

      repo.deleteByAccount('acct-1');
      expect(repo.get('acct-1', 'statusline')).toBeNull();
    });
  });

  describe('PrefsRepository', () => {
    it('returns default preferences, updates partially, and resets', () => {
      const repo = new PrefsRepository(db);

      expect(repo.get()).toEqual(DEFAULT_PREFS);

      const updated = repo.update({
        defaultModel: 'gemini-2.5-flash',
        maxConcurrentRuns: 5,
        showThinking: false,
      });

      expect(updated.defaultModel).toBe('gemini-2.5-flash');
      expect(updated.maxConcurrentRuns).toBe(5);
      expect(updated.showThinking).toBe(false);
      expect(updated.stallTimeoutSeconds).toBe(180); // untouched

      expect(repo.get()).toEqual(updated);

      const reset = repo.reset();
      expect(reset).toEqual(DEFAULT_PREFS);
    });
  });
});
