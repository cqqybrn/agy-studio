import type { ErrorCode, ApiErrorBody, ApiErrorResponse } from '@agy-studio/contracts';
import { ERROR_HTTP_STATUS } from '@agy-studio/contracts';

export interface AppErrorOptions {
  retryable?: boolean;
  details?: Record<string, unknown>;
  cause?: unknown;
}

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
  readonly status: number;

  constructor(code: ErrorCode, message: string, options?: AppErrorOptions) {
    super(message, { cause: options?.cause });
    this.name = 'AppError';
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.details = options?.details;
    this.status = ERROR_HTTP_STATUS[code] ?? 500;
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toApiError(): ApiErrorBody {
    const body: ApiErrorBody = {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
    if (this.details !== undefined) {
      body.details = this.details;
    }
    return body;
  }

  toApiErrorResponse(): ApiErrorResponse {
    return {
      error: this.toApiError(),
    };
  }

  static from(err: unknown): AppError {
    if (err instanceof AppError) {
      return err;
    }
    if (err instanceof Error) {
      return new AppError('INTERNAL', err.message, { cause: err });
    }
    return new AppError('INTERNAL', String(err));
  }
}
