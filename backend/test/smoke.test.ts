import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import type {
  ClientFrame,
  ServerFrame,
  SessionEventEnvelope,
  Workspace,
  Session,
  Health,
  Capabilities,
  AgentEvent,
  TokenUsage,
} from '@agy-studio/contracts';

import { buildApp, type BuiltApp } from '../src/app.js';
import type {
  AgyRunnerPort,
  RunnerProcess,
  SpawnRunnerOptions,
} from '../src/services/ports/agy-runner.port.js';
import { adapt } from '../src/integrations/agy/stream-adapter.js';
import { loadProfile } from '../src/integrations/agy/profile/loader.js';
import { createId } from '../src/utils/ids.js';
import { killTree } from '../src/utils/proc-tree.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Backend Smoke Test: E2E Lifecycle', () => {
  let tempDir: string;
  let workspaceDir: string;
  let dataDir: string;
  let builtApp: BuiltApp;
  let httpUrl: string;
  let wsUrl: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-smoke-test-'));
    workspaceDir = path.join(tempDir, 'workspace');
    dataDir = path.join(tempDir, 'data');
    fs.mkdirSync(workspaceDir, { recursive: true });
    fs.mkdirSync(dataDir, { recursive: true });

    const profile = loadProfile(path.resolve(__dirname, '../agy-profile.json'));
    const fakeAgyMain = path.resolve(__dirname, '../../tools/fake-agy/main.ts');

    const require = createRequire(import.meta.url);
    const tsxPath = pathToFileURL(require.resolve('tsx')).href;

    // Create a runner that spawns fake-agy with simple-chat scenario
    const fakeRunner: AgyRunnerPort = {
      async start(
        options: SpawnRunnerOptions,
      ): Promise<RunnerProcess & { readonly terminal: unknown; readonly usage: unknown }> {
        const runId = options.runId ?? createId('run');
        const child = spawn(
          process.execPath,
          ['--import', tsxPath, fakeAgyMain, '--stream-json', '--dangerously-skip-permissions'],
          {
            cwd: options.cwd,
            env: {
              ...process.env,
              FAKE_AGY_SCENARIO: 'simple-chat',
              FAKE_AGY_SPEED: '0',
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

        const rl = readline.createInterface({ input: child.stdout! });
        const adaptCtx = {
          runId,
          nextId: () => createId(),
          now: () => new Date().toISOString(),
          profile,
        };

        rl.on('line', (line) => {
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
            pushEvent(ev);
          }
        });

        const exitedPromise = new Promise<{ exitCode: number | null; signal: string | null }>(
          (resolve) => {
            child.on('close', (exitCode, signal) => {
              finishEvents();
              resolve({ exitCode, signal });
            });
          },
        );

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

    builtApp = buildApp({
      config: {
        dataDir,
        host: '127.0.0.1',
      },
      runnerPort: fakeRunner,
    });

    await builtApp.app.listen({ host: '127.0.0.1', port: 0 });
    const address = builtApp.app.server.address() as net.AddressInfo;
    const port = address.port;
    httpUrl = `http://127.0.0.1:${port}`;
    wsUrl = `ws://127.0.0.1:${port}/ws`;
  });

  afterEach(async () => {
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
  });

  it('runs complete lifecycle: workspace -> session -> WS session.send -> run.started ... run.completed -> REST events verification', async () => {
    // 1. 创建工作区
    const createWsRes = await fetch(`${httpUrl}/api/workspaces`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: workspaceDir,
        name: 'Smoke Test Workspace',
      }),
    });
    expect(createWsRes.status).toBe(201);
    const workspace = (await createWsRes.json()) as Workspace;
    expect(workspace.id).toBeDefined();
    expect(workspace.path).toBe(path.resolve(workspaceDir));

    // 验证工作区列表接口
    const listWsRes = await fetch(`${httpUrl}/api/workspaces`);
    expect(listWsRes.status).toBe(200);
    const workspaces = (await listWsRes.json()) as Workspace[];
    expect(workspaces.some((w) => w.id === workspace.id)).toBe(true);

    // 2. 创建会话
    const createSessionRes = await fetch(`${httpUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId: workspace.id,
        title: 'Smoke Test Session',
      }),
    });
    expect(createSessionRes.status).toBe(201);
    const session = (await createSessionRes.json()) as Session;
    expect(session.id).toBeDefined();
    expect(session.workspaceId).toBe(workspace.id);

    // 验证会话详情接口
    const getSessionRes = await fetch(`${httpUrl}/api/sessions/${session.id}`);
    expect(getSessionRes.status).toBe(200);
    const retrievedSession = (await getSessionRes.json()) as Session;
    expect(retrievedSession.id).toBe(session.id);

    // 3. 建立 WebSocket 连接
    const ws = new WebSocket(wsUrl);
    await new Promise<void>((resolve, reject) => {
      ws.on('open', () => resolve());
      ws.on('error', (err) => reject(err));
    });

    const receivedFrames: ServerFrame[] = [];
    const receivedEvents: AgentEvent[] = [];

    const waitForFrame = (predicate: (f: ServerFrame) => boolean, timeoutMs = 8000) =>
      new Promise<ServerFrame>((resolve, reject) => {
        const found = receivedFrames.find(predicate);
        if (found) return resolve(found);

        const timer = setTimeout(() => {
          reject(new Error(`Timeout waiting for frame after ${timeoutMs}ms`));
        }, timeoutMs);

        const handler = (data: Buffer) => {
          const parsed = JSON.parse(data.toString('utf-8')) as ServerFrame;
          if (predicate(parsed)) {
            clearTimeout(timer);
            ws.removeListener('message', handler);
            resolve(parsed);
          }
        };
        ws.on('message', handler);
      });

    ws.on('message', (data: Buffer) => {
      try {
        const frame = JSON.parse(data.toString('utf-8')) as ServerFrame;
        receivedFrames.push(frame);
        if (frame.type === 'event' && frame.envelope?.event) {
          receivedEvents.push(frame.envelope.event);
        }
      } catch {
        // ignore malformed frame
      }
    });

    // 4. 订阅会话
    const subscribeFrame: ClientFrame = {
      type: 'session.subscribe',
      sessionIds: [session.id],
      lastSeq: { [session.id]: 0 },
    };
    ws.send(JSON.stringify(subscribeFrame));

    // 等待 subscribed 确认
    await waitForFrame(
      (f) => f.type === 'subscribed' && f.sessionId === session.id,
    );

    // 5. 通过 WebSocket 发送 session.send
    const sendFrame: ClientFrame = {
      type: 'session.send',
      requestId: 'smoke-req-1',
      sessionId: session.id,
      text: '你好，Antigravity！请执行冒烟测试任务。',
      attachmentIds: [],
    };
    ws.send(JSON.stringify(sendFrame));

    // 等待 ack 确认帧
    const ackFrame = (await waitForFrame(
      (f) => f.type === 'ack' && f.requestId === 'smoke-req-1',
    )) as { type: 'ack'; requestId: string; runId: string };
    expect(ackFrame.runId).toBeDefined();

    // 等待 run.started 事件
    await waitForFrame(
      (f) => f.type === 'event' && f.envelope?.event?.type === 'run.started',
    );

    // 等待 run.completed 事件 (带 status: completed)
    const completedFrame = (await waitForFrame(
      (f) => f.type === 'event' && f.envelope?.event?.type === 'run.completed',
      15_000,
    )) as { type: 'event'; envelope: SessionEventEnvelope };

    expect(completedFrame.envelope.event.type).toBe('run.completed');
    if (completedFrame.envelope.event.type === 'run.completed') {
      expect(completedFrame.envelope.event.status).toBe('completed');
    }

    // 关闭 ws 连接
    ws.close();

    // 6. 验证 REST 历史事件接口 GET /api/sessions/:id/events
    const eventsRes = await fetch(
      `${httpUrl}/api/sessions/${session.id}/events?afterSeq=0&limit=100`,
    );
    expect(eventsRes.status).toBe(200);
    const eventsData = (await eventsRes.json()) as {
      items: SessionEventEnvelope[];
      latestSeq: number;
      hasMore: boolean;
    };
    const persistedEnvelopes = eventsData.items;
    expect(persistedEnvelopes.length).toBeGreaterThanOrEqual(2);

    // 验证事件 seq 单调递增从 1 开始连续
    for (let i = 0; i < persistedEnvelopes.length; i++) {
      expect(persistedEnvelopes[i].seq).toBe(i + 1);
      expect(persistedEnvelopes[i].sessionId).toBe(session.id);
    }

    const types = persistedEnvelopes.map((e) => e.event.type);
    expect(types).toContain('run.started');
    expect(types).toContain('run.completed');

    // 7. 验证运行列表接口 GET /api/sessions/:id/runs
    const runsRes = await fetch(`${httpUrl}/api/sessions/${session.id}/runs`);
    expect(runsRes.status).toBe(200);
    const runs = (await runsRes.json()) as Array<{ id: string; status: string }>;
    expect(runs.some((r) => r.id === ackFrame.runId && r.status === 'completed')).toBe(true);

    // 8. 验证系统健康与能力接口
    const healthRes = await fetch(`${httpUrl}/api/health`);
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as Health;
    expect(health.ok).toBe(true);
    expect(health.version).toBeDefined();

    const capabilitiesRes = await fetch(`${httpUrl}/api/capabilities`);
    expect(capabilitiesRes.status).toBe(200);
    const capabilities = (await capabilitiesRes.json()) as Capabilities;
    expect(capabilities.autoApprove).toBe(true);
  });
});
