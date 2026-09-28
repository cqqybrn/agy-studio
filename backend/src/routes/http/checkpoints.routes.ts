import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { CheckpointService } from '../../services/checkpoint.js';
import { AppError } from '../../utils/errors.js';

export interface CheckpointsRoutesOptions {
  checkpointService: CheckpointService;
}

const SessionParamsSchema = z.object({
  sessionId: z.string().min(1, 'Session ID is required'),
});

const CheckpointParamsSchema = z.object({
  checkpointId: z.string().min(1, 'Checkpoint ID is required'),
});

export const checkpointsRoutes: FastifyPluginAsync<CheckpointsRoutesOptions> = async (
  app,
  options,
) => {
  const { checkpointService } = options;

  app.setErrorHandler((error, _request, reply) => {
    const appError = AppError.from(error);
    reply.status(appError.status).send(appError.toApiErrorResponse());
  });

  // GET /api/sessions/:sessionId/checkpoints
  app.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/checkpoints',
    async (request, reply) => {
      const parseResult = SessionParamsSchema.safeParse(request.params);
      if (!parseResult.success) {
        const err = new AppError(
          'BAD_REQUEST',
          parseResult.error.issues[0]?.message ?? 'Invalid session ID',
        );
        return reply.status(err.status).send(err.toApiErrorResponse());
      }

      try {
        const checkpoints = await checkpointService.listBySessionId(
          parseResult.data.sessionId,
        );
        return checkpoints;
      } catch (err) {
        const appError = AppError.from(err);
        return reply.status(appError.status).send(appError.toApiErrorResponse());
      }
    },
  );

  // GET /api/checkpoints/:checkpointId/diff
  app.get<{ Params: { checkpointId: string } }>(
    '/api/checkpoints/:checkpointId/diff',
    async (request, reply) => {
      const parseResult = CheckpointParamsSchema.safeParse(request.params);
      if (!parseResult.success) {
        const err = new AppError(
          'BAD_REQUEST',
          parseResult.error.issues[0]?.message ?? 'Invalid checkpoint ID',
        );
        return reply.status(err.status).send(err.toApiErrorResponse());
      }

      try {
        const diff = await checkpointService.diff(parseResult.data.checkpointId);
        return diff;
      } catch (err) {
        const appError = AppError.from(err);
        return reply.status(appError.status).send(appError.toApiErrorResponse());
      }
    },
  );

  // POST /api/checkpoints/:checkpointId/rollback
  app.post<{ Params: { checkpointId: string } }>(
    '/api/checkpoints/:checkpointId/rollback',
    async (request, reply) => {
      const parseResult = CheckpointParamsSchema.safeParse(request.params);
      if (!parseResult.success) {
        const err = new AppError(
          'BAD_REQUEST',
          parseResult.error.issues[0]?.message ?? 'Invalid checkpoint ID',
        );
        return reply.status(err.status).send(err.toApiErrorResponse());
      }

      try {
        const result = await checkpointService.rollback(
          parseResult.data.checkpointId,
        );
        return result;
      } catch (err) {
        const appError = AppError.from(err);
        return reply.status(appError.status).send(appError.toApiErrorResponse());
      }
    },
  );
};
