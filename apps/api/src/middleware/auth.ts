import type { UserRole } from '@prisma/client';
import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../lib/errors';
import { extractBearerToken, verifyAccessToken } from '../lib/jwt';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';

/**
 * Attaches `req.auth` when a valid access token is present.
 *
 * The token's claims are trusted for identity, but account state is not cached
 * in the token beyond premium status: a suspended or deleted account must lose
 * access immediately rather than when its 15-minute token expires, so status is
 * re-read here. That is one indexed primary-key lookup per authenticated call.
 */
async function resolveAuth(req: Request): Promise<Express.AuthContext | null> {
  const token = extractBearerToken(req.header('authorization'));
  if (!token) return null;

  const claims = await verifyAccessToken(token);

  const user = await prisma.user.findUnique({
    where: { id: claims.sub },
    select: { id: true, role: true, status: true, isPremium: true, deletedAt: true },
  });

  if (!user || user.deletedAt) throw new AppError('TOKEN_INVALID');
  if (user.status === 'SUSPENDED') throw new AppError('ACCOUNT_SUSPENDED');
  if (user.status === 'DEACTIVATED') throw new AppError('TOKEN_REVOKED');

  return {
    userId: user.id,
    role: user.role,
    isPremium: user.isPremium,
    sessionId: claims.sid,
  };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  void resolveAuth(req)
    .then((auth) => {
      if (!auth) {
        next(new AppError('UNAUTHENTICATED'));
        return;
      }
      req.auth = auth;
      touchLastActive(auth.userId);
      next();
    })
    .catch(next);
}

/** For endpoints that behave differently, but still work, when signed out. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction): void {
  void resolveAuth(req)
    .then((auth) => {
      if (auth) {
        req.auth = auth;
        touchLastActive(auth.userId);
      }
      next();
    })
    .catch(() => next());
}

export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new AppError('UNAUTHENTICATED'));
      return;
    }
    if (!roles.includes(req.auth.role)) {
      next(new AppError('FORBIDDEN'));
      return;
    }
    next();
  };
}

export const requireAdmin = requireRole('ADMIN', 'SUPER_ADMIN');

/** Blocks accounts that have not finished onboarding from social endpoints. */
export function requireOnboarded(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(new AppError('UNAUTHENTICATED'));
    return;
  }
  void prisma.user
    .findUnique({
      where: { id: req.auth.userId },
      select: { onboardingCompletedAt: true },
    })
    .then((user) => {
      if (!user?.onboardingCompletedAt) {
        next(
          new AppError('ACCOUNT_NOT_VERIFIED', {
            message: 'Finish setting up your profile to continue.',
          }),
        );
        return;
      }
      next();
    })
    .catch(next);
}

/**
 * `lastActiveAt` powers the DAU/MAU figures on the admin dashboard. It is
 * written at most once every 5 minutes per user and never awaited, so the
 * analytics write cannot slow down or fail a real request.
 */
const lastActiveWrites = new Map<string, number>();
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

function touchLastActive(userId: string): void {
  const now = Date.now();
  const previous = lastActiveWrites.get(userId);
  if (previous && now - previous < TOUCH_INTERVAL_MS) return;
  lastActiveWrites.set(userId, now);
  if (lastActiveWrites.size > 10_000) {
    for (const [key, at] of lastActiveWrites) {
      if (now - at > TOUCH_INTERVAL_MS) lastActiveWrites.delete(key);
    }
  }
  void prisma.user
    .update({ where: { id: userId }, data: { lastActiveAt: new Date() } })
    .catch((error: unknown) => logger.debug({ err: error, userId }, 'lastActiveAt update failed'));
}

/** Reads `req.auth`, throwing if the route was mounted without `requireAuth`. */
export function auth(req: Request): Express.AuthContext {
  if (!req.auth) throw new AppError('UNAUTHENTICATED');
  return req.auth;
}
