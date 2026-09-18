import {
  INTEREST_CATALOG,
  RESERVED_USERNAMES,
  type BlockUserInput,
  type CompleteOnboardingInput,
  type CurrentUser,
  type DeleteAccountInput,
  type FriendshipSummary,
  type GiftPreferencesInput,
  type InterestDto,
  type NotificationPreferencesInput,
  type PrivacySettingsInput,
  type PublicProfile,
  type RegisterPushTokenInput,
  type UpdateProfileInput,
  type UserSearchInput,
} from '@bday/shared';
import type { Prisma } from '@prisma/client';
import { verifyPassword } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import {
  toCurrentUser,
  toGiftPreferences,
  toInterestDto,
  toPublicProfile,
  type ProfileForViewer,
  type UserWithRelations,
} from '../mappers/user.mapper';
import { privacyOrDefaults, viewerContext } from './access.service';
import { setUserInterests } from './provisioning.service';
import { revokeAllSessions } from './session.service';

const USER_INCLUDE = {
  profile: true,
  privacy: true,
  notificationPreference: true,
} satisfies Prisma.UserInclude;

const PROFILE_INCLUDE = {
  profile: true,
  privacy: true,
  interests: { include: { interest: true } },
} satisfies Prisma.UserInclude;

export async function getCurrentUser(userId: string): Promise<CurrentUser> {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: USER_INCLUDE });
  if (!user || user.deletedAt) throw new AppError('NOT_FOUND');
  return toCurrentUser(user as UserWithRelations);
}

/* ------------------------------- profile ------------------------------- */

export async function updateProfile(userId: string, input: UpdateProfileInput): Promise<CurrentUser> {
  if (input.username) {
    if ((RESERVED_USERNAMES as readonly string[]).includes(input.username)) {
      throw new AppError('USERNAME_TAKEN');
    }
    const taken = await prisma.user.findFirst({
      where: { username: input.username, NOT: { id: userId } },
      select: { id: true },
    });
    if (taken) throw new AppError('USERNAME_TAKEN');
  }

  await prisma.$transaction(async (tx) => {
    if (input.username) {
      await tx.user.update({ where: { id: userId }, data: { username: input.username } });
    }

    const profileData: Prisma.ProfileUpdateInput = {};
    if (input.displayName !== undefined) profileData.displayName = input.displayName;
    if (input.bio !== undefined) profileData.bio = input.bio;
    if (input.avatarUrl !== undefined) profileData.avatarUrl = input.avatarUrl ?? null;
    if (input.timezone !== undefined) profileData.timezone = input.timezone;
    if (input.countryCode !== undefined) profileData.countryCode = input.countryCode;
    if (input.city !== undefined) profileData.city = input.city ?? null;
    if (input.birthday) {
      profileData.birthMonth = input.birthday.month;
      profileData.birthDay = input.birthday.day;
      profileData.birthYear = input.birthday.year ?? null;
    }

    if (input.giftPreferences) {
      const current = await tx.profile.findUnique({
        where: { userId },
        select: { giftPreferences: true },
      });
      profileData.giftPreferences = mergeGiftPreferences(
        current?.giftPreferences,
        input.giftPreferences,
      );
    }

    if (Object.keys(profileData).length > 0) {
      await tx.profile.update({ where: { userId }, data: profileData });
    }

    if (input.interests) {
      await setUserInterests(tx, userId, input.interests);
    }

    // Keeping the reminder worker's clock in step with the profile's matters:
    // a stale preference timezone sends "birthday morning" pushes at the wrong
    // hour for anyone who has travelled or corrected their region.
    if (input.timezone) {
      await tx.notificationPreference.update({
        where: { userId },
        data: { timezone: input.timezone },
      });
    }
  });

  return getCurrentUser(userId);
}

function mergeGiftPreferences(
  current: Prisma.JsonValue | null | undefined,
  patch: Partial<GiftPreferencesInput>,
): Prisma.InputJsonValue {
  const base = toGiftPreferences(current);
  return {
    sizes: patch.sizes ?? base.sizes,
    favoriteColors: patch.favoriteColors ?? base.favoriteColors,
    favoriteBrands: patch.favoriteBrands ?? base.favoriteBrands,
    dislikes: patch.dislikes ?? base.dislikes,
    allergies: patch.allergies ?? base.allergies,
    notes: patch.notes !== undefined ? patch.notes : base.notes,
  } as Prisma.InputJsonValue;
}

/* ------------------------------ onboarding ------------------------------ */

export async function completeOnboarding(
  userId: string,
  input: CompleteOnboardingInput,
): Promise<CurrentUser> {
  if (input.username) {
    const taken = await prisma.user.findFirst({
      where: { username: input.username, NOT: { id: userId } },
      select: { id: true },
    });
    if (taken) throw new AppError('USERNAME_TAKEN');
  }

  await prisma.$transaction(async (tx) => {
    await tx.profile.update({
      where: { userId },
      data: {
        birthMonth: input.birthday.month,
        birthDay: input.birthday.day,
        birthYear: input.birthday.year ?? null,
        ...(input.timezone ? { timezone: input.timezone } : {}),
      },
    });

    await tx.privacySetting.update({
      where: { userId },
      data: { showBirthYear: input.showBirthYear, showAge: input.showBirthYear },
    });

    await setUserInterests(tx, userId, input.interests);

    await tx.notificationPreference.update({
      where: { userId },
      data: {
        pushEnabled: input.permissionsGranted.notifications,
        ...(input.timezone ? { timezone: input.timezone } : {}),
      },
    });

    await tx.user.update({
      where: { id: userId },
      data: {
        onboardingCompletedAt: new Date(),
        ...(input.username ? { username: input.username } : {}),
      },
    });
  });

  return getCurrentUser(userId);
}

/* ------------------------------- settings ------------------------------- */

export async function updatePrivacy(userId: string, input: PrivacySettingsInput): Promise<CurrentUser> {
  await prisma.privacySetting.update({ where: { userId }, data: input });
  return getCurrentUser(userId);
}

export async function updateNotificationPreferences(
  userId: string,
  input: NotificationPreferencesInput,
): Promise<CurrentUser> {
  const data: Prisma.NotificationPreferenceUpdateInput = {};
  if (input.reminderOffsetsDays) data.reminderOffsetsDays = input.reminderOffsetsDays;
  if (input.channels?.push !== undefined) data.pushEnabled = input.channels.push;
  if (input.channels?.email !== undefined) data.emailEnabled = input.channels.email;
  if (input.channels?.sms !== undefined) data.smsEnabled = input.channels.sms;
  if (input.mutedTypes) data.mutedTypes = input.mutedTypes;
  if (input.quietHoursStart !== undefined) data.quietHoursStart = input.quietHoursStart;
  if (input.quietHoursEnd !== undefined) data.quietHoursEnd = input.quietHoursEnd;
  if (input.timezone) data.timezone = input.timezone;

  await prisma.notificationPreference.update({ where: { userId }, data });
  return getCurrentUser(userId);
}

export async function registerPushToken(
  userId: string,
  input: RegisterPushTokenInput,
): Promise<void> {
  // The token identifies a handset, not an account: if it was last seen on a
  // different user, that row must lose it or pushes would go to the wrong person.
  await prisma.device.deleteMany({ where: { pushToken: input.token, NOT: { userId } } });

  if (input.deviceId) {
    await prisma.device.upsert({
      where: { userId_deviceId: { userId, deviceId: input.deviceId } },
      create: {
        userId,
        deviceId: input.deviceId,
        platform: input.platform,
        pushToken: input.token,
      },
      update: { pushToken: input.token, platform: input.platform, lastSeenAt: new Date() },
    });
    return;
  }

  const existing = await prisma.device.findUnique({
    where: { pushToken: input.token },
    select: { id: true },
  });
  if (existing) {
    await prisma.device.update({
      where: { id: existing.id },
      data: { userId, platform: input.platform, lastSeenAt: new Date() },
    });
    return;
  }
  await prisma.device.create({
    data: { userId, platform: input.platform, pushToken: input.token },
  });
}

export async function removePushToken(userId: string, token: string): Promise<void> {
  await prisma.device.updateMany({
    where: { userId, pushToken: token },
    data: { pushToken: null },
  });
}

/* ------------------------------ interests ------------------------------ */

export async function listInterests(): Promise<InterestDto[]> {
  const rows = await prisma.interest.findMany({
    where: { isActive: true },
    orderBy: [{ position: 'asc' }, { label: 'asc' }],
    select: { slug: true, label: true, emoji: true },
  });
  // Falls back to the static catalogue so the onboarding screen still works
  // against a database that has not been seeded yet.
  return rows.length > 0 ? rows.map(toInterestDto) : INTEREST_CATALOG.map((item) => ({ ...item }));
}

/* ---------------------------- public profiles ---------------------------- */

export async function getPublicProfile(
  viewerId: string | null,
  identifier: { userId?: string; username?: string },
): Promise<PublicProfile> {
  const user = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      ...(identifier.userId ? { id: identifier.userId } : { username: identifier.username! }),
    },
    include: PROFILE_INCLUDE,
  });
  if (!user) throw new AppError('NOT_FOUND', { message: 'That account could not be found.' });

  const context = await viewerContext(viewerId, user.id);
  if (context.isBlocked) throw new AppError('BLOCKED_BY_USER');

  const [friendship, wishlistAccess] = await Promise.all([
    viewerId ? summariseFriendship(viewerId, user.id) : Promise.resolve(null),
    resolveWishlistAccess(user.id, context.isSelf, context.isFriend, user.privacy),
  ]);

  return toPublicProfile(user as ProfileForViewer, context, { friendship, wishlistAccess });
}

async function resolveWishlistAccess(
  ownerId: string,
  isSelf: boolean,
  isFriend: boolean,
  privacy: { wishlistVisibility: 'PUBLIC' | 'FRIENDS' | 'PRIVATE' } | null,
): Promise<PublicProfile['wishlistAccess']> {
  const visibility = privacyOrDefaults(privacy as never).wishlistVisibility;
  const visible = isSelf || visibility === 'PUBLIC' || (visibility === 'FRIENDS' && isFriend);
  if (!visible) return 'HIDDEN';
  const wishlist = await prisma.wishlist.findFirst({
    where: { ownerId, deletedAt: null },
    select: { id: true },
  });
  return wishlist ? 'VISIBLE' : 'NONE';
}

/** Friendship state between the viewer and another user, for profile headers. */
export async function summariseFriendship(
  viewerId: string,
  otherId: string,
): Promise<FriendshipSummary | null> {
  if (viewerId === otherId) return null;

  const friendship = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId: viewerId, addresseeId: otherId },
        { requesterId: otherId, addresseeId: viewerId },
      ],
      status: { in: ['PENDING', 'ACCEPTED'] },
    },
    select: { id: true, status: true, requesterId: true, respondedAt: true, createdAt: true },
  });
  if (!friendship) return null;

  const tracked = await prisma.trackedBirthday.findFirst({
    where: { ownerId: viewerId, linkedUserId: otherId, deletedAt: null },
    select: {
      relationship: true,
      isFavorite: true,
      groupMembers: { select: { groupId: true } },
    },
  });

  return {
    id: friendship.id,
    status: friendship.status,
    outgoing: friendship.requesterId === viewerId,
    relationship: tracked?.relationship ?? null,
    groupIds: tracked?.groupMembers.map((member) => member.groupId) ?? [],
    isFavorite: tracked?.isFavorite ?? false,
    since: friendship.status === 'ACCEPTED' ? (friendship.respondedAt ?? friendship.createdAt).toISOString() : null,
  };
}

/* -------------------------------- search -------------------------------- */

/**
 * People search (spec §37).
 *
 * Discovery honours each user's `discoverableBy*` switches: somebody who has
 * turned off phone discovery must not surface when their number is pasted in,
 * even though we hold it.
 */
export async function searchUsers(
  viewerId: string,
  input: UserSearchInput,
): Promise<PublicProfile[]> {
  const term = input.q.trim();
  if (term.length === 0) return [];

  const looksLikePhone = /^\+?\d[\d\s()-]{6,}$/.test(term);
  const looksLikeEmail = term.includes('@');
  const normalisedPhone = looksLikePhone ? term.replace(/[\s()-]/g, '') : null;

  const blocked = await prisma.blockedUser.findMany({
    where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
    select: { blockerId: true, blockedId: true },
  });
  const excludedIds = new Set<string>([viewerId]);
  for (const row of blocked) {
    excludedIds.add(row.blockerId === viewerId ? row.blockedId : row.blockerId);
  }

  const or: Prisma.UserWhereInput[] = [
    { username: { contains: term.toLowerCase(), mode: 'insensitive' }, privacy: { discoverableByUsername: true } },
    { profile: { displayName: { contains: term, mode: 'insensitive' } } },
  ];
  if (normalisedPhone) {
    or.push({ phone: normalisedPhone, privacy: { discoverableByPhone: true } });
  }
  if (looksLikeEmail) {
    or.push({ email: term.toLowerCase(), privacy: { discoverableByEmail: true } });
  }

  const users = await prisma.user.findMany({
    where: {
      deletedAt: null,
      status: { in: ['ACTIVE', 'PENDING_VERIFICATION'] },
      id: { notIn: Array.from(excludedIds) },
      OR: or,
    },
    include: PROFILE_INCLUDE,
    take: input.limit,
    orderBy: { createdAt: 'desc' },
  });

  return Promise.all(
    users.map(async (user) => {
      const context = await viewerContext(viewerId, user.id);
      const friendship = await summariseFriendship(viewerId, user.id);
      return toPublicProfile(user as ProfileForViewer, context, { friendship });
    }),
  );
}

/* -------------------------------- blocks -------------------------------- */

export async function blockUser(viewerId: string, input: BlockUserInput): Promise<void> {
  if (viewerId === input.userId) throw new AppError('CANNOT_FRIEND_SELF', { message: 'You cannot block yourself.' });

  await prisma.$transaction(async (tx) => {
    await tx.blockedUser.upsert({
      where: { blockerId_blockedId: { blockerId: viewerId, blockedId: input.userId } },
      create: { blockerId: viewerId, blockedId: input.userId, reason: input.reason ?? null },
      update: { reason: input.reason ?? null },
    });

    // Blocking implies disconnecting; leaving the friendship would keep the
    // blocked user in birthday feeds and wishlist audiences.
    await tx.friendship.deleteMany({
      where: {
        OR: [
          { requesterId: viewerId, addresseeId: input.userId },
          { requesterId: input.userId, addresseeId: viewerId },
        ],
      },
    });
  });
}

export async function unblockUser(viewerId: string, targetId: string): Promise<void> {
  await prisma.blockedUser.deleteMany({ where: { blockerId: viewerId, blockedId: targetId } });
}

export async function listBlockedUsers(viewerId: string) {
  const rows = await prisma.blockedUser.findMany({
    where: { blockerId: viewerId },
    orderBy: { createdAt: 'desc' },
    select: {
      createdAt: true,
      reason: true,
      blocked: {
        select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } },
      },
    },
  });
  return rows.map((row) => ({
    user: {
      id: row.blocked.id,
      username: row.blocked.username,
      displayName: row.blocked.profile?.displayName ?? row.blocked.username,
      avatarUrl: row.blocked.profile?.avatarUrl ?? null,
    },
    reason: row.reason,
    blockedAt: row.createdAt.toISOString(),
  }));
}

/* --------------------------- account lifecycle --------------------------- */

export async function deactivateAccount(userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: userId }, data: { status: 'DEACTIVATED' } });
    await revokeAllSessions(userId, tx);
  });
}

/**
 * Account deletion (spec §39).
 *
 * Soft delete, not a row removal: orders, payments and gift ledgers reference
 * this user and must stay intact for the people on the other side of those
 * transactions. Personally identifying columns are cleared, so what remains is
 * a tombstone rather than a profile.
 */
export async function deleteAccount(userId: string, input: DeleteAccountInput): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, username: true },
  });
  if (!user) throw new AppError('NOT_FOUND');

  if (user.passwordHash) {
    const matches = await verifyPassword(input.confirmation, user.passwordHash);
    if (!matches) throw new AppError('INVALID_CREDENTIALS', { message: 'That password is incorrect.' });
  } else if (input.confirmation.trim().toLowerCase().replace(/^@/, '') !== user.username) {
    // Passwordless accounts (phone/OTP, Google, Apple) confirm by typing their
    // username, so a stolen access token alone cannot delete the account.
    throw new AppError('INVALID_CREDENTIALS', { message: 'Type your username exactly to confirm.' });
  }

  const stamp = Date.now().toString(36);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        status: 'DEACTIVATED',
        email: null,
        phone: null,
        passwordHash: null,
        username: `deleted_${stamp}_${user.username}`.slice(0, 24),
        suspensionReason: input.reason ?? null,
      },
    });
    await tx.profile.updateMany({
      where: { userId },
      data: { displayName: 'Deleted account', avatarUrl: null, bio: null, giftPreferences: {} },
    });
    await tx.device.deleteMany({ where: { userId } });
    await tx.authIdentity.deleteMany({ where: { userId } });
    await revokeAllSessions(userId, tx);
    await tx.auditLog.create({
      data: { actorId: userId, action: 'user.delete', targetType: 'USER', targetId: userId, reason: input.reason ?? null },
    });
  });
}

/**
 * Data export (spec §39). Returns the caller's own rows as plain JSON.
 */
export async function exportAccountData(userId: string): Promise<Record<string, unknown>> {
  const [user, wishlists, tracked, wishes, giftHistory, orders, memories] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: { profile: true, privacy: true, notificationPreference: true, interests: { include: { interest: true } } },
    }),
    prisma.wishlist.findMany({ where: { ownerId: userId }, include: { items: true } }),
    prisma.trackedBirthday.findMany({ where: { ownerId: userId, deletedAt: null } }),
    prisma.birthdayMessage.findMany({ where: { recipientUserId: userId } }),
    prisma.giftHistoryEntry.findMany({ where: { userId } }),
    prisma.order.findMany({ where: { buyerId: userId }, include: { items: true } }),
    prisma.memory.findMany({ where: { userId }, include: { media: true } }),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    account: user
      ? {
          id: user.id,
          email: user.email,
          phone: user.phone,
          username: user.username,
          createdAt: user.createdAt,
          profile: user.profile,
          privacy: user.privacy,
          notificationPreferences: user.notificationPreference,
          interests: user.interests.map((link) => link.interest.slug),
        }
      : null,
    wishlists,
    trackedBirthdays: tracked,
    birthdayMessages: wishes,
    giftHistory,
    orders,
    memories,
  };
}
