import type {
  AuthSession,
  ChangePasswordInput,
  CheckAvailabilityInput,
  ForgotPasswordInput,
  LoginInput,
  OauthInput,
  OtpChallenge as OtpChallengeDto,
  RegisterInput,
  RequestOtpInput,
  ResetPasswordInput,
  VerifyOtpInput,
} from '@bday/shared';
import { RESERVED_USERNAMES } from '@bday/shared';
import type { Prisma } from '@prisma/client';
import { OAuth2Client } from 'google-auth-library';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { env } from '../config/env';
import { fakePasswordCheck, hashPassword, verifyPassword } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { prisma, type Tx } from '../lib/prisma';
import { toCurrentUser, type UserWithRelations } from '../mappers/user.mapper';
import { issueOtp, verifyOtp } from './otp.service';
import { deriveUsername, provisionUser } from './provisioning.service';
import { createSession, revokeAllSessions, type SessionContext } from './session.service';

/**
 * Registration, sign-in and credential management (spec §2, §38).
 *
 * Two registration shapes are supported, and the difference is deliberate:
 *
 *   * email + password creates the account immediately and sends a
 *     verification code, because the password is the credential and the email
 *     is secondary;
 *   * phone-first has no credential until the code is entered, so the pending
 *     signup is parked on the OTP challenge and the account is only created
 *     once the handset has proven it can receive the code. That stops an
 *     attacker from squatting on somebody else's phone number.
 */

const USER_INCLUDE = {
  profile: true,
  privacy: true,
  notificationPreference: true,
} satisfies Prisma.UserInclude;

async function loadUser(userId: string): Promise<UserWithRelations> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: USER_INCLUDE });
  if (!user) throw new AppError('NOT_FOUND', { message: 'That account could not be found.' });
  return user as UserWithRelations;
}

async function buildSession(
  userId: string,
  context: SessionContext,
): Promise<AuthSession> {
  const user = await loadUser(userId);
  const tokens = await createSession(
    { id: user.id, role: user.role, isPremium: user.isPremium },
    context,
  );
  return {
    user: toCurrentUser(user),
    tokens,
    onboardingRequired: user.onboardingCompletedAt == null,
  };
}

/* ----------------------------- availability ----------------------------- */

export async function checkAvailability(
  input: CheckAvailabilityInput,
): Promise<{ username?: boolean; email?: boolean; phone?: boolean }> {
  const result: { username?: boolean; email?: boolean; phone?: boolean } = {};

  if (input.username) {
    const reserved = (RESERVED_USERNAMES as readonly string[]).includes(input.username);
    const taken = reserved
      ? true
      : (await prisma.user.findUnique({ where: { username: input.username }, select: { id: true } })) !==
        null;
    result.username = !taken;
  }
  // Email and phone are answered too, but only for the signup form — knowing
  // an address is registered is unavoidable there, since registration itself
  // would reveal it a moment later.
  if (input.email) {
    result.email =
      (await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) === null;
  }
  if (input.phone) {
    result.phone =
      (await prisma.user.findUnique({ where: { phone: input.phone }, select: { id: true } })) === null;
  }
  return result;
}

/* ------------------------------- register ------------------------------- */

export type RegisterResult =
  | { kind: 'SESSION'; session: AuthSession; verification: OtpChallengeDto | null }
  | { kind: 'OTP_REQUIRED'; challenge: OtpChallengeDto };

export async function register(
  input: RegisterInput,
  context: SessionContext,
): Promise<RegisterResult> {
  if (input.email) {
    const existing = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (existing) throw new AppError('EMAIL_ALREADY_REGISTERED');
  }
  if (input.phone) {
    const existing = await prisma.user.findUnique({ where: { phone: input.phone }, select: { id: true } });
    if (existing) throw new AppError('PHONE_ALREADY_REGISTERED');
  }
  if (input.username) {
    const existing = await prisma.user.findUnique({
      where: { username: input.username },
      select: { id: true },
    });
    if (existing) throw new AppError('USERNAME_TAKEN');
  }

  // Phone-first signup: park the payload, create nothing until the code lands.
  if (input.phone && !input.password) {
    const challenge = await issueOtp({
      purpose: 'PHONE_VERIFICATION',
      phone: input.phone,
      ip: context.ip ?? null,
      payload: {
        displayName: input.displayName,
        username: input.username ?? null,
        phone: input.phone,
        email: input.email ?? null,
        birthday: input.birthday ?? null,
        timezone: input.timezone ?? null,
        inviteCode: input.inviteCode ?? null,
      } as Prisma.InputJsonValue,
    });
    return { kind: 'OTP_REQUIRED', challenge };
  }

  if (!input.password) {
    throw new AppError('VALIDATION_ERROR', {
      fieldErrors: { 'body.password': ['Choose a password'] },
    });
  }

  const passwordHash = await hashPassword(input.password);
  const username = input.username ?? (await deriveUsername(input.displayName));

  const user = await prisma.$transaction(async (tx) =>
    provisionUser(tx, {
      email: input.email ?? null,
      phone: input.phone ?? null,
      username,
      displayName: input.displayName,
      passwordHash,
      birthday: input.birthday ?? null,
      timezone: input.timezone ?? null,
    }),
  );

  if (input.inviteCode) {
    await redeemInvite(input.inviteCode, user.id).catch((error: unknown) =>
      logger.warn({ err: error, userId: user.id }, 'invite redemption failed during registration'),
    );
  }

  const session = await buildSession(user.id, context);

  // Verification is sent, but not required to get a session: blocking the app
  // behind an unread email is the most common place signups are abandoned.
  let verification: OtpChallengeDto | null = null;
  if (input.email) {
    verification = await issueOtp({
      purpose: 'EMAIL_VERIFICATION',
      email: input.email,
      userId: user.id,
      ip: context.ip ?? null,
    }).catch((error: unknown) => {
      logger.warn({ err: error, userId: user.id }, 'verification code send failed');
      return null;
    });
  }

  return { kind: 'SESSION', session, verification };
}

/* -------------------------------- login -------------------------------- */

export async function login(input: LoginInput, context: SessionContext): Promise<AuthSession> {
  const where: Prisma.UserWhereInput = input.email
    ? { email: input.email }
    : input.phone
      ? { phone: input.phone }
      : { username: input.username! };

  const user = await prisma.user.findFirst({
    where: { ...where, deletedAt: null },
    select: { id: true, passwordHash: true, status: true },
  });

  if (!user) {
    // Burn comparable time so a missing account is not detectable by latency.
    await fakePasswordCheck(input.password);
    throw new AppError('INVALID_CREDENTIALS');
  }
  if (!user.passwordHash) throw new AppError('PASSWORD_NOT_SET');

  const matches = await verifyPassword(input.password, user.passwordHash);
  if (!matches) throw new AppError('INVALID_CREDENTIALS');

  if (user.status === 'SUSPENDED') throw new AppError('ACCOUNT_SUSPENDED');
  if (user.status === 'DEACTIVATED') {
    // Signing in is how a user undoes their own deactivation.
    await prisma.user.update({ where: { id: user.id }, data: { status: 'ACTIVE' } });
  }

  return buildSession(user.id, context);
}

/* --------------------------------- OTP --------------------------------- */

export async function requestOtp(
  input: RequestOtpInput,
  context: SessionContext,
): Promise<OtpChallengeDto> {
  const user = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      ...(input.email ? { email: input.email } : { phone: input.phone! }),
    },
    select: { id: true, status: true },
  });

  if (input.purpose === 'LOGIN' || input.purpose === 'PASSWORD_RESET') {
    // Never disclose whether the destination is registered. When it is not, a
    // challenge is still issued (and simply never verifies) so the response is
    // indistinguishable from the success case.
    if (!user) {
      return {
        challengeId: 'ch_unknown',
        destination: input.phone ?? input.email ?? '',
        expiresAt: new Date(Date.now() + env.OTP_TTL_SECONDS * 1000).toISOString(),
        resendAfterSeconds: env.OTP_RESEND_COOLDOWN_SECONDS,
      };
    }
    if (user.status === 'SUSPENDED') throw new AppError('ACCOUNT_SUSPENDED');
  }

  return issueOtp({
    purpose: input.purpose,
    email: input.email ?? null,
    phone: input.phone ?? null,
    userId: user?.id ?? null,
    ip: context.ip ?? null,
  });
}

interface PendingRegistration {
  displayName?: string;
  username?: string | null;
  phone?: string | null;
  email?: string | null;
  birthday?: { month: number; day: number; year?: number | null } | null;
  timezone?: string | null;
  inviteCode?: string | null;
}

/**
 * Verifies a code and returns a session.
 *
 * Handles three cases: finishing a parked phone signup, verifying a contact
 * detail on an existing account, and passwordless login.
 */
export async function verifyOtpAndSignIn(
  input: VerifyOtpInput,
  context: SessionContext,
): Promise<AuthSession> {
  const challenge = await verifyOtp(input.challengeId, input.code);

  // Parked signup — the account is created now, with the number proven.
  if (!challenge.userId && challenge.payload) {
    const payload = challenge.payload as PendingRegistration;
    const phone = payload.phone ?? (challenge.channel === 'SMS' ? challenge.destination : null);

    const existing = phone
      ? await prisma.user.findUnique({ where: { phone }, select: { id: true } })
      : null;
    if (existing) {
      // Somebody registered the same number between issue and verify.
      return buildSession(existing.id, { ...context, device: input.device });
    }

    const username =
      payload.username && !(await usernameTaken(payload.username))
        ? payload.username
        : await deriveUsername(payload.displayName ?? 'friend');

    const user = await prisma.$transaction(async (tx) =>
      provisionUser(tx, {
        phone,
        email: payload.email ?? null,
        username,
        displayName: payload.displayName ?? username,
        phoneVerified: true,
        birthday: payload.birthday ?? null,
        timezone: payload.timezone ?? null,
      }),
    );

    if (payload.inviteCode) {
      await redeemInvite(payload.inviteCode, user.id).catch((error: unknown) =>
        logger.warn({ err: error, userId: user.id }, 'invite redemption failed after OTP signup'),
      );
    }

    return buildSession(user.id, { ...context, device: input.device });
  }

  if (!challenge.userId) throw new AppError('OTP_INVALID');

  const data: Prisma.UserUpdateInput = {};
  if (challenge.purpose === 'PHONE_VERIFICATION') {
    data.phoneVerified = true;
    data.phoneVerifiedAt = new Date();
  }
  if (challenge.purpose === 'EMAIL_VERIFICATION') {
    data.emailVerified = true;
    data.emailVerifiedAt = new Date();
  }
  if (Object.keys(data).length > 0) {
    const current = await prisma.user.findUnique({
      where: { id: challenge.userId },
      select: { status: true },
    });
    if (current?.status === 'PENDING_VERIFICATION') data.status = 'ACTIVE';
    await prisma.user.update({ where: { id: challenge.userId }, data });
  }

  return buildSession(challenge.userId, { ...context, device: input.device });
}

async function usernameTaken(username: string): Promise<boolean> {
  if ((RESERVED_USERNAMES as readonly string[]).includes(username)) return true;
  const row = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  return row !== null;
}

/* -------------------------------- OAuth -------------------------------- */

const googleClient = new OAuth2Client();
const appleJwks = createRemoteJWKSet(new URL('https://appleid.apple.com/auth/keys'));

interface OauthIdentity {
  providerUserId: string;
  email: string | null;
  emailVerified: boolean;
  displayName: string | null;
}

async function verifyGoogleToken(idToken: string): Promise<OauthIdentity> {
  if (env.googleClientIds.length === 0) {
    throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', {
      status: 503,
      message: 'Google sign-in is not configured.',
    });
  }
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: env.googleClientIds,
    });
    const payload = ticket.getPayload();
    if (!payload?.sub) throw new AppError('OAUTH_TOKEN_INVALID');
    return {
      providerUserId: payload.sub,
      email: payload.email ?? null,
      emailVerified: payload.email_verified === true,
      displayName: payload.name ?? null,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('OAUTH_TOKEN_INVALID', { cause: error });
  }
}

async function verifyAppleToken(idToken: string, nonce?: string): Promise<OauthIdentity> {
  if (env.appleClientIds.length === 0) {
    throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', {
      status: 503,
      message: 'Apple sign-in is not configured.',
    });
  }
  try {
    const { payload } = await jwtVerify(idToken, appleJwks, {
      issuer: 'https://appleid.apple.com',
      audience: env.appleClientIds,
    });
    if (typeof payload.sub !== 'string') throw new AppError('OAUTH_TOKEN_INVALID');
    // Apple echoes the client's nonce; checking it is what stops a token
    // captured from another session being replayed here.
    if (nonce && payload.nonce !== nonce) throw new AppError('OAUTH_TOKEN_INVALID');
    return {
      providerUserId: payload.sub,
      email: typeof payload.email === 'string' ? payload.email.toLowerCase() : null,
      emailVerified: payload.email_verified === true || payload.email_verified === 'true',
      displayName: null,
    };
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError('OAUTH_TOKEN_INVALID', { cause: error });
  }
}

export async function oauthSignIn(input: OauthInput, context: SessionContext): Promise<AuthSession> {
  const identity =
    input.provider === 'GOOGLE'
      ? await verifyGoogleToken(input.idToken)
      : await verifyAppleToken(input.idToken, input.nonce);

  const existingIdentity = await prisma.authIdentity.findUnique({
    where: {
      provider_providerUserId: {
        provider: input.provider,
        providerUserId: identity.providerUserId,
      },
    },
    select: { userId: true, user: { select: { status: true, deletedAt: true } } },
  });

  if (existingIdentity && !existingIdentity.user.deletedAt) {
    if (existingIdentity.user.status === 'SUSPENDED') throw new AppError('ACCOUNT_SUSPENDED');
    return buildSession(existingIdentity.userId, { ...context, device: input.device });
  }

  // Link to an existing account when the provider vouches for the address.
  // Without `emailVerified` this would let anyone who can mint a token for an
  // unverified address take over the matching account.
  if (identity.email && identity.emailVerified) {
    const byEmail = await prisma.user.findFirst({
      where: { email: identity.email, deletedAt: null },
      select: { id: true, status: true },
    });
    if (byEmail) {
      if (byEmail.status === 'SUSPENDED') throw new AppError('ACCOUNT_SUSPENDED');
      await prisma.authIdentity.create({
        data: {
          userId: byEmail.id,
          provider: input.provider,
          providerUserId: identity.providerUserId,
          email: identity.email,
        },
      });
      return buildSession(byEmail.id, { ...context, device: input.device });
    }
  }

  const displayName = input.displayName ?? identity.displayName ?? identity.email?.split('@')[0] ?? 'Friend';
  const username = await deriveUsername(displayName);

  const user = await prisma.$transaction(async (tx: Tx) =>
    provisionUser(tx, {
      email: identity.email,
      username,
      displayName,
      emailVerified: identity.emailVerified,
      identity: {
        provider: input.provider,
        providerUserId: identity.providerUserId,
        email: identity.email,
      },
    }),
  );

  return buildSession(user.id, { ...context, device: input.device });
}

/* ------------------------------ passwords ------------------------------ */

export async function forgotPassword(
  input: ForgotPasswordInput,
  context: SessionContext,
): Promise<OtpChallengeDto> {
  return requestOtp({ ...input, purpose: 'PASSWORD_RESET' }, context);
}

export async function resetPassword(input: ResetPasswordInput): Promise<void> {
  const challenge = await verifyOtp(input.challengeId, input.code, 'PASSWORD_RESET');
  if (!challenge.userId) throw new AppError('OTP_INVALID');

  const passwordHash = await hashPassword(input.password);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: challenge.userId! },
      data: { passwordHash, status: 'ACTIVE' },
    });
    // A password reset is also the remedy for a compromised account, so every
    // existing session goes with it.
    await revokeAllSessions(challenge.userId!, tx);
  });
}

export async function changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });
  if (!user) throw new AppError('NOT_FOUND');

  if (user.passwordHash) {
    if (!input.currentPassword) {
      throw new AppError('VALIDATION_ERROR', {
        fieldErrors: { 'body.currentPassword': ['Enter your current password'] },
      });
    }
    const matches = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!matches) throw new AppError('INVALID_CREDENTIALS', { message: 'That password is incorrect.' });
  }

  const passwordHash = await hashPassword(input.newPassword);
  await prisma.user.update({ where: { id: userId }, data: { passwordHash } });
}

/* ------------------------------- invites ------------------------------- */

/**
 * Accepting an invite links the inviter's manual calendar entry to the new
 * account and creates the friendship, so the person they were already tracking
 * becomes a real connection rather than a duplicate.
 */
export async function redeemInvite(code: string, userId: string): Promise<void> {
  const invite = await prisma.invite.findUnique({
    where: { code: code.trim().toUpperCase() },
    select: {
      id: true,
      inviterId: true,
      trackedBirthdayId: true,
      expiresAt: true,
      acceptedAt: true,
    },
  });
  if (!invite || invite.acceptedAt) return;
  if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) return;
  if (invite.inviterId === userId) return;

  await prisma.$transaction(async (tx) => {
    await tx.invite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date(), acceptedByUserId: userId },
    });

    if (invite.trackedBirthdayId) {
      await tx.trackedBirthday.updateMany({
        where: { id: invite.trackedBirthdayId, ownerId: invite.inviterId, linkedUserId: null },
        data: { linkedUserId: userId, source: 'LINKED_USER' },
      });
    }

    const existing = await tx.friendship.findFirst({
      where: {
        OR: [
          { requesterId: invite.inviterId, addresseeId: userId },
          { requesterId: userId, addresseeId: invite.inviterId },
        ],
      },
      select: { id: true, status: true },
    });

    if (!existing) {
      await tx.friendship.create({
        data: {
          requesterId: invite.inviterId,
          addresseeId: userId,
          status: 'ACCEPTED',
          respondedAt: new Date(),
        },
      });
    } else if (existing.status !== 'ACCEPTED') {
      await tx.friendship.update({
        where: { id: existing.id },
        data: { status: 'ACCEPTED', respondedAt: new Date() },
      });
    }
  });
}

/* -------------------------------- logout -------------------------------- */

export async function logoutEverywhere(userId: string): Promise<void> {
  await revokeAllSessions(userId);
}
