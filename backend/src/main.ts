import http from 'node:http';
import process from 'node:process';
import { buildApp } from './app.js';
import { loadConfig } from './utils/config.js';
import { logger } from './utils/logger.js';

export async function bootstrap(): Promise<void> {
  // Node 的 fetch 默认不读取 HTTPS_PROXY / HTTP_PROXY；额度接口在需要代理的网络下会一直超时
  (http as typeof http & { setGlobalProxyFromEnv?: () => void }).setGlobalProxyFromEnv?.();
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

  // 4. 监听 SIGINT / SIGTERM 信号并执行优雅关闭
  let shuttingDown = false;
  const handleSignal = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, `Received ${signal}, commencing graceful shutdown...`);
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
  bootstrap().catch((err) => {
    logger.fatal({ err }, 'Failed to start AGY Studio backend');
    process.exit(1);
  });
}
