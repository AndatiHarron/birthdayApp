import type { ApiFailure, ApiSuccess, PaginationMeta } from '@bday/shared';
import type { Response } from 'express';

/** Success envelope (spec §51). */
export function ok<T>(res: Response, data: T, meta?: PaginationMeta & Record<string, unknown>) {
  const body: ApiSuccess<T> = meta ? { success: true, data, meta } : { success: true, data };
  return res.status(res.statusCode === 200 ? 200 : res.statusCode).json(body);
}

export function created<T>(res: Response, data: T) {
  const body: ApiSuccess<T> = { success: true, data };
  return res.status(201).json(body);
}

export function noContent(res: Response) {
  return res.status(204).end();
}

/** Failure envelope. Only ever called from the error middleware. */
export function fail(res: Response, status: number, body: ApiFailure) {
  return res.status(status).json(body);
}

/**
 * Cursor pagination helper.
 *
 * Cursors are opaque base64 of the last row's sort key so clients cannot craft
 * one that skips authorisation checks by, say, jumping into another user's rows.
 */
export function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

export function decodeCursor<T = Record<string, unknown>>(cursor: string | undefined): T | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as T) : null;
  } catch {
    return null;
  }
}

/**
 * Takes `limit + 1` rows, returns `limit` of them plus the next cursor.
 * Callers over-fetch by one so "is there another page" needs no count query.
 */
export function paginate<T>(
  rows: T[],
  limit: number,
  toCursor: (row: T) => Record<string, unknown>,
): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: last ? encodeCursor(toCursor(last)) : null };
}
