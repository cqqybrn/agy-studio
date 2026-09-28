import Fastify from 'fastify';
import type { Session } from '@agy-studio/contracts';

export type CurrentSession = Session | null;

export function buildApp() {
  const app = Fastify({
    logger: false,
  });

  app.get('/api/health', async () => {
    return { ok: true };
  });

  return app;
}
