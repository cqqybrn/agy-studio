import pino, { type DestinationStream, type Logger, type LoggerOptions } from 'pino';

export const SENSITIVE_KEY_REGEX = /(token|secret|password|credential|authorization|cookie|apikey)/i;

export function redactSensitive<T>(input: T, seen = new WeakSet()): T {
  if (input === null || typeof input !== 'object') {
    return input;
  }
  if (seen.has(input)) {
    return '[Circular]' as unknown as T;
  }
  seen.add(input);

  if (Array.isArray(input)) {
    return input.map((item) => redactSensitive(item, seen)) as unknown as T;
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_KEY_REGEX.test(key)) {
      output[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      output[key] = redactSensitive(value, seen);
    } else {
      output[key] = value;
    }
  }
  return output as T;
}

export function createLogger(options?: LoggerOptions, destination?: DestinationStream): Logger {
  const mergedOptions: LoggerOptions = {
    ...options,
    formatters: {
      ...options?.formatters,
      log(object: Record<string, unknown>) {
        const sanitized = redactSensitive(object);
        if (options?.formatters?.log) {
          return options.formatters.log(sanitized);
        }
        return sanitized;
      },
    },
  };

  return destination ? pino(mergedOptions, destination) : pino(mergedOptions);
}

export const logger: Logger = createLogger();
