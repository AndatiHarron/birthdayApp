import type { Request, Response } from 'express';
import rateLimit, { type Options, type Store } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { ERROR_MESSAGES } from '@bday/shared';
import { env } from '../config/env';
import { getRedis } from '../lib/redis';

/**
 * Rate limiting (spec §38, §50).
 *
 * Keyed on the authenticated user when there is one and the IP otherwise, so
 * one abusive client on a shared NAT does not lock out everyone behind it, and
 * so a signed-in attacker cannot multiply their budget by rotating addresses.
 */
function keyGenerator(req: Request): string {
  return req.auth?.userId ?? req.ip ?? 'unknown';
}

function store(prefix: string): Store | undefined {
  const redis = getRedis();
  if (!redis) return undefined;
  return new RedisStore({
    prefix: `rl:${prefix}:`,
    sendCommand: (...args: string[]) => redis.call(...(args as [string, ...string[]])) as Promise<never>,
  });
}

function handler(req: Request, res: Response): void {
  res.status(429).json({
    success: false,
    code: 'RATE_LIMITED',
    message: ERROR_MESSAGES.RATE_LIMITED,
    requestId: req.id,
  });
}

function build(prefix: string, options: Partial<Options>) {
  return rateLimit({
    windowMs: env.RATE_LIMIT_WINDOW_SECONDS * 1000,
    max: env.RATE_LIMIT_MAX,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator,
    handler,
    store: store(prefix),
    // Limits are a nuisance in local test runs and make assertions flaky.
    skip: () => env.isTest,
    ...options,
  });
}

/** Baseline limit applied to the whole API. */
export const globalLimiter = build('global', {});

/**
 * Credential endpoints. Deliberately strict and keyed on IP even when signed
 * in, because the thing being protected is the guessing of someone else's
 * credentials rather than the caller's own quota.
 */
export const authLimiter = build('auth', {
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => req.ip ?? 'unknown',
});

/** OTP sends cost real money and reach a real handset. */
export const otpLimiter = build('otp', {
  windowMs: 60 * 60 * 1000,
  max: 8,
  keyGenerator: (req) => {
    const target = (req.body as { phone?: string; email?: string } | undefined) ?? {};
    return target.phone ?? target.email ?? req.ip ?? 'unknown';
  },
});

/** Payment initiation — duplicate-charge protection is idempotency keys, but
 *  a tight limit also blunts card-testing attacks. */
export const paymentLimiter = build('payment', {
  windowMs: 60 * 1000,
  max: 10,
});

/** Each AI call costs tokens; the per-user daily quota is enforced separately. */
export const aiLimiter = build('ai', {
  windowMs: 60 * 1000,
  max: 12,
});

export const uploadLimiter = build('upload', {
  windowMs: 60 * 1000,
  max: 30,
});

/** Outbound URL fetching — guards against using us as a scanning proxy. */
export const unfurlLimiter = build('unfurl', {
  windowMs: 60 * 1000,
  max: 20,
});

export const searchLimiter = build('search', {
  windowMs: 60 * 1000,
  max: 60,
});

/** Webhooks are authenticated by signature; the limit is only anti-flood. */
export const webhookLimiter = build('webhook', {
  windowMs: 60 * 1000,
  max: 600,
  keyGenerator: (req) => req.ip ?? 'unknown',
});

/** One-tap cheers: generous for a joyful burst, not for a script. */
export const cheerLimiter = build('cheer', {
  windowMs: 60 * 1000,
  max: 60,
});
