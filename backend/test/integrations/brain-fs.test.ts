import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  BrainFs,
  globToRegExp,
  purgeConversation,
  resolveConversationDir,
} from '../../src/integrations/agy/brain-fs.js';
import type { PathsConfig } from '../../src/integrations/agy/profile/schema.js';
import { AppError } from '../../src/utils/errors.js';

describe('Integrations: brain-fs.ts', () => {
  let tmpDataRoot: string;
  let samplePathsConfig: PathsConfig;

  beforeEach(async () => {
    tmpDataRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'brain-fs-test-'));
    samplePathsConfig = {
      dataRoots: [tmpDataRoot],
      conversationDirPattern: path.join(tmpDataRoot, 'conversations', '{{conversationId}}'),
      transcriptRelPath: 'transcript.jsonl',
      artifactRules: [
        {
          kind: 'task',
          glob: 'tasks/*.json',
          mimeType: 'application/json',
        },
        {
          kind: 'implementation_plan',
          glob: 'plans/*.md',
          mimeType: 'text/markdown',
        },
        {
          kind: 'walkthrough',
          glob: 'walkthroughs/*.md',
          mimeType: 'text/markdown',
        },
        {
          kind: 'markdown',
          glob: 'artifacts/*.md',
          mimeType: 'text/markdown',
        },
        {
          kind: 'image',
          glob: 'media/**/*.{png,jpg,jpeg,webp,gif}',
          mimeType: 'image/png',
        },
        {
          kind: 'recording',
          glob: 'media/**/*.{mp4,webm}',
          mimeType: 'video/mp4',
        },
      ],
    };
  });

  afterEach(async () => {
    await fs.promises.rm(tmpDataRoot, { recursive: true, force: true });
  });

  describe('globToRegExp', () => {
    it('matches exact filenames and wildcards', () => {
      const taskRegex = globToRegExp('tasks/*.json');
      expect(taskRegex.test('tasks/task-1.json')).toBe(true);
      expect(taskRegex.test('tasks/nested/task.json')).toBe(false);
      expect(taskRegex.test('plans/task-1.json')).toBe(false);
    });

    it('handles recursive glob ** and braces', () => {
      const mediaRegex = globToRegExp('media/**/*.{png,jpg,jpeg,webp,gif}');
      expect(mediaRegex.test('media/screenshot.png')).toBe(true);
      expect(mediaRegex.test('media/photos/sample.jpg')).toBe(true);
      expect(mediaRegex.test('media/nested/dir/pic.webp')).toBe(true);
      expect(mediaRegex.test('media/video.mp4')).toBe(false);
      expect(mediaRegex.test('other/screenshot.png')).toBe(false);
    });
  });

  describe('listConversations', () => {
    it('lists conversations and extracts title from first user message up to 50 chars', async () => {
      const brain = new BrainFs(samplePathsConfig);

      const convId1 = 'a1111111-1111-4111-8111-111111111111';
      const convId2 = 'b2222222-2222-4222-8222-222222222222';
      const invalidDir = 'not-a-uuid-directory';

      const convDir1 = path.join(tmpDataRoot, 'conversations', convId1);
      const convDir2 = path.join(tmpDataRoot, 'conversations', convId2);
      const invalidPath = path.join(tmpDataRoot, 'conversations', invalidDir);

      await fs.promises.mkdir(convDir1, { recursive: true });
      await fs.promises.mkdir(convDir2, { recursive: true });
      await fs.promises.mkdir(invalidPath, { recursive: true });

      // Conv 1: has user prompt with long text
      const longPrompt =
        'This is a very long user input text that should be strictly truncated to at most fifty characters in total';
      const transcript1 = [
        JSON.stringify({
          step_index: 0,
          kind: 'user',
          content: longPrompt,
          timestamp: '2026-09-28T09:00:00.000Z',
        }),
        JSON.stringify({
          step_index: 1,
          kind: 'thought',
          content: 'Reasoning...',
          timestamp: '2026-09-28T09:00:01.000Z',
        }),
      ].join('\n');
      await fs.promises.writeFile(path.join(convDir1, 'transcript.jsonl'), transcript1, 'utf-8');

      // Conv 2: multiline prompt
      const multilinePrompt = 'Line 1\nLine 2 user instruction';
      const transcript2 = [
        JSON.stringify({
          step_index: 0,
          kind: 'user',
          content: multilinePrompt,
          timestamp: '2026-09-28T09:05:00.000Z',
        }),
      ].join('\n');
      await fs.promises.writeFile(path.join(convDir2, 'transcript.jsonl'), transcript2, 'utf-8');

      const summaries = await brain.listConversations(tmpDataRoot);

      expect(summaries).toHaveLength(2);
      // Sorted by updatedAt descending
      expect(summaries[0].id).toBe(convId2);
      expect(summaries[0].title).toBe('Line 1 Line 2 user instruction');
      expect(summaries[0].createdAt).toBe('2026-09-28T09:05:00.000Z');

      expect(summaries[1].id).toBe(convId1);
      expect(summaries[1].title).toBe(longPrompt.slice(0, 50));
      expect(summaries[1].title.length).toBeLessThanOrEqual(50);
      expect(summaries[1].createdAt).toBe('2026-09-28T09:00:00.000Z');
    });

    it('supports isolated_home mode where dataRoot is an account home directory', async () => {
      const brain = new BrainFs(samplePathsConfig);

      const accountHome = path.join(tmpDataRoot, 'account-alice');
      const convId = 'c3333333-3333-4333-8333-333333333333';
      const convDir = path.join(accountHome, '.antigravity', 'conversations', convId);
      await fs.promises.mkdir(convDir, { recursive: true });

      const transcript = JSON.stringify({
        step_index: 0,
        kind: 'user',
        content: 'Alice prompt in isolated home',
        timestamp: '2026-09-28T10:00:00.000Z',
      });
      await fs.promises.writeFile(path.join(convDir, 'transcript.jsonl'), transcript, 'utf-8');

      const summaries = await brain.listConversations(accountHome);
      expect(summaries).toHaveLength(1);
      expect(summaries[0].id).toBe(convId);
      expect(summaries[0].title).toBe('Alice prompt in isolated home');
    });

    it('returns empty array when dataRoot does not exist or has no conversations', async () => {
      const brain = new BrainFs(samplePathsConfig);
      const result = await brain.listConversations(path.join(tmpDataRoot, 'non-existent'));
      expect(result).toEqual([]);
    });
  });

  describe('listArtifacts & watchArtifacts', () => {
    const convId = 'd4444444-4444-4444-8444-444444444444';
    const sessionId = 'session-123';
    let convDir: string;

    beforeEach(async () => {
      convDir = path.join(tmpDataRoot, 'conversations', convId);
      await fs.promises.mkdir(convDir, { recursive: true });
    });

    it('lists artifacts according to artifactRules and assigns stable id and mimeType', async () => {
      const brain = new BrainFs(samplePathsConfig);

      // Create directories
      await fs.promises.mkdir(path.join(convDir, 'tasks'), { recursive: true });
      await fs.promises.mkdir(path.join(convDir, 'plans'), { recursive: true });
      await fs.promises.mkdir(path.join(convDir, 'media', 'screenshots'), { recursive: true });
      await fs.promises.mkdir(path.join(convDir, 'artifacts'), { recursive: true });

      // Create files
      await fs.promises.writeFile(path.join(convDir, 'tasks', 'task-1.json'), '{"id":1}', 'utf-8');
      await fs.promises.writeFile(path.join(convDir, 'plans', 'plan.md'), '# Plan', 'utf-8');
      await fs.promises.writeFile(
        path.join(convDir, 'media', 'screenshots', 'view.png'),
        Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      );
      await fs.promises.writeFile(path.join(convDir, 'artifacts', 'extra.txt'), 'extra text', 'utf-8');
      // Should exclude transcript.jsonl
      await fs.promises.writeFile(path.join(convDir, 'transcript.jsonl'), 'step', 'utf-8');

      const artifacts = await brain.listArtifacts(convId, sessionId, tmpDataRoot);

      expect(artifacts).toHaveLength(4);

      const byRelPath = new Map(artifacts.map((a) => [a.relativePath, a]));

      const task = byRelPath.get('tasks/task-1.json');
      expect(task).toBeDefined();
      expect(task?.kind).toBe('task');
      expect(task?.mimeType).toBe('application/json');
      expect(task?.sessionId).toBe(sessionId);
      expect(task?.conversationId).toBe(convId);
      expect(task?.name).toBe('task-1.json');

      const plan = byRelPath.get('plans/plan.md');
      expect(plan).toBeDefined();
      expect(plan?.kind).toBe('implementation_plan');
      expect(plan?.mimeType).toBe('text/markdown');

      const img = byRelPath.get('media/screenshots/view.png');
      expect(img).toBeDefined();
      expect(img?.kind).toBe('image');
      expect(img?.mimeType).toBe('image/png');

      const extra = byRelPath.get('artifacts/extra.txt');
      expect(extra).toBeDefined();
      expect(extra?.kind).toBe('other');
      expect(extra?.mimeType).toBe('text/plain');

      // Verify ID is url-safe base64
      expect(task?.id).toBe(Buffer.from(`${convId}/tasks/task-1.json`).toString('base64url'));
    });

    it('watchArtifacts invokes onChange on creation and modification and cleans up timers on stop', async () => {
      const brain = new BrainFs(samplePathsConfig);

      const events: Array<{ name: string; version: number }> = [];
      const handle = await brain.watchArtifacts(
        convId,
        sessionId,
        (art) => {
          events.push({ name: art.name, version: art.version });
        },
        tmpDataRoot,
      );

      // 1. Create a task file
      await fs.promises.mkdir(path.join(convDir, 'tasks'), { recursive: true });
      const taskFile = path.join(convDir, 'tasks', 'task-1.json');
      await fs.promises.writeFile(taskFile, '{"state":"todo"}', 'utf-8');

      // Wait for poll
      await new Promise((r) => setTimeout(r, 450));
      expect(events).toEqual([{ name: 'task-1.json', version: 1 }]);

      // 2. Modify the file
      await fs.promises.writeFile(taskFile, '{"state":"done"}', 'utf-8');
      await new Promise((r) => setTimeout(r, 450));
      expect(events).toEqual([
        { name: 'task-1.json', version: 1 },
        { name: 'task-1.json', version: 2 },
      ]);

      // 3. Stop watcher
      handle.stop();

      // Modify again after stop; should not trigger further onChange
      await fs.promises.writeFile(taskFile, '{"state":"archived"}', 'utf-8');
      await new Promise((r) => setTimeout(r, 450));
      expect(events).toHaveLength(2);
    });
  });

  describe('purgeConversation Path Security', () => {
    const validUuid = 'e5555555-5555-4555-8555-555555555555';
    let convDir: string;

    beforeEach(async () => {
      convDir = path.join(tmpDataRoot, 'conversations', validUuid);
      await fs.promises.mkdir(convDir, { recursive: true });
      await fs.promises.writeFile(path.join(convDir, 'transcript.jsonl'), 'data', 'utf-8');
    });

    it('successfully purges a valid UUID conversation directory within data root', async () => {
      expect(fs.existsSync(convDir)).toBe(true);
      await purgeConversation(tmpDataRoot, validUuid, samplePathsConfig);
      expect(fs.existsSync(convDir)).toBe(false);
    });

    it('supports (conversationId, dataRoot) argument ordering as well', async () => {
      expect(fs.existsSync(convDir)).toBe(true);
      await purgeConversation(validUuid, tmpDataRoot, samplePathsConfig);
      expect(fs.existsSync(convDir)).toBe(false);
    });

    it('rejects non-UUID conversation IDs (非法ID)', async () => {
      await expect(
        purgeConversation(tmpDataRoot, 'invalid-id-format', samplePathsConfig),
      ).rejects.toThrowError(AppError);

      await expect(
        purgeConversation(tmpDataRoot, '12345', samplePathsConfig),
      ).rejects.toThrowError(AppError);

      await expect(
        purgeConversation(tmpDataRoot, '', samplePathsConfig),
      ).rejects.toThrowError(AppError);

      expect(fs.existsSync(convDir)).toBe(true);
    });

    it('rejects path traversal attempts (路径穿越)', async () => {
      // Path traversal inside id
      await expect(
        purgeConversation(tmpDataRoot, '../../outside', samplePathsConfig),
      ).rejects.toThrowError(AppError);

      await expect(
        purgeConversation(tmpDataRoot, '..', samplePathsConfig),
      ).rejects.toThrowError(AppError);

      await expect(
        purgeConversation(tmpDataRoot, `../${validUuid}`, samplePathsConfig),
      ).rejects.toThrowError(AppError);

      expect(fs.existsSync(convDir)).toBe(true);
    });

    it('rejects symbolic links (符号链接)', async () => {
      // Create a separate sensitive directory outside the conversation
      const sensitiveDir = path.join(tmpDataRoot, 'sensitive-directory');
      await fs.promises.mkdir(sensitiveDir, { recursive: true });
      await fs.promises.writeFile(path.join(sensitiveDir, 'secret.txt'), 'secret data', 'utf-8');

      // Create a symlink/junction conversation pointing to the sensitive directory
      const symlinkUuid = 'f6666666-6666-4666-8666-666666666666';
      const symlinkPath = path.join(tmpDataRoot, 'conversations', symlinkUuid);

      // On Windows, 'junction' can be created without admin privileges; on POSIX, 'dir'
      const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
      await fs.promises.symlink(sensitiveDir, symlinkPath, symlinkType);

      expect(fs.existsSync(symlinkPath)).toBe(true);
      const lstat = await fs.promises.lstat(symlinkPath);
      expect(lstat.isSymbolicLink()).toBe(true);

      // purgeConversation must reject the symlink and NOT delete the sensitive directory
      await expect(
        purgeConversation(tmpDataRoot, symlinkUuid, samplePathsConfig),
      ).rejects.toThrowError(AppError);

      // Sensitive directory and symlink must remain untouched
      expect(fs.existsSync(sensitiveDir)).toBe(true);
      expect(fs.existsSync(path.join(sensitiveDir, 'secret.txt'))).toBe(true);
    });

    it('rejects targets resolving outside the data root (跨目录防删除)', async () => {
      // Construct a config whose pattern resolves outside data root
      const outsideDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'outside-root-'));
      try {
        const maliciousConfig: PathsConfig = {
          ...samplePathsConfig,
          conversationDirPattern: path.join(outsideDir, 'conversations', '{{conversationId}}'),
        };

        const targetConv = path.join(outsideDir, 'conversations', validUuid);
        await fs.promises.mkdir(targetConv, { recursive: true });

        // Purging with tmpDataRoot as boundary must reject the outside target
        await expect(
          purgeConversation(tmpDataRoot, validUuid, maliciousConfig),
        ).rejects.toThrowError(AppError);

        expect(fs.existsSync(targetConv)).toBe(true);
      } finally {
        await fs.promises.rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('idempotently succeeds when conversation directory does not exist', async () => {
      const nonExistentUuid = '99999999-9999-4999-8999-999999999999';
      await expect(
        purgeConversation(tmpDataRoot, nonExistentUuid, samplePathsConfig),
      ).resolves.toBeUndefined();
    });
  });

  describe('BrainFs integration with BrainPort', () => {
    it('implements BrainPort interface completely', async () => {
      const brain = new BrainFs(samplePathsConfig);

      const convId = '77777777-7777-4777-8777-777777777777';
      const convDir = path.join(tmpDataRoot, 'conversations', convId);
      await fs.promises.mkdir(convDir, { recursive: true });

      // Write transcript
      await fs.promises.writeFile(
        path.join(convDir, 'transcript.jsonl'),
        JSON.stringify({ step_index: 0, kind: 'user', content: 'BrainPort test' }) + '\n',
        'utf-8',
      );

      // tailTranscript
      const handle = await brain.tailTranscript(convId, {}, tmpDataRoot);
      const received: number[] = [];
      for await (const step of handle.steps) {
        received.push(step.stepIndex);
        handle.stop();
        break;
      }
      expect(received).toEqual([0]);

      // purgeConversation
      await brain.purgeConversation(convId, tmpDataRoot);
      expect(fs.existsSync(convDir)).toBe(false);
    });
  });
});
