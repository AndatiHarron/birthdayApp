import { Prisma, PrismaClient } from '@prisma/client';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Single Prisma client for the process.
 *
 * Cached on `globalThis` so `tsx watch` reloads do not open a new connection
 * pool on every file save and exhaust Postgres' connection limit.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.isDevelopment
      ? [
          { emit: 'event', level: 'query' },
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ]
      : [
          { emit: 'event', level: 'warn' },
          { emit: 'event', level: 'error' },
        ],
  });

if (env.isDevelopment) {
  prisma.$on('query' as never, (event: Prisma.QueryEvent) => {
    // Slow-query surfacing; the full query text is noisy at info level.
    if (event.duration > 200) {
      logger.warn({ durationMs: event.duration, query: event.query }, 'slow query');
    } else {
      logger.trace({ durationMs: event.duration, query: event.query }, 'query');
    }
  });
}

prisma.$on('warn' as never, (event: Prisma.LogEvent) => logger.warn({ prisma: event }, event.message));
prisma.$on('error' as never, (event: Prisma.LogEvent) => logger.error({ prisma: event }, event.message));

if (!env.isProduction) {
  globalForPrisma.prisma = prisma;
}

/** Transaction client type, for services that accept either. */
export type Tx = Prisma.TransactionClient;
export type Db = PrismaClient | Tx;

/**
 * Serializable transaction helper.
 *
 * Reservation and contribution writes must not interleave — two gifters
 * clicking "I'll get this" at the same moment is the exact scenario spec §58
 * rule 1 forbids. `Serializable` plus a retry on serialization failure is the
 * simplest correct answer; the row-level `SELECT … FOR UPDATE` in the service
 * keeps the contention window small.
 */
export async function serializableTransaction<T>(
  fn: (tx: Tx) => Promise<T>,
  { retries = 3 }: { retries?: number } = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 15_000,
      });
    } catch (error) {
      lastError = error;
      const retryable = isRetryableTransactionError(error);
      if (!retryable || attempt === retries) break;
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }
  throw lastError;
}

/**
 * 40001 (serialization failure) and 40P01 (deadlock) are safe to retry.
 *
 * Prisma reports them three ways: P2034 from model queries, and — when the
 * conflict surfaces inside `$queryRaw` (our `SELECT … FOR UPDATE` locks) — as
 * P2010 "raw query failed" with the SQLSTATE in `meta.code` or the message.
 */
export function isRetryableTransactionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const { code, meta, message } = error as { code?: string; meta?: { code?: string }; message?: string };
  if (code === 'P2034' || code === '40001' || code === '40P01') return true;
  if (meta?.code === '40001' || meta?.code === '40P01') return true;
  return typeof message === 'string' && /\b(40001|40P01)\b|could not serialize access|deadlock detected/i.test(message);
}

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
