import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { PrefsService } from '../../services/prefs.js';
import { AppError } from '../../utils/errors.js';

export interface PrefsRoutesOptions {
  prefsService: PrefsService;
}

const EffortEnum = z.enum(['low', 'medium', 'high', 'max']);

const UpdatePrefsBodySchema = z.object({
  defaultModel: z.string().nullable().optional(),
  defaultEffort: EffortEnum.nullable().optional(),
  defaultMode: z.string().nullable().optional(),
  defaultWorkspaceId: z.string().nullable().optional(),
  showThinking: z.boolean().optional(),
  checkpointsEnabled: z.boolean().optional(),
  maxConcurrentRuns: z.number().int().positive().optional(),
  stallTimeoutSeconds: z.number().int().positive().optional(),
});

export const prefsRoutes: FastifyPluginAsync<PrefsRoutesOptions> = async (app, options) => {
  const { prefsService } = options;

  app.setErrorHandler((error, _request, reply) => {
    const appError = AppError.from(error);
    reply.status(appError.status).send(appError.toApiErrorResponse());
  });

  // GET /api/prefs
  app.get('/api/prefs', async (_request, reply) => {
    try {
      const prefs = await prefsService.getPrefs();
      return reply.status(200).send(prefs);
    } catch (err) {
      const appError = AppError.from(err);
      return reply.status(appError.status).send(appError.toApiErrorResponse());
    }
  });

  // PUT /api/prefs
  app.put('/api/prefs', async (request, reply) => {
    const parseResult = UpdatePrefsBodySchema.safeParse(request.body);
    if (!parseResult.success) {
      const err = new AppError(
        'BAD_REQUEST',
        parseResult.error.issues[0]?.message ?? 'Invalid request body',
      );
      return reply.status(err.status).send(err.toApiErrorResponse());
    }

    try {
      const updated = await prefsService.updatePrefs(parseResult.data);
      return reply.status(200).send(updated);
    } catch (err) {
      const appError = AppError.from(err);
      return reply.status(appError.status).send(appError.toApiErrorResponse());
    }
  });
};
