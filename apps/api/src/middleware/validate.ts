import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { AppError } from '../lib/errors';

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/** Turns a ZodError into the `errors` map of the failure envelope (spec §51). */
export function toFieldErrors(error: ZodError, prefix?: string): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.length > 0 ? issue.path.join('.') : '_';
    const key = prefix ? `${prefix}.${path}` : path;
    (fieldErrors[key] ??= []).push(issue.message);
  }
  return fieldErrors;
}

/**
 * Validates and *replaces* the request payloads.
 *
 * Parsed output lands on `req.valid`, and handlers read only from there. That
 * matters for more than tidiness: Zod strips unknown keys, so a client cannot
 * smuggle `role: "ADMIN"` or `isPremium: true` into an update by adding it to
 * the JSON body.
 */
export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    req.valid ??= {};
    const fieldErrors: Record<string, string[]> = {};

    for (const source of ['body', 'query', 'params'] as const) {
      const schema = schemas[source];
      if (!schema) continue;
      const result = schema.safeParse(req[source]);
      if (result.success) {
        req.valid[source] = result.data;
      } else {
        Object.assign(fieldErrors, toFieldErrors(result.error, source));
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      next(new AppError('VALIDATION_ERROR', { fieldErrors }));
      return;
    }
    next();
  };
}

/** Typed accessors so handlers do not litter casts everywhere. */
export function body<T>(req: Request): T {
  return req.valid?.body as T;
}

export function query<T>(req: Request): T {
  return req.valid?.query as T;
}

export function params<T>(req: Request): T {
  return req.valid?.params as T;
}
