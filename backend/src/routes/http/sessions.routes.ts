import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { SessionService } from '../../services/session.js';
import { AppError } from '../../utils/errors.js';

export interface SessionsRoutesOptions {
  sessionService: SessionService;
}

const EffortEnum = z.enum(['low', 'medium', 'high', 'max']);

const CreateSessionSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  accountName: z.string().optional(),
  title: z.string().optional(),
  model: z.string().optional(),
  effort: EffortEnum.optional(),
  mode: z.string().optional(),
});

const UpdateSessionSchema = z.object({
  title: z.string().trim().min(1, 'Title must not be empty').max(200).optional(),
  pinned: z.boolean().optional(),
  model: z.string().nullable().optional(),
  effort: EffortEnum.nullable().optional(),
  mode: z.string().nullable().optional(),
});

const ListSessionsQuerySchema = z.object({
  workspaceId: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().optional(),
});

const DeleteSessionQuerySchema = z.object({
  purge: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .transform((val) => val === true || val === 'true')
    .optional(),
});

const ImportSessionsSchema = z.object({
  workspaceId: z.string().min(1, 'workspaceId is required'),
  agyConversationIds: z.array(z.string()).optional(),
});

const ListEventsQuerySchema = z.object({
  afterSeq: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().positive().optional(),
});

export const sessionsRoutes: FastifyPluginAsync<SessionsRoutesOptions> = async (
  app,
  options,
) => {
  const { sessionService } = options;

  // 错误处理：映射为 ApiErrorResponse
  app.setErrorHandler((error, _request, reply) => {
    const appError = AppError.from(error);
    reply.status(appError.status).send(appError.toApiErrorResponse());
  });

  // GET /api/sessions
  app.get('/api/sessions', async (request, reply) => {
    const parseResult = ListSessionsQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      const err = new AppError('BAD_REQUEST', parseResult.error.issues[0]?.message ?? 'Invalid query parameters');
      return reply.status(err.status).send(err.toApiErrorResponse());
    }

    try {
      const page = await sessionService.listSessions(parseResult.data);
      return page;
    } catch (err) {
      const appError = AppError.from(err);
      return reply.status(appError.status).send(appError.toApiErrorResponse());
    }
  });

  // POST /api/sessions
  app.post('/api/sessions', async (request, reply) => {
    const parseResult = CreateSessionSchema.safeParse(request.body);
    if (!parseResult.success) {
      const err = new AppError('BAD_REQUEST', parseResult.error.issues[0]?.message ?? 'Invalid request body');
      return reply.status(err.status).send(err.toApiErrorResponse());
    }

    try {
      const session = await sessionService.createSession(parseResult.data);
      return reply.status(201).send(session);
    } catch (err) {
      const appError = AppError.from(err);
      return reply.status(appError.status).send(appError.toApiErrorResponse());
    }
  });

  // GET /api/sessions/:sessionId
  app.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId',
    async (request, reply) => {
      const { sessionId } = request.params;
      try {
        const session = await sessionService.getSession(sessionId);
        return session;
      } catch (err) {
        const appError = AppError.from(err);
        return reply.status(appError.status).send(appError.toApiErrorResponse());
      }
    },
  );

  // PATCH /api/sessions/:sessionId
  app.patch<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId',
    async (request, reply) => {
      const { sessionId } = request.params;
      const parseResult = UpdateSessionSchema.safeParse(request.body);
      if (!parseResult.success) {
        const err = new AppError('BAD_REQUEST', parseResult.error.issues[0]?.message ?? 'Invalid request body');
        return reply.status(err.status).send(err.toApiErrorResponse());
      }

      try {
        const session = await sessionService.updateSession(sessionId, parseResult.data);
        return session;
      } catch (err) {
        const appError = AppError.from(err);
        return reply.status(appError.status).send(appError.toApiErrorResponse());
      }
    },
  );

  // DELETE /api/sessions/:sessionId
  app.delete<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId',
    async (request, reply) => {
      const { sessionId } = request.params;
      const parseResult = DeleteSessionQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        const err = new AppError('BAD_REQUEST', parseResult.error.issues[0]?.message ?? 'Invalid query parameters');
        return reply.status(err.status).send(err.toApiErrorResponse());
      }

      const purge = parseResult.data.purge ?? false;
      try {
        await sessionService.deleteSession(sessionId, purge);
        return { ok: true };
      } catch (err) {
        const appError = AppError.from(err);
        return reply.status(appError.status).send(appError.toApiErrorResponse());
      }
    },
  );

  // POST /api/sessions/:sessionId/messages/:messageId/rewind
  app.post<{ Params: { sessionId: string; messageId: string } }>(
    '/api/sessions/:sessionId/messages/:messageId/rewind',
    async (request, reply) => {
      const { sessionId, messageId } = request.params;
      try {
        await sessionService.rewindToMessage(sessionId, messageId);
        return { ok: true };
      } catch (err) {
        const appError = AppError.from(err);
        return reply.status(appError.status).send(appError.toApiErrorResponse());
      }
    },
  );

  // POST /api/sessions/import
  app.post('/api/sessions/import', async (request, reply) => {
    const parseResult = ImportSessionsSchema.safeParse(request.body);
    if (!parseResult.success) {
      const err = new AppError('BAD_REQUEST', parseResult.error.issues[0]?.message ?? 'Invalid request body');
      return reply.status(err.status).send(err.toApiErrorResponse());
    }

    try {
      const result = await sessionService.importSessions(parseResult.data);
      return result;
    } catch (err) {
      const appError = AppError.from(err);
      return reply.status(appError.status).send(appError.toApiErrorResponse());
    }
  });

  // GET /api/sessions/:sessionId/events
  app.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/events',
    async (request, reply) => {
      const { sessionId } = request.params;
      const parseResult = ListEventsQuerySchema.safeParse(request.query);
      if (!parseResult.success) {
        const err = new AppError('BAD_REQUEST', parseResult.error.issues[0]?.message ?? 'Invalid query parameters');
        return reply.status(err.status).send(err.toApiErrorResponse());
      }

      try {
        const result = await sessionService.listEvents(
          sessionId,
          parseResult.data.afterSeq,
          parseResult.data.limit,
        );
        return result;
      } catch (err) {
        const appError = AppError.from(err);
        return reply.status(appError.status).send(appError.toApiErrorResponse());
      }
    },
  );

  // GET /api/sessions/:sessionId/runs
  app.get<{ Params: { sessionId: string } }>(
    '/api/sessions/:sessionId/runs',
    async (request, reply) => {
      const { sessionId } = request.params;
      try {
        const runs = await sessionService.listRuns(sessionId);
        return runs;
      } catch (err) {
        const appError = AppError.from(err);
        return reply.status(appError.status).send(appError.toApiErrorResponse());
      }
    },
  );
};
