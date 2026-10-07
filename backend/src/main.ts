import http from 'node:http';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { buildApp } from './app.js';
import {
  AgyUpdateScheduler,
  disableAgyBackgroundUpdater,
  runAgyUpdate,
} from './integrations/agy/updater.js';
import { loadConfig } from './utils/config.js';
import { logger } from './utils/logger.js';
import { applySystemProxyToEnv } from './utils/proxy.js';

function hasEnvProxy(): boolean {
  return Boolean(
    process.env.HTTPS_PROXY ||
      process.env.https_proxy ||
      process.env.HTTP_PROXY ||
      process.env.http_proxy,
  );
}

/** Node 的 fetch 默认不读 HTTPS_PROXY；额度接口在需要代理的网络下会一直超时。 */
function reexecWithEnvProxyIfNeeded(): void {
  if (!hasEnvProxy() || process.env.NODE_USE_ENV_PROXY === '1') return;
  logger.info('Relaunching with NODE_USE_ENV_PROXY=1 so outbound fetch uses HTTPS_PROXY');
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(r.status ?? 1);
}

export async function bootstrap(): Promise<void> {
  (http as typeof http & { setGlobalProxyFromEnv?: () => void }).setGlobalProxyFromEnv?.();
  // Before any agy process starts: agy's own updater flashes a console window (see updater.ts).
  const studioRunsAgyUpdates = disableAgyBackgroundUpdater();
  const config = loadConfig();
  const { app, container, close } = buildApp({ config });

  // 1. 清理孤儿运行
  try {
    const reaped = await container.supervisor.reapOrphans();
    if (reaped > 0) {
      logger.info({ reaped }, 'Reaped orphaned runs from previous shutdown');
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to reap orphaned runs');
  }

  // 2. 确认 internal.token
  if (container.internalToken) {
    logger.debug('Internal token verified');
  }

  // 3. 监听指定 host/port
  await app.listen({ host: config.host, port: config.port });
  logger.info(
    { host: config.host, port: config.port },
    `AGY Studio listening on http://${config.host}:${config.port}`,
  );

  // 4. 替代 agy 自带的后台更新：启动后与每隔几小时，在没有运行时静默执行 agy update
  const updateScheduler = studioRunsAgyUpdates
    ? new AgyUpdateScheduler({
        update: () => runAgyUpdate(container.profile, config.agyBin),
        isBusy: () => container.supervisor.hasActiveRuns(),
        logger,
      })
    : null;
  updateScheduler?.start();

  // 5. 监听 SIGINT / SIGTERM 信号并执行优雅关闭
  let shuttingDown = false;
  const handleSignal = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, `Received ${signal}, commencing graceful shutdown...`);
    updateScheduler?.stop();
    try {
      await close();
      logger.info('Graceful shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during graceful shutdown');
      process.exit(1);
    }
  };

  process.once('SIGINT', () => {
    void handleSignal('SIGINT');
  });
  process.once('SIGTERM', () => {
    void handleSignal('SIGTERM');
  });
}

// Automatically start if executed as entrypoint
if (process.argv[1] && (process.argv[1].endsWith('main.ts') || process.argv[1].endsWith('main.js'))) {
  // Must run before the re-exec so the child (and every agy process we spawn) inherits the proxy.
  applySystemProxyToEnv()
    .catch((err) => {
      logger.warn({ err }, 'System proxy detection failed, continuing without it');
    })
    .then(() => {
      reexecWithEnvProxyIfNeeded();
      return bootstrap();
    })
    .catch((err) => {
      logger.fatal({ err }, 'Failed to start AGY Studio backend');
      process.exit(1);
    });
}
