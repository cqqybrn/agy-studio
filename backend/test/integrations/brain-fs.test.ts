import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BrainFs,
  globToRegExp,
  purgeConversation,
  resolveConversationDir,
  resolveDataRoots,
} from '../../src/integrations/agy/brain-fs.js';
import { loadProfile } from '../../src/integrations/agy/profile/loader.js';
import type { PathsConfig } from '../../src/integrations/agy/profile/schema.js';
import { AppError } from '../../src/utils/errors.js';

const BRAIN_SAMPLE_DIR = path.resolve(__dirname, '../../../fixtures/agy/fs/brain-sample');
const SUBAGENT_STREAM = path.resolve(__dirname, '../../../fixtures/agy/stream/subagent/stdout.jsonl');
const PROFILE_PATHS: PathsConfig = loadProfile(path.resolve(__dirname, '../../agy-profile.json')).paths;

/** Copies the recorded brain-sample into <dataRoot>/brain/<conversationId>, the real on-disk layout. */
async function installBrainSample(dataRoot: string, conversationId: string): Promise<string> {
  const convDir = path.join(dataRoot, 'brain', conversationId);
  await fs.promises.cp(BRAIN_SAMPLE_DIR, convDir, { recursive: true });
  return convDir;
}

describe('Integrations: brain-fs.ts', () => {
  let tmpHome: string;
  let dataRoot: string;

  beforeEach(async () => {
    tmpHome = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'brain-fs-test-'));
    // isolated_home：以账号 home 替换 %USERPROFILE%，得到该账号的数据根目录
    [dataRoot] = resolveDataRoots(PROFILE_PATHS, tmpHome);
    await fs.promises.mkdir(dataRoot, { recursive: true });
  });

  afterEach(async () => {
    await fs.promises.rm(tmpHome, { recursive: true, force: true });
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

  describe('profile-derived paths', () => {
    it('resolves the data root and conversation dir under <home>\\.gemini\\antigravity-cli\\brain', () => {
      const convId = '2bc3ff47-8256-4f2c-9966-b909f2af6e5f';
      expect(dataRoot).toBe(path.join(tmpHome, '.gemini', 'antigravity-cli'));
      expect(resolveConversationDir(convId, { homeDir: tmpHome }, PROFILE_PATHS)).toBe(
        path.join(tmpHome, '.gemini', 'antigravity-cli', 'brain', convId),
      );
      expect(resolveConversationDir(convId, { dataRoot }, PROFILE_PATHS)).toBe(
        path.join(dataRoot, 'brain', convId),
      );
    });
  });

  describe('listConversations', () => {
    it('lists UUID directories under <dataRoot>\\brain from the real layout and ignores conversations\\<id>.db', async () => {
      const brain = new BrainFs(PROFILE_PATHS);
      const convId = '6f79591d-1521-40d1-b302-3edd62c602a0';

      await installBrainSample(dataRoot, convId);
      await fs.promises.mkdir(path.join(dataRoot, 'brain', 'not-a-uuid-directory'), { recursive: true });
      // 真实布局中 conversations\ 下是 <id>.db 文件，不是会话目录
      await fs.promises.mkdir(path.join(dataRoot, 'conversations'), { recursive: true });
      await fs.promises.writeFile(
        path.join(dataRoot, 'conversations', 'a1111111-1111-4111-8111-111111111111.db'),
        '',
      );

      const summaries = await brain.listConversations(dataRoot);

      expect(summaries).toHaveLength(1);
      expect(summaries[0].id).toBe(convId);
      expect(summaries[0].title).toBe(
        'Remember the secret word: PINEAPPLE. Reply only OK.'.slice(0, 50),
      );
      expect(summaries[0].createdAt).toBe('2026-09-28T10:29:37Z');
      expect(summaries[0].updatedAt).toBe('2026-09-28T10:29:47Z');
    });

    it('supports isolated_home mode: the account home replaces %USERPROFILE%', async () => {
      const brain = new BrainFs(PROFILE_PATHS);
      const accountHome = path.join(tmpHome, 'account-alice');
      const [aliceRoot] = resolveDataRoots(PROFILE_PATHS, accountHome);
      const convId = 'c3333333-3333-4333-8333-333333333333';
      await installBrainSample(aliceRoot, convId);

      const summaries = await brain.listConversations(aliceRoot);
      expect(summaries.map((s) => s.id)).toEqual([convId]);
      // 另一个账号的数据根目录互不影响
      expect(await brain.listConversations(dataRoot)).toEqual([]);
    });

    it('returns empty array when dataRoot does not exist or has no brain directory', async () => {
      const brain = new BrainFs(PROFILE_PATHS);
      expect(await brain.listConversations(path.join(tmpHome, 'non-existent'))).toEqual([]);
      expect(await brain.listConversations(dataRoot)).toEqual([]);
    });
  });

  describe('tailTranscript', () => {
    it('reads the real transcript at .system_generated\\logs\\transcript.jsonl', async () => {
      const brain = new BrainFs(PROFILE_PATHS);
      const convId = '6f79591d-1521-40d1-b302-3edd62c602a0';
      await installBrainSample(dataRoot, convId);

      const handle = await brain.tailTranscript(convId, {}, dataRoot);
      const received: Array<{ stepIndex: number; type: string }> = [];
      for await (const step of handle.steps) {
        received.push({ stepIndex: step.stepIndex, type: step.type });
        if (step.stepIndex === 4) {
          handle.stop();
          break;
        }
      }

      expect(received).toEqual([
        { stepIndex: 0, type: 'USER_INPUT' },
        { stepIndex: 1, type: 'PLANNER_RESPONSE' },
        { stepIndex: 2, type: 'USER_INPUT' },
        { stepIndex: 3, type: 'SYSTEM_MESSAGE' },
        { stepIndex: 4, type: 'PLANNER_RESPONSE' },
      ]);
    });
  });

  describe('listArtifacts & watchArtifacts', () => {
    const convId = '2bc3ff47-8256-4f2c-9966-b909f2af6e5f';
    const sessionId = 'session-123';

    it('lists implementation_plan.md and walkthrough.md from the real layout, skipping metadata and .system_generated', async () => {
      const brain = new BrainFs(PROFILE_PATHS);
      await installBrainSample(dataRoot, convId);

      const artifacts = await brain.listArtifacts(convId, sessionId, dataRoot);

      expect(artifacts.map((a) => a.relativePath)).toEqual([
        'implementation_plan.md',
        'walkthrough.md',
      ]);

      const [plan, walkthrough] = artifacts;
      expect(plan.kind).toBe('implementation_plan');
      expect(plan.mimeType).toBe('text/markdown');
      expect(plan.name).toBe('implementation_plan.md');
      expect(plan.sessionId).toBe(sessionId);
      expect(plan.conversationId).toBe(convId);
      expect(plan.id).toBe(Buffer.from(`${convId}/implementation_plan.md`).toString('base64url'));

      expect(walkthrough.kind).toBe('walkthrough');
      expect(walkthrough.mimeType).toBe('text/markdown');
    });

    it('returns an empty list when the conversation directory does not exist', async () => {
      const brain = new BrainFs(PROFILE_PATHS);
      expect(await brain.listArtifacts(convId, sessionId, dataRoot)).toEqual([]);
    });

    it('watchArtifacts invokes onChange on creation and modification and cleans up timers on stop', async () => {
      const brain = new BrainFs(PROFILE_PATHS);
      const convDir = path.join(dataRoot, 'brain', convId);
      await fs.promises.mkdir(convDir, { recursive: true });

      const events: Array<{ name: string; version: number }> = [];
      const handle = await brain.watchArtifacts(
        convId,
        sessionId,
        (art) => {
          events.push({ name: art.name, version: art.version });
        },
        dataRoot,
      );

      // 1. agy writes walkthrough.md
      const walkthroughFile = path.join(convDir, 'walkthrough.md');
      await fs.promises.writeFile(walkthroughFile, '# Walkthrough', 'utf-8');

      await new Promise((r) => setTimeout(r, 450));
      expect(events).toEqual([{ name: 'walkthrough.md', version: 1 }]);

      // 2. Modify the file
      await fs.promises.writeFile(walkthroughFile, '# Walkthrough\n\nDone.', 'utf-8');
      await new Promise((r) => setTimeout(r, 450));
      expect(events).toEqual([
        { name: 'walkthrough.md', version: 1 },
        { name: 'walkthrough.md', version: 2 },
      ]);

      // 3. Stop watcher
      handle.stop();

      await fs.promises.writeFile(walkthroughFile, '# Walkthrough\n\nArchived.', 'utf-8');
      await new Promise((r) => setTimeout(r, 450));
      expect(events).toHaveLength(2);
    });
  });

  describe('purgeConversation Path Security', () => {
    const validUuid = 'e5555555-5555-4555-8555-555555555555';
    let convDir: string;

    beforeEach(async () => {
      convDir = await installBrainSample(dataRoot, validUuid);
    });

    it('successfully purges a valid UUID conversation directory within data root', async () => {
      expect(fs.existsSync(convDir)).toBe(true);
      await purgeConversation(dataRoot, validUuid, PROFILE_PATHS);
      expect(fs.existsSync(convDir)).toBe(false);
    });

    it('supports (conversationId, dataRoot) argument ordering as well', async () => {
      expect(fs.existsSync(convDir)).toBe(true);
      await purgeConversation(validUuid, dataRoot, PROFILE_PATHS);
      expect(fs.existsSync(convDir)).toBe(false);
    });

    it('rejects non-UUID conversation IDs (非法ID)', async () => {
      await expect(
        purgeConversation(dataRoot, 'invalid-id-format', PROFILE_PATHS),
      ).rejects.toThrowError(AppError);

      await expect(purgeConversation(dataRoot, '12345', PROFILE_PATHS)).rejects.toThrowError(
        AppError,
      );

      await expect(purgeConversation(dataRoot, '', PROFILE_PATHS)).rejects.toThrowError(AppError);

      expect(fs.existsSync(convDir)).toBe(true);
    });

    it('rejects path traversal attempts (路径穿越)', async () => {
      await expect(
        purgeConversation(dataRoot, '../../outside', PROFILE_PATHS),
      ).rejects.toThrowError(AppError);

      await expect(purgeConversation(dataRoot, '..', PROFILE_PATHS)).rejects.toThrowError(
        AppError,
      );

      await expect(
        purgeConversation(dataRoot, `../${validUuid}`, PROFILE_PATHS),
      ).rejects.toThrowError(AppError);

      expect(fs.existsSync(convDir)).toBe(true);
    });

    it('rejects symbolic links (符号链接)', async () => {
      const sensitiveDir = path.join(tmpHome, 'sensitive-directory');
      await fs.promises.mkdir(sensitiveDir, { recursive: true });
      await fs.promises.writeFile(path.join(sensitiveDir, 'secret.txt'), 'secret data', 'utf-8');

      const symlinkUuid = 'f6666666-6666-4666-8666-666666666666';
      const symlinkPath = path.join(dataRoot, 'brain', symlinkUuid);

      // On Windows, 'junction' can be created without admin privileges; on POSIX, 'dir'
      const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
      await fs.promises.symlink(sensitiveDir, symlinkPath, symlinkType);

      expect(fs.existsSync(symlinkPath)).toBe(true);
      const lstat = await fs.promises.lstat(symlinkPath);
      expect(lstat.isSymbolicLink()).toBe(true);

      await expect(
        purgeConversation(dataRoot, symlinkUuid, PROFILE_PATHS),
      ).rejects.toThrowError(AppError);

      expect(fs.existsSync(sensitiveDir)).toBe(true);
      expect(fs.existsSync(path.join(sensitiveDir, 'secret.txt'))).toBe(true);
    });

    it('rejects targets resolving outside the data root (跨目录防删除)', async () => {
      const outsideDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'outside-root-'));
      try {
        const maliciousConfig: PathsConfig = {
          ...PROFILE_PATHS,
          conversationDirPattern: path.join(outsideDir, 'brain', '{{conversationId}}'),
        };

        const targetConv = path.join(outsideDir, 'brain', validUuid);
        await fs.promises.mkdir(targetConv, { recursive: true });

        await expect(
          purgeConversation(dataRoot, validUuid, maliciousConfig),
        ).rejects.toThrowError(AppError);

        expect(fs.existsSync(targetConv)).toBe(true);
      } finally {
        await fs.promises.rm(outsideDir, { recursive: true, force: true });
      }
    });

    it('idempotently succeeds when conversation directory does not exist', async () => {
      const nonExistentUuid = '99999999-9999-4999-8999-999999999999';
      await expect(
        purgeConversation(dataRoot, nonExistentUuid, PROFILE_PATHS),
      ).resolves.toBeUndefined();
    });
  });

  describe('purgeConversation removes all conversation data', () => {
    const mainId = 'a1a1a1a1-1111-4111-8111-111111111111';
    const subId = 'b2b2b2b2-2222-4222-8222-222222222222';
    const grandSubId = 'c3c3c3c3-3333-4333-8333-333333333333';
    const mentionedId = 'd4d4d4d4-4444-4444-8444-444444444444';
    const otherId = 'e5e5e5e5-5555-4555-8555-555555555555';

    /** Real subagent step_update line from fixtures/agy/stream/subagent/stdout.jsonl, re-pointed to `childId`. */
    function subagentStepLine(parentId: string, childId: string): string {
      const lines = fs
        .readFileSync(SUBAGENT_STREAM, 'utf-8')
        .split(/\r?\n/)
        .filter((l) => l.includes('"conversation_id":"e33a7c24-f1e3-4792-ac80-d602ef34dabb"'));
      const row = JSON.parse(lines[0]);
      row.step_update.conversation_id = parentId;
      for (const sa of row.step_update.subagent_info.subagents) {
        sa.conversation_id = childId;
        sa.log_uri = sa.log_uri.replace('e33a7c24-f1e3-4792-ac80-d602ef34dabb', childId);
      }
      return JSON.stringify(row);
    }

    async function appendTranscript(convDir: string, line: string): Promise<void> {
      const file = path.join(convDir, '.system_generated', 'logs', 'transcript.jsonl');
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      await fs.promises.appendFile(file, `\n${line}\n`, 'utf-8');
    }

    async function writeDbFiles(id: string): Promise<string[]> {
      const dir = path.join(dataRoot, 'conversations');
      await fs.promises.mkdir(dir, { recursive: true });
      const files = ['.db', '.db-shm', '.db-wal'].map((s) => path.join(dir, `${id}${s}`));
      for (const f of files) await fs.promises.writeFile(f, 'sqlite', 'utf-8');
      return files;
    }

    it('deletes brain dir, conversations\\<id>.db/.db-shm/.db-wal and subagent conversations recursively', async () => {
      const mainDir = await installBrainSample(dataRoot, mainId);
      const subDir = await installBrainSample(dataRoot, subId);
      const grandSubDir = await installBrainSample(dataRoot, grandSubId);
      await appendTranscript(mainDir, subagentStepLine(mainId, subId));
      await appendTranscript(subDir, subagentStepLine(subId, grandSubId));
      // 环：孙代理又指回主会话，不应死循环
      await appendTranscript(grandSubDir, subagentStepLine(grandSubId, mainId));
      const dbFiles = [
        ...(await writeDbFiles(mainId)),
        ...(await writeDbFiles(subId)),
        ...(await writeDbFiles(grandSubId)),
      ];

      await purgeConversation(mainId, dataRoot, PROFILE_PATHS);

      for (const p of [mainDir, subDir, grandSubDir, ...dbFiles]) {
        expect(fs.existsSync(p), p).toBe(false);
      }
    });

    it('keeps conversations whose UUID only appears in transcript text, and other conversations\' .db files', async () => {
      const mainDir = await installBrainSample(dataRoot, mainId);
      const mentionedDir = await installBrainSample(dataRoot, mentionedId);
      const otherDir = await installBrainSample(dataRoot, otherId);
      await appendTranscript(
        mainDir,
        JSON.stringify({
          step_index: 5,
          source: 'USER_EXPLICIT',
          type: 'USER_INPUT',
          status: 'DONE',
          created_at: '2026-09-28T10:30:00Z',
          content: `<USER_REQUEST>\nCompare with conversation ${mentionedId}\n</USER_REQUEST>`,
        }),
      );
      const mainDb = await writeDbFiles(mainId);
      const mentionedDb = await writeDbFiles(mentionedId);
      const otherDb = await writeDbFiles(otherId);

      await purgeConversation(mainId, dataRoot, PROFILE_PATHS);

      expect(fs.existsSync(mainDir)).toBe(false);
      for (const f of mainDb) expect(fs.existsSync(f)).toBe(false);
      expect(fs.existsSync(mentionedDir)).toBe(true);
      expect(fs.existsSync(otherDir)).toBe(true);
      for (const f of [...mentionedDb, ...otherDb]) expect(fs.existsSync(f), f).toBe(true);
    });

    it('deletes .db files even when the brain directory is already gone', async () => {
      const dbFiles = await writeDbFiles(mainId);
      await purgeConversation(mainId, dataRoot, PROFILE_PATHS);
      for (const f of dbFiles) expect(fs.existsSync(f)).toBe(false);
    });

    it('ignores non-UUID subagent ids', async () => {
      const mainDir = await installBrainSample(dataRoot, mainId);
      await appendTranscript(mainDir, subagentStepLine(mainId, '..'));
      const outsideMarker = path.join(dataRoot, 'brain', 'keep.txt');
      await fs.promises.writeFile(outsideMarker, 'keep', 'utf-8');

      await purgeConversation(mainId, dataRoot, PROFILE_PATHS);

      expect(fs.existsSync(mainDir)).toBe(false);
      expect(fs.existsSync(outsideMarker)).toBe(true);
    });
  });

  describe('agy CLI + IDE data roots (profile dataRoots)', () => {
    let cliRoot: string;
    let ideRoot: string;

    beforeEach(async () => {
      vi.stubEnv('USERPROFILE', tmpHome);
      vi.stubEnv('HOME', tmpHome);
      cliRoot = path.join(tmpHome, '.gemini', 'antigravity-cli');
      ideRoot = path.join(tmpHome, '.gemini', 'antigravity');
      await fs.promises.mkdir(ideRoot, { recursive: true });
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    async function setFirstUserRequest(convDir: string, text: string): Promise<void> {
      const file = path.join(convDir, '.system_generated', 'logs', 'transcript.jsonl');
      const raw = await fs.promises.readFile(file, 'utf-8');
      await fs.promises.writeFile(
        file,
        raw.replace('Remember the secret word: PINEAPPLE. Reply only OK.', text),
        'utf-8',
      );
    }

    it('profile lists the CLI root first and the IDE root second', () => {
      expect(resolveDataRoots(PROFILE_PATHS)).toEqual([cliRoot, ideRoot]);
    });

    it('lists conversations from both roots', async () => {
      const cliId = 'a1111111-1111-4111-8111-111111111111';
      const ideId = 'b2222222-2222-4222-8222-222222222222';
      await installBrainSample(cliRoot, cliId);
      await installBrainSample(ideRoot, ideId);

      const brain = new BrainFs(PROFILE_PATHS);
      const ids = (await brain.listConversations()).map((s) => s.id).sort();
      expect(ids).toEqual([cliId, ideId]);
    });

    it('reports an id present in both roots once, taking the CLI copy', async () => {
      const id = 'c3333333-3333-4333-8333-333333333333';
      await setFirstUserRequest(await installBrainSample(cliRoot, id), 'from cli');
      const ideDir = await installBrainSample(ideRoot, id);
      await setFirstUserRequest(ideDir, 'from ide');
      // IDE 副本更新更晚，也不应覆盖 CLI 的那条
      const future = new Date(Date.now() + 60_000);
      await fs.promises.utimes(path.join(ideDir, '.system_generated', 'logs', 'transcript.jsonl'), future, future);

      const summaries = await new BrainFs(PROFILE_PATHS).listConversations();
      expect(summaries).toHaveLength(1);
      expect(summaries[0].title).toBe('from cli');
    });

    it('resolves transcript and artifacts of a conversation that only exists under the IDE root', async () => {
      const id = 'd4444444-4444-4444-8444-444444444444';
      const ideDir = await installBrainSample(ideRoot, id);
      const brain = new BrainFs(PROFILE_PATHS);

      expect(brain.resolveConversationDir(id)).toBe(ideDir);

      const handle = await brain.tailTranscript(id, {});
      const types: string[] = [];
      for await (const step of handle.steps) {
        types.push(step.type);
        if (step.stepIndex === 4) {
          handle.stop();
          break;
        }
      }
      expect(types[0]).toBe('USER_INPUT');
      expect(types).toHaveLength(5);

      const artifacts = await brain.listArtifacts(id, 'session-ide');
      expect(artifacts.map((a) => a.relativePath)).toEqual(['implementation_plan.md', 'walkthrough.md']);
    });

    it('resolves conversations that exist nowhere yet to the CLI root (where agy writes)', () => {
      const id = 'e5555555-5555-4555-8555-555555555555';
      expect(new BrainFs(PROFILE_PATHS).resolveConversationDir(id)).toBe(path.join(cliRoot, 'brain', id));
    });

    it('purge removes brain dirs and .db files under both roots', async () => {
      const id = 'f6666666-6666-4666-8666-666666666666';
      const dirs = [await installBrainSample(cliRoot, id), await installBrainSample(ideRoot, id)];
      const dbs: string[] = [];
      for (const root of [cliRoot, ideRoot]) {
        await fs.promises.mkdir(path.join(root, 'conversations'), { recursive: true });
        for (const s of ['.db', '.db-shm', '.db-wal']) {
          const f = path.join(root, 'conversations', `${id}${s}`);
          await fs.promises.writeFile(f, 'x', 'utf-8');
          dbs.push(f);
        }
      }

      await new BrainFs(PROFILE_PATHS).purgeConversation(id);

      for (const p of [...dirs, ...dbs]) expect(fs.existsSync(p), p).toBe(false);
    });
  });

  describe('BrainFs integration with BrainPort', () => {
    it('implements BrainPort interface completely', async () => {
      const brain = new BrainFs(PROFILE_PATHS);

      const convId = '77777777-7777-4777-8777-777777777777';
      const convDir = await installBrainSample(dataRoot, convId);

      const handle = await brain.tailTranscript(convId, {}, dataRoot);
      const received: number[] = [];
      for await (const step of handle.steps) {
        received.push(step.stepIndex);
        handle.stop();
        break;
      }
      expect(received).toEqual([0]);

      await brain.purgeConversation(convId, dataRoot);
      expect(fs.existsSync(convDir)).toBe(false);
    });
  });
});
