import { idSchema } from '@bday/shared';
import type { Request } from 'express';
import { z } from 'zod';
import type { SessionContext } from '../services/session.service';

/** Shared path-parameter schemas. */
export const idParams = z.object({ id: idSchema });
export const idOrSlugParams = z.object({ id: z.string().trim().min(1).max(160) });

export const limitQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().trim().max(256).optional(),
});

/** `?types=A,B` or repeated `?types=A&types=B`. */
export function csvArray<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess((value) => {
    if (value == null || value === '') return undefined;
    if (Array.isArray(value)) return value.flatMap((entry) => String(entry).split(','));
    return String(value).split(',');
  }, z.array(item).optional());
}

export function sessionContext(req: Request, device?: SessionContext['device']): SessionContext {
  return {
    ip: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
    device,
  };
}
