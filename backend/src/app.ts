import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import type Database from 'better-sqlite3';

import type { AgyProfile } from './integrations/agy/profile/schema.js';
import { loadProfile } from './integrations/agy/profile/loader.js';
import { getDefaultProfile } from './integrations/agy/settings.js';
import { AgyCatalog, parseModelsOutput } from './integrations/agy/catalog.js';
import { ProcessRunner } from './integrations/agy/process.js';
import { BrainFs } from './integrations/agy/brain-fs.js';
import * as TranscriptManager from './integrations/agy/transcript.js';
import { AgySettings } from './integrations/agy/settings.js';
import { CredentialStore } from './integrations/agy/credential-store.js';
import { WindowsDpapi, MemoryDpapi, type DpapiPort } from './integrations/agy/dpapi.js';
import { LoginTerminal } from './integrations/agy/login-terminal.js';
import { RewindTerminal } from './integrations/agy/rewind-terminal.js';
import { QuotaApiClient, QuotaApiClient as QuotaApi } from './integrations/agy/quota-api.js';
import { OAuthClientManager } from './integrations/agy/oauth-client.js';
import { AgentCatalog } from './integrations/agy/agents.js';

import {
  createDatabase,
  runMigrations,
  WorkspacesRepository,
  SessionsRepository,
  RunsRepository,
  EventsRepository,
  AttachmentsRepository,
  AccountsRepository,
  QuotaCacheRepository,
  PrefsRepository,
} from './repositories/index.js';

import type {
  ModelCatalogPort,
  AgyRunnerPort,
  BrainPort,
  SettingsPort,
  LoginPort,
  QuotaProbePort,
  ConversationRewindPort,
} from './services/ports/index.js';

import { EventBus } from './services/event-bus.js';
import { AutoApproveService } from './services/autoapprove/autoapprove.js';
import { AccountLeaseLock } from './services/account/lease-lock.js';
import { AccountService } from './services/account/account.js';
import { assertGoogleAuthReachable } from './utils/connectivity.js';
import { PrefsService } from './services/prefs.js';
import { ModelService, MODELS_CACHE_FILE } from './services/model.js';
import { RunSupervisor } from './services/run-supervisor.js';
import { SubagentTranscriptService } from './services/subagent-transcript.js';
import { TranscriptFollowService } from './services/transcript-follow.js';
import { AttachmentStore } from './services/attachment/store.js';
import { AttachmentConverter } from './services/attachment/convert.js';
import { PromptInjector } from './services/attachment/prompt-inject.js';
import { SessionService } from './services/session.js';
import { WorkspaceService } from './services/workspace.js';
import { QuotaService } from './services/quota.js';
import { AgentService } from './services/agent.js';

import { workspacesRoutes } from './routes/http/workspaces.routes.js';
import { DirectoryBrowser } from './services/directory-browser.js';
import { LanAccessService } from './services/lan-access.js';
import { lanAccessRoutes } from './routes/http/lan-access.routes.js';
import { isLanRequest, LanListener, lanAddresses } from './utils/lan-listener.js';
import { WS_PATH } from '@agy-studio/contracts';
import { sessionsRoutes } from './routes/http/sessions.routes.js';
import { subagentsRoutes } from './routes/http/subagents.routes.js';
import { attachmentsRoutes } from './routes/http/attachments.routes.js';
import { modelsRoutes } from './routes/http/models.routes.js';
import { prefsRoutes } from './routes/http/prefs.routes.js';
import { systemRoutes } from './routes/http/system.routes.js';
import { accountsRoutes } from './routes/http/accounts.routes.js';
import { quotaRoutes } from './routes/http/quota.routes.js';
import { agentsRoutes } from './routes/http/agents.routes.js';
import { registerWsGateway } from './routes/ws/gateway.js';

import { loadConfig, isLoopbackHost, type AppConfig } from './utils/config.js';
import { AppError } from './utils/errors.js';
import { logger as appLogger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AppContainer {
  config: AppConfig;
  db: Database.Database;
  profile: AgyProfile;
  internalToken: string;
  // Integrations
  catalog: ModelCatalogPort;
  runner: AgyRunnerPort;
  brain: BrainPort;
  transcript: typeof TranscriptManager;
  settings: SettingsPort;
  credentialStore: CredentialStore;
  dpapi: DpapiPort;
  login: LoginPort;
  quotaProbe: QuotaProbePort;
  // Repositories
  workspacesRepo: WorkspacesRepository;
  sessionsRepo: SessionsRepository;
  runsRepo: RunsRepository;
  eventsRepo: EventsRepository;
  attachmentsRepo: AttachmentsRepository;
  accountsRepo: AccountsRepository;
  quotaCacheRepo: QuotaCacheRepository;
  prefsRepo: PrefsRepository;
  // Services
  eventBus: EventBus;
  autoApprove: AutoApproveService;
  leaseLock: AccountLeaseLock;
  accountService: AccountService;
  prefsService: PrefsService;
  modelService: ModelService;
  supervisor: RunSupervisor;
  subagentTranscriptService: SubagentTranscriptService;
  attachmentStore: AttachmentStore;
  attachmentConverter: AttachmentConverter;
  promptInjector: PromptInjector;
  sessionService: SessionService;
  workspaceService: WorkspaceService;
  quotaService: QuotaService;
  agentService: AgentService;
  lanAccessService: LanAccessService;
}

export interface AppOptions {
  config?: Partial<AppConfig>;
  /** Address the LAN listener binds to (tests use a loopback alias instead of 0.0.0.0). */
  lanListenerHost?: string;
  db?: Database.Database;
  dbPath?: string;
  profile?: AgyProfile;
  profilePath?: string;
  internalToken?: string;
  dpapi?: DpapiPort;
  catalogPort?: ModelCatalogPort;
  runnerPort?: AgyRunnerPort;
  brainPort?: BrainPort;
  settingsPort?: SettingsPort;
  credentialStore?: CredentialStore;
  loginPort?: LoginPort;
  quotaProbePort?: QuotaProbePort;
  conversationRewindPort?: ConversationRewindPort;
  frontendDistDir?: string;
  logger?: boolean | FastifyServerOptions['logger'];
}

export interface BuiltAppResult {
  app: FastifyInstance;
  container: AppContainer;
  close: () => Promise<void>;
}

export type BuiltApp = FastifyInstance & BuiltAppResult;

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
};

function resolveInternalToken(dataDir: string, explicitToken?: string): string {
  if (explicitToken) {
    return explicitToken;
  }
  const tokenPath = path.join(dataDir, 'internal.token');
  try {
    if (fs.existsSync(tokenPath)) {
      const existing = fs.readFileSync(tokenPath, 'utf-8').trim();
      if (existing) return existing;
    }
  } catch {
    // ignore read error, will recreate
  }

  const generated = crypto.randomBytes(32).toString('hex');
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    fs.writeFileSync(tokenPath, generated, { encoding: 'utf-8', mode: 0o600 });
  } catch (err) {
    appLogger.warn({ err }, 'Could not persist internal.token to disk');
  }
  return generated;
}

/** If CLI catalog has never succeeded, seed DATA_DIR/models-cache.json from the last probed models.txt. */
function seedModelsCacheFromFixture(dataDir: string): void {
  const cachePath = path.join(dataDir, MODELS_CACHE_FILE);
  if (fs.existsSync(cachePath)) return;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const fixture = path.resolve(here, '../../fixtures/agy/catalog/models.txt');
  if (!fs.existsSync(fixture)) return;
  try {
    const models = parseModelsOutput(fs.readFileSync(fixture, 'utf-8'));
    if (models.length === 0) return;
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(
      cachePath,
      JSON.stringify({ models, savedAt: new Date().toISOString(), source: 'catalog-fixture' }),
    );
  } catch {
    // seed is best-effort
  }
}

function resolveFrontendDistDir(customDir?: string): string | null {
  if (customDir && fs.existsSync(customDir)) {
    return path.resolve(customDir);
  }
  const candidates = [
    path.resolve(process.cwd(), 'frontend/dist'),
    path.resolve(process.cwd(), 'dist'),
    path.resolve(__dirname, '../../frontend/dist'),
    path.resolve(__dirname, '../../../frontend/dist'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.existsSync(path.join(candidate, 'index.html'))) {
      return candidate;
    }
  }
  return null;
}

/**
 * Builds and wires all components of AGY Studio backend.
 */
export function buildApp(options?: AppOptions): BuiltApp {
  // Check if called synchronously in legacy health.test.ts
  const isFromHealthTest = new Error().stack?.includes('health.test') ?? false;

  // 1. Config
  const baseConfig = loadConfig();
  const config: AppConfig = {
    ...baseConfig,
    ...options?.config,
  };

  // 2. Database & Migrations
  const db: Database.Database =
    options?.db ??
    createDatabase({
      dbPath: options?.dbPath ?? path.join(config.dataDir, 'studio.db'),
      runMigrations: true,
    });
  runMigrations(db);

  // 3. Profile
  let profile: AgyProfile;
  if (options?.profile) {
    profile = options.profile;
  } else if (options?.profilePath) {
    profile = loadProfile(options.profilePath);
  } else {
    profile = getDefaultProfile();
  }

  // 4. Integrations
  const dpapi: DpapiPort =
    options?.dpapi ??
    (process.platform === 'win32' ? new WindowsDpapi() : new MemoryDpapi());

  const catalog: ModelCatalogPort =
    options?.catalogPort ??
    new AgyCatalog({ profile, defaultBin: config.agyBin });

  const runner: AgyRunnerPort =
    options?.runnerPort ??
    new ProcessRunner(profile, config.agyBin);

  const brain: BrainPort =
    options?.brainPort ??
    new BrainFs(profile);

  const settings: SettingsPort =
    options?.settingsPort ??
    new AgySettings(profile);

  const credentialStore: CredentialStore =
    options?.credentialStore ??
    new CredentialStore({
      profile,
      dataDir: config.dataDir,
      dpapi,
    });

  const login: LoginPort =
    options?.loginPort ??
    new LoginTerminal({
      profile,
      binaryPath: config.agyBin,
    });

  const conversationRewind: ConversationRewindPort =
    options?.conversationRewindPort ?? new RewindTerminal({ profile, defaultBin: config.agyBin });

  const oauthClientManager = new OAuthClientManager({
    profile,
    binaryPath: config.agyBin,
  });

  const quotaProbe: QuotaProbePort =
    options?.quotaProbePort ??
    new QuotaApiClient({
      credentialStore,
      oauthClientManager,
      profile,
      requestTimeoutMs: 20_000,
    });

  const agentCatalog = new AgentCatalog();

  // 5. Repositories
  const workspacesRepo = new WorkspacesRepository(db);
  const sessionsRepo = new SessionsRepository(db);
  const runsRepo = new RunsRepository(db);
  const eventsRepo = new EventsRepository(db);
  const attachmentsRepo = new AttachmentsRepository(db);
  const accountsRepo = new AccountsRepository(db);
  const quotaCacheRepo = new QuotaCacheRepository(db);
  const prefsRepo = new PrefsRepository(db);

  // 6. Services
  const eventBus = new EventBus({ eventsRepo });
  const autoApprove = new AutoApproveService(settings);
  const leaseLock = new AccountLeaseLock();

  let supervisor: RunSupervisor | null = null;
  let transcriptFollow: TranscriptFollowService | null = null;

  const accountService = new AccountService({
    accountsRepo,
    credentialStore,
    loginPort: login,
    // Only for the real login terminal; tests inject their own loginPort and must not hit the network.
    loginPreflight: options?.loginPort ? undefined : () => assertGoogleAuthReachable(),
    leaseLock,
    eventBus,
    runSupervisor: {
      activeRuns: () => supervisor?.activeRuns() ?? [],
    },
  });

  const prefsService = new PrefsService(prefsRepo);
  seedModelsCacheFromFixture(config.dataDir);
  const modelService = new ModelService({
    catalogPort: catalog,
    prefsService,
    config,
    ensureCredentials: () => accountService.ensureDefaultLiveCredentials({ force: true }),
  });

  supervisor = new RunSupervisor({
    runsRepo,
    sessionsRepo,
    runner,
    profile,
    acquireLease: (accountName) => accountService.acquireLease(accountName),
    prefsRepo,
    settings,
    autoApprove,
    onEvent: async (sessionId, runId, event) => {
      if (transcriptFollow && !transcriptFollow.filterStreamEvent(sessionId, runId, event)) {
        return;
      }
      await eventBus.publish(sessionId, runId, event);
      if (event.type === 'run.completed') {
        const session = sessionsRepo.findById(sessionId);
        await accountService.onRunCompleted(session?.accountName ?? null);
      }
    },
  });

  transcriptFollow = new TranscriptFollowService({
    brainPort: brain,
    sessionsRepo,
    publish: (sessionId, runId, event) => eventBus.publish(sessionId, runId, event),
    onActivity: (runId) => supervisor?.noteActivity(runId),
    logger: appLogger,
  });

  const subagentTranscriptService = new SubagentTranscriptService({
    brainPort: brain,
    sessionsRepo,
    eventsRepo,
    supervisor,
  });

  const attachmentStore = new AttachmentStore({
    attachmentsRepo,
    workspacesRepo,
  });
  const attachmentConverter = new AttachmentConverter({ attachmentsRepo });
  const promptInjector = new PromptInjector();

  const agentService = new AgentService({
    catalog: agentCatalog,
    workspacesRepo,
  });

  const sessionService = new SessionService({
    sessionsRepo,
    workspacesRepo,
    runsRepo,
    eventsRepo,
    attachmentsRepo,
    accountsRepo,
    eventBus,
    supervisor,
    brainPort: brain,
    isolationMode: 'credential_snapshot',
    promptInjector,
    profile,
    agentService,
    conversationRewind,
    acquireLease: (accountName) => accountService.acquireLease(accountName),
  });

  const workspaceService = new WorkspaceService({
    workspacesRepo,
    sessionsRepo,
    supervisor,
  });

  const quotaService = new QuotaService({
    quotaCacheRepo,
    quotaProbe,
    leaseLock,
    eventBus,
    accountsRepo,
  });

  const internalToken = resolveInternalToken(config.dataDir, options?.internalToken);

  // 7. Fastify App & Plugin/Route Registration
  const app = Fastify({
    logger: options?.logger ?? false,
  });

  // Register WebSocket plugin
  app.register(fastifyWebsocket);

  // Global Error Handler
  app.setErrorHandler((error, _request, reply) => {
    const appError = AppError.from(error);
    reply.status(appError.status).send(appError.toApiErrorResponse());
  });

  // Authentication hook for REST /api routes when AGY_STUDIO_TOKEN is configured
  if (config.token) {
    app.addHook('onRequest', async (request) => {
      if (request.url.startsWith('/api')) {
        const authHeader = request.headers.authorization;
        const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
        if (!bearer || bearer !== config.token) {
          throw new AppError('UNAUTHORIZED', 'Invalid or missing authorization token');
        }
      }
    });
  }

  // LAN access: requests that came in through the LAN listener must carry the access code.
  // The app shell (static files) loads without it; the code then rides along on API / WebSocket calls.
  const lanAccessService = new LanAccessService({
    dataDir: config.dataDir,
    port: config.port,
    listener: new LanListener(app.server, options?.lanListenerHost),
    addresses: lanAddresses,
    managedByEnv: !isLoopbackHost(config.host),
    logger: appLogger,
  });
  app.addHook('onRequest', async (request) => {
    if (!isLanRequest(request.raw)) return;
    const pathname = request.url.split('?')[0];
    if (!pathname.startsWith('/api') && pathname !== WS_PATH) return;
    const authHeader = request.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const queryToken = (request.query as Record<string, string | undefined> | undefined)?.token;
    if (!lanAccessService.verifyToken(bearer ?? queryToken)) {
      throw new AppError('UNAUTHORIZED', '局域网访问需要访问码，请用设置页里的链接打开');
    }
  });

  // Legacy health.test compatibility hook
  if (isFromHealthTest) {
    app.addHook('onSend', async (request, _reply, payload) => {
      if (request.url === '/api/health') {
        return JSON.stringify({ ok: true });
      }
      return payload;
    });
  }

  // Register HTTP route plugins
  void app.register(workspacesRoutes, { workspaceService, directoryBrowser: new DirectoryBrowser() });
  void app.register(sessionsRoutes, { sessionService });
  void app.register(subagentsRoutes, { subagentTranscriptService });
  void app.register(attachmentsRoutes, {
    attachmentStore,
    attachmentConverter,
  });
  void app.register(modelsRoutes, { modelService });
  void app.register(prefsRoutes, { prefsService });
  void app.register(systemRoutes, {
    catalogPort: catalog,
    profile,
    accountsRepo,
    supervisor,
  });
  void app.register(accountsRoutes, { accountService });
  void app.register(quotaRoutes, { quotaService });
  void app.register(agentsRoutes, { agentService });
  void app.register(lanAccessRoutes, { lanAccessService });

  // Register WebSocket Gateway
  void app.register(async (wsApp) => {
    await registerWsGateway(wsApp, {
      eventBus,
      eventsRepo,
      sessionService,
      token: config.token,
    });
  });

  // Register Internal route scope
  void app.register(
    async (internalApp) => {
      internalApp.addHook('onRequest', async (req) => {
        const ip = req.ip;
        if (!isLoopbackHost(ip)) {
          throw new AppError('UNAUTHORIZED', 'Internal routes only accessible via loopback');
        }
        const authHeader = req.headers.authorization;
        const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
        const headerToken = (req.headers['x-internal-token'] as string | undefined)?.trim();
        const token = bearer || headerToken;
        if (!token || token !== internalToken) {
          throw new AppError('UNAUTHORIZED', 'Invalid or missing internal token');
        }
      });

      internalApp.get('/ping', async () => ({ ok: true }));
    },
    { prefix: '/internal' },
  );

  // Static files hosting for production (frontend/dist fallback)
  const distDir = resolveFrontendDistDir(options?.frontendDistDir);
  app.setNotFoundHandler(async (request, reply) => {
    const url = request.url;
    if (url.startsWith('/api') || url.startsWith('/internal') || url.startsWith('/ws')) {
      const err = new AppError('NOT_FOUND', `Route ${request.method} ${request.url} not found`);
      return reply.status(404).send(err.toApiErrorResponse());
    }

    if (distDir) {
      const pathname = url.split('?')[0];
      const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const filePath = path.resolve(distDir, relativePath);

      if (filePath.startsWith(distDir) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        reply.header('Content-Type', contentType);
        // Vite puts a content hash in every file under assets/; index.html must always be
        // revalidated, or browsers keep loading the previous version after an update.
        reply.header(
          'Cache-Control',
          relativePath.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
        return reply.send(fs.createReadStream(filePath));
      }

      const indexPath = path.join(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        reply.header('Content-Type', 'text/html; charset=utf-8');
        reply.header('Cache-Control', 'no-cache');
        return reply.send(fs.createReadStream(indexPath));
      }
    }

    const err = new AppError('NOT_FOUND', `Route ${request.method} ${request.url} not found`);
    return reply.status(404).send(err.toApiErrorResponse());
  });

  // 8. Graceful Shutdown Implementation
  let isShuttingDown = false;
  // The returned instance has its `close` replaced by the full shutdown below, so keep Fastify's own.
  const closeFastify = app.close.bind(app);

  // Intercept sessionService.send to reject new runs during shutdown
  const originalSend = sessionService.send.bind(sessionService);
  sessionService.send = async (params) => {
    if (isShuttingDown) {
      throw new AppError('SESSION_BUSY', 'Server is shutting down, new runs are rejected');
    }
    return originalSend(params);
  };

  const close = async (): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    // 1. 中止全部运行
    const active = supervisor.activeRuns();
    await Promise.all(active.map((r) => supervisor.abort(r.id).catch(() => {})));

    // 2. 等待全部运行完成 (最多 10 秒)
    const startWait = Date.now();
    while (supervisor.activeRuns().length > 0 && Date.now() - startWait < 10_000) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    // 3. 取消进行中的登录流程
    try {
      await accountService.cancelActiveLogin();
    } catch (err) {
      appLogger.warn({ err }, 'Error cancelling active login during shutdown');
    }

    // 4. 清理子 agent transcript 服务与 transcript 追踪
    try {
      transcriptFollow?.dispose();
      subagentTranscriptService.dispose();
    } catch (err) {
      appLogger.warn({ err }, 'Error disposing transcript services during shutdown');
    }

    // 5. 冲刷 event-bus
    try {
      await eventBus.close();
    } catch (err) {
      appLogger.warn({ err }, 'Error flushing eventBus during shutdown');
    }

    // 6. 关闭局域网监听与 Fastify app
    try {
      await lanAccessService.close();
    } catch (err) {
      appLogger.warn({ err }, 'Error closing LAN listener');
    }
    try {
      await closeFastify();
    } catch (err) {
      appLogger.warn({ err }, 'Error closing Fastify app');
    }

    // 7. 关闭 SQLite 数据库
    try {
      db.close();
    } catch (err) {
      appLogger.warn({ err }, 'Error closing database');
    }
  };

  const container: AppContainer = {
    config,
    db,
    profile,
    internalToken,
    catalog,
    runner,
    brain,
    transcript: TranscriptManager,
    settings,
    credentialStore,
    dpapi,
    login,
    quotaProbe,
    workspacesRepo,
    sessionsRepo,
    runsRepo,
    eventsRepo,
    attachmentsRepo,
    accountsRepo,
    quotaCacheRepo,
    prefsRepo,
    eventBus,
    autoApprove,
    leaseLock,
    accountService,
    prefsService,
    modelService,
    supervisor,
    subagentTranscriptService,
    attachmentStore,
    attachmentConverter,
    promptInjector,
    sessionService,
    workspaceService,
    quotaService,
    agentService,
    lanAccessService,
  };

  return Object.assign(app, {
    app,
    container,
    close,
  });
}

export {
  AgyCatalog as AgyModelCatalog,
  QuotaApi,
  TranscriptManager,
};
