import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { QuotaService } from '../../services/quota.js';
import { AppError } from '../../utils/errors.js';

export interface QuotaRoutesOptions {
  quotaService: QuotaService;
}

const GetQuotaQuerySchema = z.object({
  account: z.string().optional(),
  refresh: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((val) => val === true || val === 'true')
    .optional(),
});

export const quotaRoutes: FastifyPluginAsync<QuotaRoutesOptions> = async (app, options) => {
  const { quotaService } = options;

  app.setErrorHandler((error, _request, reply) => {
    const appError = AppError.from(error);
    reply.status(appError.status).send(appError.toApiErrorResponse());
  });

  // GET /api/quota
  app.get('/api/quota', async (request, reply) => {
    const queryParse = GetQuotaQuerySchema.safeParse(request.query);
    if (!queryParse.success) {
      const err = new AppError('BAD_REQUEST', 'Invalid query parameters');
      return reply.status(err.status).send(err.toApiErrorResponse());
    }

    try {
      const snapshot = await quotaService.get(queryParse.data.account, queryParse.data.refresh);
      return reply.status(200).send(snapshot);
    } catch (err) {
      const appError = AppError.from(err);
      return reply.status(appError.status).send(appError.toApiErrorResponse());
    }
  });
};
