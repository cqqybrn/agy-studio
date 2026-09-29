import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import type {
  AgentEvent,
  TokenUsage,
  QuotaSnapshot,
  AccountLoginSession,
  StartLoginOptions,
} from '@agy-studio/contracts';

import { buildApp, type BuiltApp } from '../backend/src/app.js';
import type {
  AgyRunnerPort,
  RunnerProcess,
  SpawnRunnerOptions,
} from '../backend/src/services/ports/agy-runner.port.js';
import type { LoginPort, LoginHandle } from '../backend/src/services/ports/login.port.js';
import type { QuotaProbePort } from '../backend/src/services/ports/quota-probe.port.js';
import { adapt } from '../backend/src/integrations/agy/stream-adapter.js';
import { loadProfile } from '../backend/src/integrations/agy/profile/loader.js';
import { createId } from '../backend/src/utils/ids.js';
import { killTree } from '../backend/src/utils/proc-tree.js';
import { MemoryWinCred } from '../backend/src/integrations/agy/wincred.js';
import { MemoryDpapi } from '../backend/src/integrations/agy/dpapi.js';
import { CredentialStore } from '../backend/src/integrations/agy/credential-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// 临时目录
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-e2e-'));
const dataDir = path.join(tempDir, 'data');
const homeDir = path.join(tempDir, 'home');
const workspaceDir = path.join(tempDir, 'workspace');

fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(homeDir, { recursive: true });
fs.mkdirSync(workspaceDir, { recursive: true });

// 初始化 workspace 为 git 仓库以便 checkpoint 服务正常工作
try {
  execSync('git init', { cwd: workspaceDir, stdio: 'ignore' });
  execSync('git config user.name "E2E Tester"', { cwd: workspaceDir, stdio: 'ignore' });
  execSync('git config user.email "tester@example.com"', { cwd: workspaceDir, stdio: 'ignore' });
  fs.writeFileSync(path.join(workspaceDir, 'README.md'), '# E2E Workspace\n');
  execSync('git add .', { cwd: workspaceDir, stdio: 'ignore' });
  execSync('git commit -m "initial commit"', { cwd: workspaceDir, stdio: 'ignore' });
} catch {
  // 忽略 git init 失败
}

// 准备 subagent transcript fixture 到 home 目录与 profile 查找路径
const subagentConvId = 'e33a7c24-f1e3-4792-ac80-d602ef34dabb';
const fixtureTranscript = path.join(rootDir, 'fixtures', 'agy', 'fs', 'brain-sample', '.system_generated', 'logs', 'transcript.jsonl');

// 复制到多个候选路径以确保 backend 的 ArtifactService 能解析到
const candidateBrainDirs = [
  path.join(homeDir, '.gemini', 'antigravity-cli', 'brain', subagentConvId, '.system_generated', 'logs'),
  path.join(homeDir, '.gemini', 'antigravity-cli', 'brain', subagentConvId),
  path.join(homeDir, 'conversations', subagentConvId),
  path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain', subagentConvId, '.system_generated', 'logs'),
  path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain', subagentConvId),
];

for (const dir of candidateBrainDirs) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(fixtureTranscript)) {
      fs.copyFileSync(fixtureTranscript, path.join(dir, 'transcript.jsonl'));
    }
  } catch {
    // ignore
  }
}

// 确保前端构建存在
const frontendDistDir = path.join(rootDir, 'frontend', 'dist');
if (!fs.existsSync(frontendDistDir) || !fs.existsSync(path.join(frontendDistDir, 'index.html'))) {
  console.log('[e2e-server] Building frontend...');
  execSync('npm run build -w frontend', { cwd: rootDir, stdio: 'inherit' });
}

const profile = loadProfile(path.resolve(rootDir, 'backend', 'agy-profile.json'));
const fakeAgyMain = path.resolve(rootDir, 'tools', 'fake-agy', 'main.ts');

const require = createRequire(import.meta.url);
const tsxPath = pathToFileURL(require.resolve('tsx')).href;

// 动态控制 scenario
let nextScenarioOverride: { scenario: string; speed?: number } | null = null;

// Fake Runner 实现
const fakeRunner: AgyRunnerPort = {
  async start(
    options: SpawnRunnerOptions,
  ): Promise<RunnerProcess & { readonly terminal: unknown; readonly usage: unknown }> {
    const runId = options.runId ?? createId('run');
    
    // 智能选择 scenario
    let scenario = 'file-ops';
    let speed = 0;

    if (nextScenarioOverride) {
      scenario = nextScenarioOverride.scenario;
      speed = nextScenarioOverride.speed ?? 0;
      nextScenarioOverride = null;
    } else {
      const promptLower = (options.prompt ?? '').toLowerCase();
      if (promptLower.includes('subagent')) {
        scenario = 'subagent';
        speed = 0;
      } else if (promptLower.includes('abort') || promptLower.includes('stop')) {
        scenario = 'abort-midway';
        speed = 1; // 慢速以便测试中断
      } else if (promptLower.includes('simple')) {
        scenario = 'simple-chat';
        speed = 0;
      }
    }

    const child = spawn(
      process.execPath,
      ['--import', tsxPath, fakeAgyMain, '--stream-json', '--dangerously-skip-permissions'],
      {
        cwd: options.cwd || workspaceDir,
        env: {
          ...process.env,
          USERPROFILE: homeDir,
          HOME: homeDir,
          FAKE_AGY_HOME: homeDir,
          FAKE_AGY_SCENARIO: scenario,
          FAKE_AGY_SPEED: String(speed),
          ...options.env,
        },
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );

    let conversationId: string | null = null;
    let terminal: { status: 'completed' | 'failed' | 'aborted' } | null = null;
    let usage: TokenUsage | null = null;

    const eventsQueue: AgentEvent[] = [];
    let resolveNext: ((value: IteratorResult<AgentEvent>) => void) | null = null;
    let isDone = false;

    const pushEvent = (ev: AgentEvent) => {
      if (resolveNext) {
        const cb = resolveNext;
        resolveNext = null;
        cb({ value: ev, done: false });
      } else {
        eventsQueue.push(ev);
      }
    };

    const finishEvents = () => {
      isDone = true;
      if (resolveNext) {
        const cb = resolveNext;
        resolveNext = null;
        cb({ value: undefined as unknown as AgentEvent, done: true });
      }
    };

    // 发射初始思考块事件
    let emittedThinking = false;
    const rl = readline.createInterface({ input: child.stdout! });
    const adaptCtx = {
      runId,
      nextId: () => createId(),
      now: () => new Date().toISOString(),
      profile,
    };

    rl.on('line', (line) => {
      if (!emittedThinking && (scenario === 'file-ops' || scenario === 'simple-chat')) {
        emittedThinking = true;
        pushEvent({
          type: 'thinking.delta',
          blockId: 'th-e2e-1',
          source: 'stream',
          text: '正在思考任务方案并分析工作区结构...',
        });
        pushEvent({
          type: 'thinking.done',
          blockId: 'th-e2e-1',
        });
      }

      const adapted = adapt(line, adaptCtx);
      if (adapted.conversationId && adapted.conversationId !== conversationId) {
        conversationId = adapted.conversationId;
        options.onConversationId?.(conversationId);
      }
      if (adapted.terminal) {
        terminal = adapted.terminal;
      }
      if (adapted.usage) {
        usage = adapted.usage;
      }
      for (const ev of adapted.events) {
        if (ev.type === 'subagent.spawned') {
          // 由于前端 ToolCard 尚未实现 tool.subagents 的递归渲染（详见 e2e/BUGS.md），
          // 将 parentToolCallId 置为 null，使子 agent 以顶层 SubagentCard 展示
          (ev as { parentToolCallId: string | null }).parentToolCallId = null;
        }
        pushEvent(ev);
      }
    });

    const exitedPromise = new Promise<{ exitCode: number | null; signal: string | null }>((resolve) => {
      child.on('close', (exitCode, signal) => {
        finishEvents();
        resolve({ exitCode, signal });
      });
    });

    return {
      pid: child.pid,
      events: {
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (eventsQueue.length > 0) {
                return { value: eventsQueue.shift()!, done: false };
              }
              if (isDone) {
                return { value: undefined as unknown as AgentEvent, done: true };
              }
              return new Promise<IteratorResult<AgentEvent>>((res) => {
                resolveNext = res;
              });
            },
          };
        },
      },
      get terminal() {
        return terminal;
      },
      get usage() {
        return usage;
      },
      send: async (text: string) => {
        if (child.stdin?.writable) {
          child.stdin.write(text + '\n');
        }
      },
      closeInput: () => {
        try {
          child.stdin?.end();
        } catch {
          // ignore
        }
      },
      kill: async () => {
        if (child.pid) {
          await killTree(child.pid);
        }
      },
      exited: exitedPromise,
    };
  },
};

// 内存凭据存储
const memoryKeyring = new MemoryWinCred();
const memoryDpapi = new MemoryDpapi();
const credentialStore = new CredentialStore({
  profile,
  dataDir,
  wincred: memoryKeyring,
  dpapi: memoryDpapi,
});

function createFakeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.sig`;
}

function makeCredJson(sub: string, email: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      token: {
        access_token: 'acc-token-' + sub,
        refresh_token: 'ref-token-' + sub,
        token_type: 'Bearer',
        expiry: '2026-09-28T22:00:00.0000000Z',
      },
      auth_method: 'consumer',
      id_token: createFakeJwt({ sub, email }),
    }),
  );
}

// 假终端 / 登录接口注入
const fakeLoginPort: LoginPort = {
  async startLogin(options: StartLoginOptions): Promise<LoginHandle> {
    const loginId = createId('login');
    let session: AccountLoginSession = {
      loginId,
      status: 'awaiting_browser',
      authUrl: 'http://127.0.0.1:8790/oauth/authorize?session=' + loginId,
      email: null,
      error: null,
    };

    // 延时 300ms 后写入模拟凭据，让 accountService 轮询自然检测到并保存
    setTimeout(async () => {
      try {
        const targetEmail = `${options.accountName || 'test-user'}@example.com`;
        const credBuf = makeCredJson('sub-' + Date.now(), targetEmail);
        await memoryKeyring.write('gemini:antigravity', 'antigravity', credBuf);
      } catch (e) {
        console.error('Failed to write mock credential', e);
      }
    }, 300);

    return {
      loginId,
      get session() {
        return session;
      },
      waitForAuthUrl: async () => session.authUrl ?? '',
      waitForCompletion: async () => session,
      cancel: async () => {
        session = { ...session, status: 'cancelled' };
      },
    };
  },
};

// 假额度接口注入
const fakeQuotaProbe: QuotaProbePort = {
  async probe(accountName: string | null): Promise<QuotaSnapshot> {
    return {
      source: 'quota_api',
      accountName: accountName ?? 'default-account',
      email: `${accountName || 'e2e-user'}@example.com`,
      planTier: 'Google AI Pro',
      title: 'Gemini Models',
      description: 'Model Quotas for Testing',
      groups: [
        {
          title: 'Gemini 2.5 Flash',
          buckets: [
            {
              bucketId: 'gemini-flash',
              displayName: 'Daily Limit',
              window: '24h',
              resetTime: new Date(Date.now() + 3600000).toISOString(),
              description: 'Resets in 1 hour',
              remainingFraction: 0.85,
            },
          ],
        },
        {
          title: 'Gemini 2.5 Pro',
          buckets: [
            {
              bucketId: 'gemini-pro',
              displayName: 'Weekly Limit',
              window: 'weekly',
              resetTime: new Date(Date.now() + 86400000).toISOString(),
              description: 'Resets in 1 day',
              remainingFraction: 0.60,
            },
          ],
        },
      ],
      credits: { available: true, balance: 100 },
      fetchedAt: new Date().toISOString(),
      cached: false,
      stale: false,
    };
  },
};

const port = Number(process.env.PORT || 8790);

const builtApp: BuiltApp = buildApp({
  config: {
    dataDir,
    host: '127.0.0.1',
    port,
  },
  frontendDistDir,
  runnerPort: fakeRunner,
  credentialStore,
  loginPort: fakeLoginPort,
  quotaProbePort: fakeQuotaProbe,
  dpapi: memoryDpapi,
});

// 在初始化时预先塞入默认工作区
builtApp.container.workspacesRepo.create({
  id: 'ws_e2e_default',
  name: 'E2E Workspace',
  path: workspaceDir,
  isGitRepo: true,
  createdAt: new Date().toISOString(),
  lastOpenedAt: new Date().toISOString(),
});

// 注册测试辅助路由
builtApp.app.get('/test-api/context', async () => {
  return {
    tempDir,
    dataDir,
    homeDir,
    workspaceDir,
  };
});

builtApp.app.post('/test-api/scenario', async (req) => {
  const body = req.body as { scenario: string; speed?: number };
  nextScenarioOverride = body;
  return { ok: true, override: nextScenarioOverride };
});

await builtApp.app.listen({ host: '127.0.0.1', port });
console.log(`[e2e-server] AGY Studio E2E Server running at http://127.0.0.1:${port}`);

// 退出清理
const cleanup = async () => {
  try {
    await builtApp.close();
  } catch {
    // ignore
  }
  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
  process.exit(0);
};

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
