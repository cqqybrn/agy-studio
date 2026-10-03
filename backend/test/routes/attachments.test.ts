import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import {
  createDatabase,
  AttachmentsRepository,
  SessionsRepository,
  WorkspacesRepository,
} from '../../src/repositories/index.js';
import { AttachmentStore } from '../../src/services/attachment/store.js';
import { AttachmentConverter } from '../../src/services/attachment/convert.js';
import { attachmentsRoutes } from '../../src/routes/http/attachments.routes.js';
import { UPLOAD_LIMITS } from '@agy-studio/contracts';

describe('Attachments HTTP Routes', () => {
  let app: FastifyInstance;
  let db: Database.Database;
  let attachmentsRepo: AttachmentsRepository;
  let sessionsRepo: SessionsRepository;
  let workspacesRepo: WorkspacesRepository;
  let attachmentStore: AttachmentStore;
  let attachmentConverter: AttachmentConverter;
  let tempWorkspaceDir: string;
  const workspaceId = 'ws-route-att';

  beforeEach(async () => {
    db = createDatabase(':memory:');
    attachmentsRepo = new AttachmentsRepository(db);
    sessionsRepo = new SessionsRepository(db);
    workspacesRepo = new WorkspacesRepository(db);

    tempWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-routes-att-'));

    workspacesRepo.create({
      id: workspaceId,
      name: 'Test WS',
      path: tempWorkspaceDir,
      isGitRepo: false,
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    });

    sessionsRepo.create({
      id: 'session-123',
      workspaceId,
      accountName: null,
      title: 'Session 123',
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
    });

    attachmentStore = new AttachmentStore({
      attachmentsRepo,
      workspacesRepo,
    });

    attachmentConverter = new AttachmentConverter({
      attachmentsRepo,
    });

    app = Fastify();
    await app.register(attachmentsRoutes, {
      attachmentStore,
      attachmentConverter,
    });
  });

  afterEach(async () => {
    await app.close();
    try {
      db.close();
    } catch {
      // ignore
    }
    try {
      fs.rmSync(tempWorkspaceDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  function buildMultipartBody(fields: Record<string, string>, files: Array<{ fieldname: string; filename: string; contentType: string; content: Buffer }>) {
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    const chunks: Buffer[] = [];

    for (const [key, value] of Object.entries(fields)) {
      chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`));
    }

    for (const file of files) {
      chunks.push(
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="${file.fieldname}"; filename="${file.filename}"\r\nContent-Type: ${file.contentType}\r\n\r\n`,
        ),
      );
      chunks.push(file.content);
      chunks.push(Buffer.from('\r\n'));
    }

    chunks.push(Buffer.from(`--${boundary}--\r\n`));

    return {
      contentType: `multipart/form-data; boundary=${boundary}`,
      payload: Buffer.concat(chunks),
    };
  }

  describe('POST /api/attachments', () => {
    it('uploads multiple files successfully and classifies image vs file', async () => {
      const pngBuffer = Buffer.from('fake png content');
      const textBuffer = Buffer.from('plain file content');

      const { contentType, payload } = buildMultipartBody(
        { workspaceId, sessionId: 'session-123' },
        [
          {
            fieldname: 'files',
            filename: 'picture.png',
            contentType: 'image/png',
            content: pngBuffer,
          },
          {
            fieldname: 'files',
            filename: 'notes.txt',
            contentType: 'text/plain',
            content: textBuffer,
          },
        ],
      );

      const res = await app.inject({
        method: 'POST',
        url: '/api/attachments',
        headers: {
          'content-type': contentType,
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.attachments).toHaveLength(2);

      const img = data.attachments.find((a: any) => a.originalName === 'picture.png');
      const doc = data.attachments.find((a: any) => a.originalName === 'notes.txt');

      expect(img.kind).toBe('image');
      expect(img.mimeType).toBe('image/png');
      expect(img.sessionId).toBe('session-123');

      expect(doc.kind).toBe('file');
      expect(doc.mimeType).toBe('text/plain');
    });

    it('treats non-whitelisted image mime type as file', async () => {
      const bmpBuffer = Buffer.from('fake bmp');
      const { contentType, payload } = buildMultipartBody({ workspaceId }, [
        {
          fieldname: 'files',
          filename: 'image.bmp',
          contentType: 'image/bmp', // not in imageMimeTypes
          content: bmpBuffer,
        },
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/attachments',
        headers: {
          'content-type': contentType,
        },
        payload,
      });

      expect(res.statusCode).toBe(200);
      const data = JSON.parse(res.body);
      expect(data.attachments[0].kind).toBe('file');
    });

    it('rejects oversized image with ATTACHMENT_TOO_LARGE', async () => {
      // Mock an image larger than imageMaxBytes
      const largeBuffer = Buffer.alloc(100); // We can simulate size check in test
      const { contentType, payload } = buildMultipartBody({ workspaceId }, [
        {
          fieldname: 'files',
          filename: 'huge.png',
          contentType: 'image/png',
          content: largeBuffer,
        },
      ]);

      // Spy on save to test error or verify UPLOAD_LIMITS check
      const origLimit = (UPLOAD_LIMITS as any).imageMaxBytes;
      (UPLOAD_LIMITS as any).imageMaxBytes = 50; // set small limit for test
      try {
        const res = await app.inject({
          method: 'POST',
          url: '/api/attachments',
          headers: {
            'content-type': contentType,
          },
          payload,
        });

        expect(res.statusCode).toBe(413);
        const data = JSON.parse(res.body);
        expect(data.error.code).toBe('ATTACHMENT_TOO_LARGE');
      } finally {
        (UPLOAD_LIMITS as any).imageMaxBytes = origLimit;
      }
    });

    it('returns BAD_REQUEST if workspaceId is missing or no files are attached', async () => {
      const { contentType, payload } = buildMultipartBody({}, [
        {
          fieldname: 'files',
          filename: 'doc.txt',
          contentType: 'text/plain',
          content: Buffer.from('abc'),
        },
      ]);

      const res = await app.inject({
        method: 'POST',
        url: '/api/attachments',
        headers: { 'content-type': contentType },
        payload,
      });

      expect(res.statusCode).toBe(400);
      const data = JSON.parse(res.body);
      expect(data.error.code).toBe('BAD_REQUEST');
    });
  });

  describe('GET /api/attachments/:attachmentId/raw', () => {
    it('returns 200 with raw file stream and nosniff header', async () => {
      const saved = await attachmentStore.save({
        workspaceId,
        filename: 'manual.pdf',
        mimeType: 'application/pdf',
        content: Buffer.from('dummy pdf binary'),
      });

      const res = await app.inject({
        method: 'GET',
        url: `/api/attachments/${saved.id}/raw`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.body).toBe('dummy pdf binary');
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['content-disposition']).toBe('inline; filename="manual.pdf"');
    });

    it('returns 404 if attachment is not found', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/attachments/non-existent-id/raw',
      });

      expect(res.statusCode).toBe(404);
      const data = JSON.parse(res.body);
      expect(data.error.code).toBe('NOT_FOUND');
    });
  });
});
