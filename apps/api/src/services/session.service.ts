import type { AuthTokens, DeviceInfoInput } from '@bday/shared';
import { randomUUID } from 'node:crypto';
import { env } from '../config/env';
import { hashToken, randomToken } from '../lib/crypto';
import { addDays } from '../lib/dates';
import { AppError } from '../lib/errors';
import { signAccessToken } from '../lib/jwt';
import { logger } from '../lib/logger';
import { prisma, type Db } from '../lib/prisma';

/**
 * Session lifecycle.
 *
 * Refresh tokens are opaque, stored hashed, and rotated on every use. Each
 * rotation is linked to its predecessor through `replacedById`, which is what
 * makes replay detectable: if a token that has already been rotated comes back,
 * the only explanations are a stolen copy or a broken client, and both are
 * handled the same way — kill the whole family.
 */

export interface SessionContext {
  ip?: string | null;
  userAgent?: string | null;
  device?: DeviceInfoInput;
}

async function registerDevice(userId: string, context: SessionContext, db: Db): Promise<string | null> {
  const device = context.device;
  if (!device?.deviceId && !device?.pushToken) return null;

  const platform = device.platform ?? 'unknown';

  // A push token is unique platform-wide: when a handset is handed to another
  // account, the token must move with the device, not stay with the old user.
  if (device.pushToken) {
    await db.device.deleteMany({
      where: { pushToken: device.pushToken, NOT: { userId } },
    });
  }

  if (device.deviceId) {
    const row = await db.device.upsert({
      where: { userId_deviceId: { userId, deviceId: device.deviceId } },
      create: {
        userId,
        deviceId: device.deviceId,
        platform,
        model: device.model ?? null,
        osVersion: device.osVersion ?? null,
        appVersion: device.appVersion ?? null,
        pushToken: device.pushToken ?? null,
      },
      update: {
        platform,
        model: device.model ?? null,
        osVersion: device.osVersion ?? null,
        appVersion: device.appVersion ?? null,
        ...(device.pushToken ? { pushToken: device.pushToken } : {}),
        lastSeenAt: new Date(),
      },
      select: { id: true },
    });
    return row.id;
  }

  const row = await db.device.create({
    data: {
      userId,
      platform,
      model: device.model ?? null,
      osVersion: device.osVersion ?? null,
      appVersion: device.appVersion ?? null,
      pushToken: device.pushToken ?? null,
    },
    select: { id: true },
  });
  return row.id;
}

async function mintTokens(
  user: { id: string; role: 'USER' | 'VENDOR' | 'ADMIN' | 'SUPER_ADMIN'; isPremium: boolean },
  familyId: string,
  context: SessionContext,
  deviceRowId: string | null,
  db: Db,
): Promise<AuthTokens> {
  const refreshToken = randomToken(48);
  const expiresAt = addDays(new Date(), env.JWT_REFRESH_TTL_DAYS);

  await db.refreshToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      familyId,
      deviceId: deviceRowId,
      userAgent: context.userAgent?.slice(0, 256) ?? null,
      ip: context.ip ?? null,
      expiresAt,
    },
  });

  const accessToken = await signAccessToken({
    sub: user.id,
    role: user.role,
    prm: user.isPremium,
    sid: familyId,
  });

  return {
    accessToken,
    refreshToken,
    expiresIn: env.JWT_ACCESS_TTL_SECONDS,
    tokenType: 'Bearer',
  };
}

/** Starts a new session (login, register, OAuth, OTP verification). */
export async function createSession(
  user: { id: string; role: 'USER' | 'VENDOR' | 'ADMIN' | 'SUPER_ADMIN'; isPremium: boolean },
  context: SessionContext = {},
  db: Db = prisma,
): Promise<AuthTokens> {
  const deviceRowId = await registerDevice(user.id, context, db);
  return mintTokens(user, randomUUID(), context, deviceRowId, db);
}

/**
 * Exchanges a refresh token for a new pair.
 *
 * Reuse of an already-rotated token revokes every token in the family, because
 * at that point we cannot tell the legitimate client from the attacker and the
 * safe answer is that neither of them keeps the session.
 */
export async function rotateSession(
  rawToken: string,
  context: SessionContext = {},
): Promise<{ tokens: AuthTokens; userId: string }> {
  const tokenHash = hashToken(rawToken);

  const existing = await prisma.refreshToken.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      familyId: true,
      deviceId: true,
      expiresAt: true,
      revokedAt: true,
      replacedById: true,
    },
  });

  if (!existing) throw new AppError('TOKEN_INVALID');

  if (existing.replacedById || existing.revokedAt) {
    await prisma.refreshToken.updateMany({
      where: { familyId: existing.familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    logger.warn(
      { userId: existing.userId, familyId: existing.familyId },
      'refresh token reuse detected — family revoked',
    );
    throw new AppError('TOKEN_REVOKED', {
      message: 'Your session was ended for security reasons. Please sign in again.',
    });
  }

  if (existing.expiresAt.getTime() <= Date.now()) {
    throw new AppError('TOKEN_EXPIRED');
  }

  const user = await prisma.user.findFirst({
    where: { id: existing.userId, deletedAt: null },
    select: { id: true, role: true, isPremium: true, status: true },
  });
  if (!user) throw new AppError('TOKEN_INVALID');
  if (user.status === 'SUSPENDED') throw new AppError('ACCOUNT_SUSPENDED');
  if (user.status === 'DEACTIVATED') throw new AppError('TOKEN_REVOKED');

  const tokens = await prisma.$transaction(async (tx) => {
    const issued = await mintTokens(user, existing.familyId, context, existing.deviceId, tx);
    const successor = await tx.refreshToken.findUnique({
      where: { tokenHash: hashToken(issued.refreshToken) },
      select: { id: true },
    });
    await tx.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedById: successor?.id ?? null },
    });
    return issued;
  });

  return { tokens, userId: user.id };
}

export async function revokeSession(rawToken: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllSessions(userId: string, db: Db = prisma): Promise<void> {
  await db.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/** Housekeeping for the cron worker: drop tokens nobody can use any more. */
export async function purgeExpiredTokens(olderThanDays = 30): Promise<number> {
  const cutoff = addDays(new Date(), -olderThanDays);
  const result = await prisma.refreshToken.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }],
    },
  });
  return result.count;
}
