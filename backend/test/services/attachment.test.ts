import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { Attachment } from '@agy-studio/contracts';
import {
  createDatabase,
  AttachmentsRepository,
  WorkspacesRepository,
} from '../../src/repositories/index.js';
import {
  AttachmentStore,
  sanitizeFilename,
} from '../../src/services/attachment/store.js';
import { AttachmentConverter } from '../../src/services/attachment/convert.js';
import { PromptInjector } from '../../src/services/attachment/prompt-inject.js';
import { AppError } from '../../src/utils/errors.js';
import type { AgyProfile } from '../../src/integrations/agy/profile/schema.js';

describe('Attachment Services', () => {
  let db: Database.Database;
  let attachmentsRepo: AttachmentsRepository;
  let workspacesRepo: WorkspacesRepository;
  let attachmentStore: AttachmentStore;
  let attachmentConverter: AttachmentConverter;
  let promptInjector: PromptInjector;
  let tempWorkspaceDir: string;
  const workspaceId = 'ws-test-att';

  beforeEach(() => {
    db = createDatabase(':memory:');
    attachmentsRepo = new AttachmentsRepository(db);
    workspacesRepo = new WorkspacesRepository(db);

    tempWorkspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ws-att-'));

    workspacesRepo.create({
      id: workspaceId,
      name: 'Attachment Workspace',
      path: tempWorkspaceDir,
      isGitRepo: false,
      createdAt: new Date().toISOString(),
      lastOpenedAt: new Date().toISOString(),
    });

    attachmentStore = new AttachmentStore({
      attachmentsRepo,
      workspacesRepo,
    });

    attachmentConverter = new AttachmentConverter({
      attachmentsRepo,
    });

    promptInjector = new PromptInjector();
  });

  afterEach(() => {
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

  describe('Filename Sanitization & Windows Reserved Names', () => {
    it('sanitizes special characters to underscores', () => {
      expect(sanitizeFilename('my test file @#$!.png')).toBe('my_test_file_____.png');
      expect(sanitizeFilename('../../evil.txt')).toBe('evil.txt');
      expect(sanitizeFilename('/etc/passwd')).toBe('passwd');
      expect(sanitizeFilename('C:\\Windows\\System32\\cmd.exe')).toBe('cmd.exe');
    });

    it('prefixes Windows reserved device names with an underscore', () => {
      expect(sanitizeFilename('CON.txt')).toBe('_CON.txt');
      expect(sanitizeFilename('prn.png')).toBe('_prn.png');
      expect(sanitizeFilename('AUX.log')).toBe('_AUX.log');
      expect(sanitizeFilename('nul')).toBe('_nul');
      expect(sanitizeFilename('com1.dat')).toBe('_com1.dat');
      expect(sanitizeFilename('LPT9.txt')).toBe('_LPT9.txt');
    });

    it('handles empty or all-dot filenames safely', () => {
      expect(sanitizeFilename('...')).toBe('attachment');
      expect(sanitizeFilename('.gitignore')).toBe('gitignore');
    });
  });

  describe('AttachmentStore: Path Traversal & .gitignore', () => {
    it('saves file inside <workspace>/.agy-attachments/<YYYY-MM-DD>/<id>-<cleaned> and updates .gitignore', async () => {
      const content = Buffer.from('hello attachment world');
      const saved = await attachmentStore.save({
        workspaceId,
        filename: 'my report.txt',
        mimeType: 'text/plain',
        content,
      });

      expect(saved.id).toMatch(/^att_/);
      expect(saved.workspaceId).toBe(workspaceId);
      expect(saved.storedPath).toContain('.agy-attachments');
      expect(fs.existsSync(saved.storedPath)).toBe(true);

      // Verify .gitignore updated
      const gitignorePath = path.join(tempWorkspaceDir, '.gitignore');
      expect(fs.existsSync(gitignorePath)).toBe(true);
      const gitignoreContent = fs.readFileSync(gitignorePath, 'utf-8');
      expect(gitignoreContent).toContain('.agy-attachments/');

      // Verify db record
      const fromDb = attachmentsRepo.findById(saved.id);
      expect(fromDb).toEqual(saved);
    });

    it('prevents directory escape when given malicious relative or absolute path names', async () => {
      const maliciousName = '../../../../../../../../../../../../Windows/System32/drivers/etc/hosts';
      const saved = await attachmentStore.save({
        workspaceId,
        filename: maliciousName,
        mimeType: 'text/plain',
        content: Buffer.from('test safe write'),
      });

      // The saved path must still be strictly within .agy-attachments
      const attachmentsRoot = path.join(tempWorkspaceDir, '.agy-attachments');
      const relative = path.relative(attachmentsRoot, saved.storedPath);
      expect(relative.startsWith('..')).toBe(false);
      expect(path.isAbsolute(relative)).toBe(false);
    });

    it('getAttachmentRaw verifies realpath and throws if outside', async () => {
      const saved = await attachmentStore.save({
        workspaceId,
        filename: 'valid.txt',
        mimeType: 'text/plain',
        content: Buffer.from('content'),
      });

      const raw = attachmentStore.getAttachmentRaw(saved.id);
      expect(raw.attachment.id).toBe(saved.id);
      expect(raw.realPath).toBe(saved.storedPath);

      // Mutate storedPath in DB to an external file
      const outsideFile = path.join(os.tmpdir(), 'outside-secret.txt');
      fs.writeFileSync(outsideFile, 'secret');
      attachmentsRepo.delete(saved.id);
      attachmentsRepo.create({
        ...saved,
        storedPath: outsideFile,
      });

      try {
        expect(() => attachmentStore.getAttachmentRaw(saved.id)).toThrowError(AppError);
      } finally {
        try {
          fs.unlinkSync(outsideFile);
        } catch {
          // ignore
        }
      }
    });
  });

  describe('AttachmentConverter', () => {
    it('converts xlsx/xls buffer to CSV format and sets derivedTextPath', async () => {
      const xlsx = await import('xlsx');
      const wb = xlsx.utils.book_new();
      const ws = xlsx.utils.aoa_to_sheet([
        ['Name', 'Score'],
        ['Alice', 95],
        ['Bob', 88],
      ]);
      xlsx.utils.book_append_sheet(wb, ws, 'Results');
      const buffer = xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });

      const saved = await attachmentStore.save({
        workspaceId,
        filename: 'scores.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        content: buffer,
      });

      const derivedPath = await attachmentConverter.convert(saved);
      expect(derivedPath).not.toBeNull();
      expect(fs.existsSync(derivedPath!)).toBe(true);

      const content = fs.readFileSync(derivedPath!, 'utf-8');
      expect(content).toContain('--- Sheet: Results ---');
      expect(content).toContain('Alice,95');
      expect(content).toContain('Bob,88');

      // Verify db record updated
      const updated = attachmentsRepo.findById(saved.id);
      expect(updated?.derivedTextPath).toBe(derivedPath);
    });

    it('does not throw when conversion fails on corrupt file', async () => {
      const corruptBuffer = Buffer.from('not a real docx or pdf file content');
      const saved = await attachmentStore.save({
        workspaceId,
        filename: 'corrupt.docx',
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        content: corruptBuffer,
      });

      await expect(attachmentConverter.convert(saved)).resolves.toBeNull();
      expect(saved.derivedTextPath).toBeNull();
    });
  });

  describe('PromptInjector', () => {
    it('appends <images_input> and <files_input> in default mode (imageInput.supported = false)', () => {
      const fakeImage: Attachment = {
        id: 'att-img-1',
        workspaceId,
        sessionId: 'sess-1',
        kind: 'image',
        originalName: 'screenshot.png',
        mimeType: 'image/png',
        size: 1234,
        storedPath: 'G:/workspace/.agy-attachments/2026-09-28/att-img-1-screenshot.png',
        derivedTextPath: null,
        createdAt: '2026-09-28T10:00:00.000Z',
      };

      const extractedFile = path.join(tempWorkspaceDir, 'extracted.txt');
      fs.writeFileSync(extractedFile, 'Alice,95\nBob,88', 'utf-8');

      const fakeFile: Attachment = {
        id: 'att-file-1',
        workspaceId,
        sessionId: 'sess-1',
        kind: 'file',
        originalName: 'data.xlsx',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 4567,
        storedPath: 'G:/workspace/.agy-attachments/2026-09-28/att-file-1-data.xlsx',
        derivedTextPath: extractedFile,
        createdAt: '2026-09-28T10:00:00.000Z',
      };

      const result = promptInjector.injectAttachments('Please analyze these attachments.', [
        fakeImage,
        fakeFile,
      ]);

      expect(result.prompt).toContain('Please analyze these attachments.');
      expect(result.prompt).toContain('<images_input>');
      expect(result.prompt).toContain('- [screenshot.png] (G:/workspace/.agy-attachments/2026-09-28/att-img-1-screenshot.png)');
      expect(result.prompt).toContain('</images_input>');
      expect(result.prompt).toContain('<files_input>');
      expect(result.prompt).toContain('- [data.xlsx] (G:/workspace/.agy-attachments/2026-09-28/att-file-1-data.xlsx)');
      expect(result.prompt).toContain('Extracted text:\nAlice,95\nBob,88');
      expect(result.prompt).toContain('</files_input>');
      expect(result.nativeImages).toBeUndefined();
    });

    it('returns native image objects when profile imageInput.supported is true', () => {
      const imgPath = path.join(tempWorkspaceDir, 'native-test.png');
      fs.writeFileSync(imgPath, 'image binary content');

      const fakeImage: Attachment = {
        id: 'att-img-2',
        workspaceId,
        sessionId: 'sess-1',
        kind: 'image',
        originalName: 'native-test.png',
        mimeType: 'image/png',
        size: 20,
        storedPath: imgPath,
        derivedTextPath: null,
        createdAt: '2026-09-28T10:00:00.000Z',
      };

      const mockProfile: AgyProfile = {
        agyVersion: '1.2.12',
        discoveredAt: '2026-09-28T00:00:00.000Z',
        binary: { candidates: ['agy'] },
        stream: {
          userFrameTemplate: '{"prompt":"{{prompt}}"}',
          multiTurnStdin: false,
          eventTypeMap: {},
          permissionEvent: null,
          imageInput: {
            supported: true,
            template: {
              type: 'image_url',
              url: 'file://{{path}}',
              mime: '{{mimeType}}',
            },
          },
        },
        paths: {
          dataRoots: ['/root'],
          conversationDirPattern: '/root/{{conversationId}}',
          transcriptRelPath: 'logs.jsonl',
          artifactRules: [],
        },
        settings: {
          files: [{ scope: 'user', pathTemplate: '/settings.json' }],
          alwaysProceed: { jsonPath: 'tool', value: 'yes' },
          statusline: { jsonPath: 'statusline' },
        },
        credentials: {
          preferredIsolation: 'credential_snapshot',
          homeEnvVars: ['HOME'],
          wincredTargetPatterns: [],
          credentialFiles: [],
        },
        login: {
          argv: ['login'],
          authUrlPattern: 'https://.*',
          successPatterns: ['Logged in'],
          failurePatterns: ['Error'],
        },
        quota: {
          statuslineInHeadless: false,
          usageCommand: '/usage',
          usageParser: 'text-v1',
        },
        catalog: {
          versionArgv: ['--version'],
          modelsArgv: ['models'],
          modelsParser: 'text-v1',
          modes: ['agent'],
        },
      };

      const result = promptInjector.injectAttachments('Look at this', [fakeImage], mockProfile);
      expect(result.prompt).toBe('Look at this');
      expect(result.nativeImages).toBeDefined();
      expect(result.nativeImages).toHaveLength(1);
      expect(result.nativeImages![0]).toEqual({
        type: 'image_url',
        url: `file://${imgPath}`,
        mime: 'image/png',
      });
    });
  });
});
