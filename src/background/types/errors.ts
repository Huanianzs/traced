import { ErrorCode, ErrorPayload } from './protocol';

export class AppError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public retryable: boolean = false
  ) {
    super(message);
    this.name = 'AppError';
  }

  toPayload(): ErrorPayload {
    return {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };
  }
}

export function normalizeError(err: unknown): ErrorPayload {
  if (err instanceof AppError) {
    return err.toPayload();
  }
  if (err instanceof Error) {
    return {
      code: 'INTERNAL_ERROR',
      message: err.message,
      retryable: false,
    };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: String(err),
    retryable: false,
  };
}
