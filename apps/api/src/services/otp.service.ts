import type { OtpChallenge as OtpChallengeDto } from '@bday/shared';
import type { NotificationChannel, OtpPurpose, Prisma } from '@prisma/client';
import { env } from '../config/env';
import { generateOtpCode, hashOtpCode, maskEmail, maskPhone, verifyOtpCode } from '../lib/crypto';
import { addSeconds } from '../lib/dates';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { prisma, type Db } from '../lib/prisma';
import { email, sms } from '../providers/messaging';

/**
 * One-time codes for phone/email verification, passwordless login and password
 * reset (spec §38).
 *
 * Three things keep this honest:
 *   * the code is stored only as a bcrypt hash,
 *   * attempts are counted on the row, so guessing is bounded even if the
 *     rate limiter is bypassed by rotating IPs,
 *   * a consumed challenge can never be replayed.
 */

export interface IssueOtpInput {
  purpose: OtpPurpose;
  email?: string | null;
  phone?: string | null;
  userId?: string | null;
  ip?: string | null;
  /** Registration payload held until the code is verified. */
  payload?: Prisma.InputJsonValue;
}

const PURPOSE_COPY: Record<OtpPurpose, (code: string) => { subject: string; text: string }> = {
  PHONE_VERIFICATION: (code) => ({
    subject: 'Verify your number',
    text: `${code} is your Birthday App verification code. It expires in 10 minutes.`,
  }),
  EMAIL_VERIFICATION: (code) => ({
    subject: 'Verify your email',
    text: `${code} is your Birthday App verification code. It expires in 10 minutes.`,
  }),
  LOGIN: (code) => ({
    subject: 'Your sign-in code',
    text: `${code} is your Birthday App sign-in code. It expires in 10 minutes. If this was not you, ignore this message.`,
  }),
  PASSWORD_RESET: (code) => ({
    subject: 'Reset your password',
    text: `${code} is your Birthday App password reset code. It expires in 10 minutes.`,
  }),
};

/**
 * Issues a challenge and sends the code.
 *
 * The returned DTO masks the destination: the caller may not know the full
 * address (a password-reset flow can be started by anyone who types an email),
 * so echoing it back would turn this endpoint into an account-enumeration oracle.
 */
export async function issueOtp(input: IssueOtpInput, db: Db = prisma): Promise<OtpChallengeDto & { debugCode?: string }> {
  const destination = input.phone ?? input.email;
  if (!destination) {
    throw new AppError('VALIDATION_ERROR', { message: 'Enter an email address or a phone number.' });
  }
  const channel: NotificationChannel = input.phone ? 'SMS' : 'EMAIL';

  // Cooldown: stop a client (or a script) re-sending in a tight loop.
  const recent = await db.otpChallenge.findFirst({
    where: {
      destination,
      purpose: input.purpose,
      consumedAt: null,
      createdAt: { gt: addSeconds(new Date(), -env.OTP_RESEND_COOLDOWN_SECONDS) },
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, createdAt: true },
  });
  if (recent) {
    const waitSeconds = Math.max(
      1,
      env.OTP_RESEND_COOLDOWN_SECONDS -
        Math.floor((Date.now() - recent.createdAt.getTime()) / 1000),
    );
    throw new AppError('RATE_LIMITED', {
      message: `Please wait ${waitSeconds}s before requesting another code.`,
    });
  }

  const code = generateOtpCode();
  const expiresAt = addSeconds(new Date(), env.OTP_TTL_SECONDS);

  const challenge = await db.otpChallenge.create({
    data: {
      userId: input.userId ?? null,
      purpose: input.purpose,
      destination,
      channel,
      codeHash: await hashOtpCode(code),
      expiresAt,
      payload: input.payload,
      ip: input.ip ?? null,
    },
    select: { id: true, expiresAt: true },
  });

  const copy = PURPOSE_COPY[input.purpose](code);

  // Delivery failures must not strand the user with an unusable challenge id,
  // so they are logged and surfaced as a provider error rather than swallowed.
  try {
    if (channel === 'SMS' && input.phone) {
      await sms().send(input.phone, copy.text);
    } else if (input.email) {
      await email().send({ to: input.email, subject: copy.subject, text: copy.text });
    }
  } catch (error) {
    logger.error({ err: error, challengeId: challenge.id, channel }, 'otp delivery failed');
    throw new AppError('INTERNAL_ERROR', {
      message: 'We could not send your code right now. Please try again.',
      cause: error,
    });
  }

  return {
    challengeId: challenge.id,
    destination: input.phone ? maskPhone(input.phone) : maskEmail(input.email!),
    expiresAt: challenge.expiresAt.toISOString(),
    resendAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS,
    // Development only — the env schema forbids this flag in production.
    ...(env.OTP_DEBUG_ECHO ? { debugCode: code } : {}),
  };
}

export interface VerifiedChallenge {
  id: string;
  userId: string | null;
  purpose: OtpPurpose;
  destination: string;
  channel: NotificationChannel;
  payload: Prisma.JsonValue | null;
}

/**
 * Checks a code and consumes the challenge.
 *
 * Consumption happens in the same transaction as the check so two concurrent
 * verifications of the same code cannot both succeed.
 */
export async function verifyOtp(
  challengeId: string,
  code: string,
  expectedPurpose?: OtpPurpose,
): Promise<VerifiedChallenge> {
  const challenge = await prisma.otpChallenge.findUnique({
    where: { id: challengeId },
    select: {
      id: true,
      userId: true,
      purpose: true,
      destination: true,
      channel: true,
      codeHash: true,
      attempts: true,
      maxAttempts: true,
      expiresAt: true,
      consumedAt: true,
      payload: true,
    },
  });

  if (!challenge) throw new AppError('OTP_INVALID');
  if (challenge.consumedAt) throw new AppError('OTP_EXPIRED');
  if (expectedPurpose && challenge.purpose !== expectedPurpose) throw new AppError('OTP_INVALID');
  if (challenge.expiresAt.getTime() <= Date.now()) throw new AppError('OTP_EXPIRED');
  if (challenge.attempts >= challenge.maxAttempts) throw new AppError('OTP_MAX_ATTEMPTS');

  const matches = await verifyOtpCode(code, challenge.codeHash);

  if (!matches) {
    const updated = await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
      select: { attempts: true, maxAttempts: true },
    });
    if (updated.attempts >= updated.maxAttempts) throw new AppError('OTP_MAX_ATTEMPTS');
    throw new AppError('OTP_INVALID');
  }

  const consumed = await prisma.otpChallenge.updateMany({
    where: { id: challenge.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  if (consumed.count === 0) throw new AppError('OTP_EXPIRED');

  return {
    id: challenge.id,
    userId: challenge.userId,
    purpose: challenge.purpose,
    destination: challenge.destination,
    channel: challenge.channel,
    payload: challenge.payload,
  };
}

/** Cron housekeeping: expired challenges have no value and hold hashes. */
export async function purgeExpiredChallenges(): Promise<number> {
  const result = await prisma.otpChallenge.deleteMany({
    where: { expiresAt: { lt: addSeconds(new Date(), -3600) } },
  });
  return result.count;
}
