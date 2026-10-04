import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { sessionsRoutes } from '../../src/routes/http/sessions.routes.js';
import { AppError } from '../../src/utils/errors.js';

describe('POST /api/sessions/:sessionId/messages/:messageId/rewind', () => {
  let app: FastifyInstance;
  let rewindToMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    rewindToMessage = vi.fn().mockResolvedValue(undefined);
    app = Fastify();
    await app.register(sessionsRoutes, { sessionService: { rewindToMessage } as never });
  });

  afterEach(async () => {
    await app.close();
  });

  const post = () =>
    app.inject({ method: 'POST', url: '/api/sessions/sess-1/messages/msg-2/rewind' });

  it('rewinds and returns ok', async () => {
    const res = await post();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(rewindToMessage).toHaveBeenCalledWith('sess-1', 'msg-2');
  });

  it('maps a running session to 409 SESSION_BUSY', async () => {
    rewindToMessage.mockRejectedValue(new AppError('SESSION_BUSY', 'running'));
    const res = await post();
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('SESSION_BUSY');
  });

  it('maps an unknown message to 404', async () => {
    rewindToMessage.mockRejectedValue(new AppError('NOT_FOUND', 'no such message'));
    const res = await post();
    expect(res.statusCode).toBe(404);
  });
});
