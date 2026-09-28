import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { ModelService } from '../../services/model.js';
import { AppError } from '../../utils/errors.js';

export interface ModelsRoutesOptions {
  modelService: ModelService;
}

const ListModelsQuerySchema = z.object({
  refresh: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((val) => val === true || val === 'true')
    .optional(),
});

export const modelsRoutes: FastifyPluginAsync<ModelsRoutesOptions> = async (app, options) => {
  const { modelService } = options;

  app.setErrorHandler((error, _request, reply) => {
    const appError = AppError.from(error);
    reply.status(appError.status).send(appError.toApiErrorResponse());
  });

  // GET /api/models
  app.get('/api/models', async (request, reply) => {
    const queryParse = ListModelsQuerySchema.safeParse(request.query);
    if (!queryParse.success) {
      const err = new AppError('BAD_REQUEST', 'Invalid query parameters');
      return reply.status(err.status).send(err.toApiErrorResponse());
    }

    try {
      const models = await modelService.listModels({ refresh: queryParse.data.refresh });
      return reply.status(200).send(models);
    } catch (err) {
      const appError = AppError.from(err);
      return reply.status(appError.status).send(appError.toApiErrorResponse());
    }
  });
};
