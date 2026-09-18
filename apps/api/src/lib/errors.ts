import { ERROR_MESSAGES, ERROR_STATUS, type ErrorCode } from '@bday/shared';

/**
 * The only error type the HTTP layer knows how to translate.
 *
 * Anything else that reaches the error middleware is treated as an unexpected
 * fault: it is logged with its stack and reported to the client as a generic
 * INTERNAL_ERROR, so internals never leak into a response body.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly fieldErrors?: Record<string, string[]>;
  /** Extra context for the log line only — never serialised to the client. */
  readonly context?: Record<string, unknown>;
  readonly expose = true;

  constructor(
    code: ErrorCode,
    options: {
      message?: string;
      status?: number;
      fieldErrors?: Record<string, string[]>;
      context?: Record<string, unknown>;
      cause?: unknown;
    } = {},
  ) {
    super(options.message ?? ERROR_MESSAGES[code], { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = options.status ?? ERROR_STATUS[code];
    this.fieldErrors = options.fieldErrors;
    this.context = options.context;
    Error.captureStackTrace?.(this, AppError);
  }
}

/** Shorthand builders for the codes used most often. */
export const errors = {
  unauthenticated: (message?: string) => new AppError('UNAUTHENTICATED', { message }),
  forbidden: (message?: string) => new AppError('FORBIDDEN', { message }),
  notFound: (what?: string) =>
    new AppError('NOT_FOUND', { message: what ? `${what} could not be found.` : undefined }),
  conflict: (message?: string) => new AppError('CONFLICT', { message }),
  validation: (fieldErrors: Record<string, string[]>, message?: string) =>
    new AppError('VALIDATION_ERROR', { fieldErrors, message }),
  internal: (cause?: unknown, context?: Record<string, unknown>) =>
    new AppError('INTERNAL_ERROR', { cause, context }),
};

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** True for Prisma's unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/** True for Prisma's "record not found" on update/delete. */
export function isRecordNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2025'
  );
}
