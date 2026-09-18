import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { env } from '../config/env';

/* ------------------------------ passwords ------------------------------ */

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, env.BCRYPT_ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Burns roughly the same time as a real comparison.
 *
 * Called when a login misses an account entirely, so the response time cannot
 * be used to tell "no such user" apart from "wrong password".
 */
const DUMMY_HASH = '$2a$12$C6UzMDM.H6dfI/f/IKcEe.rrKQF1uHkYnZLbGSSfsFqCr1p0FTOMS';
export async function fakePasswordCheck(plain: string): Promise<void> {
  await bcrypt.compare(plain, DUMMY_HASH);
}

/* -------------------------------- OTP -------------------------------- */

/** Cryptographically uniform 6-digit code. */
export function generateOtpCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export async function hashOtpCode(code: string): Promise<string> {
  // Deliberately cheaper than a password hash: the code lives for minutes and
  // is rate-limited to 5 attempts, but verification happens on a hot path.
  return bcrypt.hash(code, 8);
}

export async function verifyOtpCode(code: string, hash: string): Promise<boolean> {
  return bcrypt.compare(code, hash);
}

/* ------------------------------- tokens ------------------------------- */

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Refresh tokens are stored as a SHA-256 digest.
 *
 * bcrypt would be wasteful here — the token is already 256 bits of entropy, so
 * there is nothing to brute-force — but a plain digest still means a database
 * leak does not hand over usable sessions.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/* ------------------------------ codes/slugs ------------------------------ */

const UNAMBIGUOUS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Human-readable code for invites and redemption vouchers.
 * Excludes I/O/0/1 so codes read aloud or typed from a screenshot still work.
 */
export function humanCode(length = 8): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += UNAMBIGUOUS[bytes[i]! % UNAMBIGUOUS.length];
  }
  return out;
}

export function shareSlug(): string {
  return randomBytes(9).toString('base64url').toLowerCase().replace(/[_-]/g, '');
}

/** `BD-20260903-7KQ2M9` — sortable by eye, unguessable in bulk. */
export function orderReference(prefix = 'BD'): string {
  const now = new Date();
  const date = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(
    now.getUTCDate(),
  ).padStart(2, '0')}`;
  return `${prefix}-${date}-${humanCode(6)}`;
}

export function paymentReference(): string {
  return orderReference('PAY');
}

/* ------------------------------ masking ------------------------------ */

/** `+2547••••123` — enough to recognise, not enough to enumerate. */
export function maskPhone(phone: string): string {
  if (phone.length <= 7) return '•'.repeat(phone.length);
  return `${phone.slice(0, 5)}••••${phone.slice(-3)}`;
}

/** `a••••e@example.com` */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (local.length <= 2) return `${'•'.repeat(local.length)}@${domain}`;
  return `${local[0]}${'•'.repeat(Math.min(4, local.length - 2))}${local.at(-1)}@${domain}`;
}
