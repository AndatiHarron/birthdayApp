import Redis from 'ioredis';
import { env } from '../config/env';
import { logger } from './logger';

/**
 * Optional Redis.
 *
 * Used for the distributed rate limiter, the socket.io adapter and short-lived
 * caches. When REDIS_URL is unset the app still runs — the rate limiter falls
 * back to an in-memory store and sockets to a single-node adapter — which keeps
 * local development to one dependency, but means a multi-instance production
 * deployment must configure it.
 */
let client: Redis | null = null;
let warnedAboutAbsence = false;

export function getRedis(): Redis | null {
  if (!env.REDIS_URL) {
    if (!warnedAboutAbsence && !env.isTest) {
      warnedAboutAbsence = true;
      logger.warn(
        'REDIS_URL is not set: rate limiting is per-process and websockets are single-node. ' +
          'Configure Redis before running more than one instance.',
      );
    }
    return null;
  }
  if (!client) {
    client = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });
    client.on('error', (error) => logger.error({ err: error }, 'redis error'));
    client.on('connect', () => logger.info('redis connected'));
  }
  return client;
}

/** A second connection, required by socket.io's pub/sub adapter. */
export function createRedisSubscriber(): Redis | null {
  if (!env.REDIS_URL) return null;
  const subscriber = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  subscriber.on('error', (error) => logger.error({ err: error }, 'redis subscriber error'));
  return subscriber;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => client?.disconnect());
    client = null;
  }
}

/* --------------------------- small cache helpers --------------------------- */

export async function cacheGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;
  try {
    const raw = await redis.get(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch (error) {
    logger.warn({ err: error, key }, 'cache read failed');
    return null;
  }
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch (error) {
    logger.warn({ err: error, key }, 'cache write failed');
  }
}

export async function cacheDelete(...keys: string[]): Promise<void> {
  const redis = getRedis();
  if (!redis || keys.length === 0) return;
  try {
    await redis.del(...keys);
  } catch (error) {
    logger.warn({ err: error, keys }, 'cache delete failed');
  }
}

/**
 * Best-effort distributed lock, used by the cron workers so two instances do
 * not both send the same batch of reminders. Idempotency still comes from the
 * `notification_dispatches.dedupeKey` unique index — this only avoids the
 * wasted work.
 */
export async function acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return true;
  const result = await redis.set(`lock:${key}`, '1', 'EX', ttlSeconds, 'NX');
  return result === 'OK';
}

export async function releaseLock(key: string): Promise<void> {
  await cacheDelete(`lock:${key}`);
}
