import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { LanAccessService } from '../../services/lan-access.js';
import { AppError } from '../../utils/errors.js';
import { isLanRequest } from '../../utils/lan-listener.js';

export interface LanAccessRoutesOptions {
  lanAccessService: LanAccessService;
}

const SetEnabledSchema = z.object({ enabled: z.boolean() });

export const lanAccessRoutes: FastifyPluginAsync<LanAccessRoutesOptions> = async (app, options) => {
  const { lanAccessService } = options;

  app.setErrorHandler((error, _request, reply) => {
    const appError = AppError.from(error);
    reply.status(appError.status).send(appError.toApiErrorResponse());
  });

  const fromThisComputer = (request: FastifyRequest) => !isLanRequest(request.raw);

  /** Only this computer may switch LAN access or hand out a new code (a phone could lock itself in or out). */
  const requireThisComputer = (request: FastifyRequest) => {
    if (!fromThisComputer(request)) {
      throw new AppError('UNAUTHORIZED', '只能在运行 AGY Studio 的这台电脑上修改局域网访问设置');
    }
  };

  app.get('/api/lan-access', async (request) => lanAccessService.status(fromThisComputer(request)));

  app.put('/api/lan-access', async (request) => {
    requireThisComputer(request);
    const parsed = SetEnabledSchema.safeParse(request.body);
    if (!parsed.success) throw new AppError('BAD_REQUEST', 'enabled must be a boolean');
    await lanAccessService.setEnabled(parsed.data.enabled);
    return lanAccessService.status(true);
  });

  app.post('/api/lan-access/regenerate', async (request) => {
    requireThisComputer(request);
    await lanAccessService.regenerateToken();
    return lanAccessService.status(true);
  });
};
