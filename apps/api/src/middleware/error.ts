import { Prisma } from '@prisma/client';
import { ERROR_MESSAGES, type ApiFailure } from '@bday/shared';
import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { env } from '../config/env';
import { AppError, isAppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { isRetryableTransactionError } from '../lib/prisma';
import { toFieldErrors } from './validate';

/** 404 for unmatched routes, so the client still gets the standard envelope. */
export function notFoundHandler(req: Request, res: Response): void {
  const body: ApiFailure = {
    success: false,
    code: 'NOT_FOUND',
    message: `No route matches ${req.method} ${req.path}`,
    requestId: String(req.id),
  };
  res.status(404).json(body);
}

/**
 * Terminal error handler.
 *
 * Known failures are mapped to their code and user-safe message. Anything
 * unrecognised is logged in full and answered with a generic INTERNAL_ERROR —
 * stack traces, SQL fragments and provider payloads must never reach a client.
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const mapped = mapError(error);

  const logPayload = {
    err: error,
    requestId: req.id,
    userId: req.auth?.userId,
    method: req.method,
    path: req.originalUrl,
    code: mapped.code,
    status: mapped.status,
    context: isAppError(error) ? error.context : undefined,
  };

  if (mapped.status >= 500) {
    logger.error(logPayload, 'request failed');
  } else if (mapped.status === 429) {
    logger.warn(logPayload, 'request throttled');
  } else {
    logger.info(logPayload, 'request rejected');
  }

  const body: ApiFailure = {
    success: false,
    code: mapped.code,
    message: mapped.message,
    requestId: String(req.id),
  };
  if (mapped.fieldErrors) body.errors = mapped.fieldErrors;

  res.status(mapped.status).json(body);
}

interface MappedError {
  status: number;
  code: ApiFailure['code'];
  message: string;
  fieldErrors?: Record<string, string[]>;
}

function mapError(error: unknown): MappedError {
  if (isAppError(error)) {
    return {
      status: error.status,
      code: error.code,
      message: error.message,
      fieldErrors: error.fieldErrors,
    };
  }

  // A Zod error that escaped the validate middleware (e.g. thrown in a service
  // while parsing a provider response).
  if (error instanceof ZodError) {
    return {
      status: 422,
      code: 'VALIDATION_ERROR',
      message: ERROR_MESSAGES.VALIDATION_ERROR,
      fieldErrors: toFieldErrors(error),
    };
  }

  if (error instanceof MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return { status: 413, code: 'PAYLOAD_TOO_LARGE', message: ERROR_MESSAGES.PAYLOAD_TOO_LARGE };
    }
    return { status: 400, code: 'VALIDATION_ERROR', message: 'That upload could not be accepted.' };
  }

  if (isRetryableTransactionError(error)) {
    // Retries were exhausted; the client can safely try again.
    return { status: 409, code: 'CONFLICT', message: 'Too many people did that at once. Please try again.' };
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002': {
        const target = (error.meta as { target?: string[] | string } | undefined)?.target;
        const fields = Array.isArray(target) ? target.join(', ') : target;
        return {
          status: 409,
          code: 'CONFLICT',
          message: fields
            ? `That ${humaniseField(fields)} is already in use.`
            : ERROR_MESSAGES.CONFLICT,
        };
      }
      case 'P2025':
        return { status: 404, code: 'NOT_FOUND', message: ERROR_MESSAGES.NOT_FOUND };
      case 'P2003':
        return {
          status: 409,
          code: 'CONFLICT',
          message: 'That item is referenced by something else and cannot be changed.',
        };
      case 'P2034':
        return {
          status: 409,
          code: 'CONFLICT',
          message: 'Too many people did that at once. Please try again.',
        };
      default:
        break;
    }
  }

  if (error instanceof Prisma.PrismaClientValidationError) {
    return { status: 500, code: 'INTERNAL_ERROR', message: ERROR_MESSAGES.INTERNAL_ERROR };
  }

  if (error instanceof Prisma.PrismaClientInitializationError) {
    return {
      status: 503,
      code: 'INTERNAL_ERROR',
      message: 'We are having trouble reaching the database. Please try again shortly.',
    };
  }

  // Body-parser JSON syntax errors surface as SyntaxError with a `body` prop.
  if (
    error instanceof SyntaxError &&
    'body' in error &&
    (error as unknown as { status?: number }).status === 400
  ) {
    return { status: 400, code: 'VALIDATION_ERROR', message: 'The request body is not valid JSON.' };
  }

  return {
    status: 500,
    code: 'INTERNAL_ERROR',
    // In development the real message is far more useful than the polite one.
    message: env.isProduction
      ? ERROR_MESSAGES.INTERNAL_ERROR
      : `${ERROR_MESSAGES.INTERNAL_ERROR} (${(error as Error)?.message ?? 'unknown'})`,
  };
}

function humaniseField(field: string): string {
  return field
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase();
}

/** Last-resort guards so an unhandled rejection cannot leave the process wedged. */
export function installProcessGuards(): void {
  process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: reason }, 'unhandled promise rejection');
  });
  process.on('uncaughtException', (error) => {
    logger.fatal({ err: error }, 'uncaught exception — shutting down');
    // The process state is no longer trustworthy; let the supervisor restart it.
    process.exit(1);
  });
}

export { AppError };
