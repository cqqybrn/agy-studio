import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AccountService } from '../../services/account/account.js';
import { AppError } from '../../utils/errors.js';

export interface AccountsRoutesOptions {
  accountService: AccountService;
}

const SaveAccountSchema = z.object({
  name: z.string().min(1, 'Account name is required'),
  note: z.string().optional(),
  type: z.enum(['oauth', 'apikey']).optional(),
  apiKey: z.string().optional(),
});

const SwitchAccountSchema = z.object({
  name: z.string().min(1, 'Account name is required'),
});

export const accountsRoutes: FastifyPluginAsync<AccountsRoutesOptions> = async (
  app,
  options,
) => {
  const { accountService } = options;

  app.setErrorHandler((error, _request, reply) => {
    const appError = AppError.from(error);
    reply.status(appError.status).send(appError.toApiErrorResponse());
  });

  // GET /api/accounts
  app.get('/api/accounts', async () => {
    const [accounts, whoami] = await Promise.all([
      accountService.listAccounts(),
      accountService.whoami(),
    ]);
    return { accounts, whoami };
  });

  // POST /api/accounts/save
  app.post('/api/accounts/save', async (request, reply) => {
    const parsed = SaveAccountSchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new AppError(
        'BAD_REQUEST',
        parsed.error.issues[0]?.message ?? 'Invalid request body',
      );
      return reply.status(err.status).send(err.toApiErrorResponse());
    }

    try {
      const account = await accountService.saveAccount(parsed.data);
      return reply.status(200).send(account);
    } catch (err) {
      const appError = AppError.from(err);
      return reply.status(appError.status).send(appError.toApiErrorResponse());
    }
  });

  // POST /api/accounts/switch
  app.post('/api/accounts/switch', async (request, reply) => {
    const parsed = SwitchAccountSchema.safeParse(request.body);
    if (!parsed.success) {
      const err = new AppError(
        'BAD_REQUEST',
        parsed.error.issues[0]?.message ?? 'Invalid request body',
      );
      return reply.status(err.status).send(err.toApiErrorResponse());
    }

    try {
      const result = await accountService.switchAccount(parsed.data.name);
      return reply.status(200).send(result);
    } catch (err) {
      const appError = AppError.from(err);
      return reply.status(appError.status).send(appError.toApiErrorResponse());
    }
  });

  // DELETE /api/accounts/:name
  app.delete<{ Params: { name: string } }>(
    '/api/accounts/:name',
    async (request, reply) => {
      const { name } = request.params;
      if (!name) {
        const err = new AppError('BAD_REQUEST', 'Account name is required');
        return reply.status(err.status).send(err.toApiErrorResponse());
      }

      try {
        await accountService.deleteAccount(name);
        return reply.status(200).send({ ok: true });
      } catch (err) {
        const appError = AppError.from(err);
        return reply.status(appError.status).send(appError.toApiErrorResponse());
      }
    },
  );
};
