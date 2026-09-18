import type { UserRole } from '@prisma/client';
import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { env } from '../config/env';
import { AppError } from './errors';

/**
 * Access tokens are short-lived signed JWTs; refresh tokens are opaque random
 * strings held (hashed) in the database. Keeping the refresh side stateful is
 * what makes "sign out of all devices", suspension and replay detection
 * actually enforceable — a self-contained refresh JWT could not be revoked.
 */

const accessKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export interface AccessTokenClaims {
  sub: string;
  role: UserRole;
  /** Premium flag, so the quota middleware need not hit the database. */
  prm: boolean;
  /** Refresh-token family id, so an access token can be traced to a session. */
  sid: string;
}

export async function signAccessToken(claims: AccessTokenClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role: claims.role, prm: claims.prm, sid: claims.sid })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(env.JWT_ISSUER)
    .setAudience('bday-app')
    .setIssuedAt(now)
    .setExpirationTime(now + env.JWT_ACCESS_TTL_SECONDS)
    .sign(accessKey);
}

export async function verifyAccessToken(token: string): Promise<AccessTokenClaims> {
  try {
    const { payload } = await jwtVerify(token, accessKey, {
      issuer: env.JWT_ISSUER,
      audience: 'bday-app',
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') {
      throw new AppError('TOKEN_INVALID');
    }
    return {
      sub: payload.sub,
      role: payload.role as UserRole,
      prm: payload.prm === true,
      sid: payload.sid,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof joseErrors.JWTExpired) throw new AppError('TOKEN_EXPIRED');
    throw new AppError('TOKEN_INVALID', { cause: error });
  }
}

/** Bearer scheme only. Query-string tokens end up in access logs. */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !value) return null;
  return value.trim() || null;
}
