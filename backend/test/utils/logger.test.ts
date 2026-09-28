import { describe, expect, it } from 'vitest';
import { createLogger, redactSensitive } from '../../src/utils/logger.js';

describe('utils/logger', () => {
  it('redacts sensitive fields in nested objects and arrays', () => {
    const sensitiveData = {
      userToken: 'secret_token_123',
      apiKey: 'xyz-999',
      client_secret: 'topsecret',
      auth: {
        password: 'my-password',
        authorization: 'Bearer xxx',
        credentialList: ['cred1', 'cred2'],
      },
      headers: {
        cookie: 'session_id=123',
        normalHeader: 'keep_me',
      },
      safeArray: [
        { apiKey: 'leak1' },
        { normal: 'value' },
      ],
      publicName: 'john',
    };

    const redacted = redactSensitive(sensitiveData) as Record<string, unknown>;

    expect(redacted.userToken).toBe('[REDACTED]');
    expect(redacted.apiKey).toBe('[REDACTED]');
    expect(redacted.client_secret).toBe('[REDACTED]');
    expect(redacted.publicName).toBe('john');

    const auth = redacted.auth as Record<string, unknown>;
    expect(auth.password).toBe('[REDACTED]');
    expect(auth.authorization).toBe('[REDACTED]');
    expect(auth.credentialList).toBe('[REDACTED]');

    const headers = redacted.headers as Record<string, unknown>;
    expect(headers.cookie).toBe('[REDACTED]');
    expect(headers.normalHeader).toBe('keep_me');

    const safeArray = redacted.safeArray as Array<Record<string, unknown>>;
    expect(safeArray[0].apiKey).toBe('[REDACTED]');
    expect(safeArray[1].normal).toBe('value');
  });

  it('handles circular references without blowing up', () => {
    const circular: Record<string, unknown> = {
      name: 'root',
      token: 'secret',
    };
    circular.self = circular;

    const sanitized = redactSensitive(circular) as Record<string, unknown>;
    expect(sanitized.token).toBe('[REDACTED]');
    expect(sanitized.name).toBe('root');
    expect(sanitized.self).toBe('[Circular]');
  });

  it('redacts logs when output through pino destination stream', async () => {
    const logs: string[] = [];
    const destination = {
      write(chunk: string) {
        logs.push(chunk);
      },
    };

    const testLogger = createLogger({}, destination as unknown as import('pino').DestinationStream);

    testLogger.info(
      {
        apiKey: '12345',
        accessToken: 'abc',
        status: 'ok',
      },
      'Test log line',
    );

    expect(logs.length).toBe(1);
    const parsed = JSON.parse(logs[0]);
    expect(parsed.apiKey).toBe('[REDACTED]');
    expect(parsed.accessToken).toBe('[REDACTED]');
    expect(parsed.status).toBe('ok');
    expect(parsed.msg).toBe('Test log line');
  });
});
