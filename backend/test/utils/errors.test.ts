import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/utils/errors.js';

describe('utils/errors', () => {
  it('instantiates AppError with default retryable=false and mapped status', () => {
    const err = new AppError('NOT_FOUND', 'Session not found');
    expect(err.name).toBe('AppError');
    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Session not found');
    expect(err.retryable).toBe(false);
    expect(err.status).toBe(404);
  });

  it('supports retryable flag and details payload', () => {
    const details = { runId: 'run-1', reason: 'locked' };
    const err = new AppError('SESSION_BUSY', 'Session is currently busy', {
      retryable: true,
      details,
    });
    expect(err.retryable).toBe(true);
    expect(err.status).toBe(409);
    expect(err.details).toEqual(details);

    const apiBody = err.toApiError();
    expect(apiBody).toEqual({
      code: 'SESSION_BUSY',
      message: 'Session is currently busy',
      retryable: true,
      details,
    });

    const response = err.toApiErrorResponse();
    expect(response).toEqual({
      error: apiBody,
    });
  });

  it('converts standard errors via AppError.from', () => {
    const standardErr = new Error('boom');
    const appErr = AppError.from(standardErr);
    expect(appErr).toBeInstanceOf(AppError);
    expect(appErr.code).toBe('INTERNAL');
    expect(appErr.message).toBe('boom');
    expect(appErr.cause).toBe(standardErr);

    const existing = new AppError('BAD_REQUEST', 'bad input');
    expect(AppError.from(existing)).toBe(existing);
  });
});
