import type { Visibility } from '@prisma/client';
import { AppError } from '../lib/errors';
import { prisma, type Db } from '../lib/prisma';

/**
 * Relationship and visibility checks (spec §39).
 *
 * Every read of somebody else's data goes through here. Keeping the rules in
 * one place is what makes "wishlist visibility" mean the same thing on the
 * profile screen, in search results, in the share-link handler and in the AI
 * assistant's context builder — a rule re-implemented per route is a rule that
 * eventually disagrees with itself.
 */

/** True when an accepted friendship exists in either direction. */
export async function areFriends(a: string, b: string, db: Db = prisma): Promise<boolean> {
  if (a === b) return true;
  const friendship = await db.friendship.findFirst({
    where: {
      status: 'ACCEPTED',
      OR: [
        { requesterId: a, addresseeId: b },
        { requesterId: b, addresseeId: a },
      ],
    },
    select: { id: true },
  });
  return friendship !== null;
}

/** True when either user has blocked the other. */
export async function isBlockedEitherWay(a: string, b: string, db: Db = prisma): Promise<boolean> {
  if (a === b) return false;
  const block = await db.blockedUser.findFirst({
    where: {
      OR: [
        { blockerId: a, blockedId: b },
        { blockerId: b, blockedId: a },
      ],
    },
    select: { blockerId: true },
  });
  return block !== null;
}

/**
 * Blocking is deliberately indistinguishable from "does not exist".
 *
 * Returning FORBIDDEN would confirm to a blocked user that the account is
 * still there and that they were blocked specifically; NOT_FOUND leaks nothing.
 */
export async function assertNotBlocked(viewerId: string, targetId: string, db: Db = prisma): Promise<void> {
  if (await isBlockedEitherWay(viewerId, targetId, db)) {
    throw new AppError('BLOCKED_BY_USER');
  }
}

export interface ViewerContext {
  viewerId: string | null;
  isSelf: boolean;
  isFriend: boolean;
  isBlocked: boolean;
}

export async function viewerContext(
  viewerId: string | null,
  ownerId: string,
  db: Db = prisma,
): Promise<ViewerContext> {
  if (!viewerId) {
    return { viewerId: null, isSelf: false, isFriend: false, isBlocked: false };
  }
  if (viewerId === ownerId) {
    return { viewerId, isSelf: true, isFriend: true, isBlocked: false };
  }
  const [isFriend, isBlocked] = await Promise.all([
    areFriends(viewerId, ownerId, db),
    isBlockedEitherWay(viewerId, ownerId, db),
  ]);
  return { viewerId, isSelf: false, isFriend, isBlocked };
}

/** Resolves a single `Visibility` value against a viewer context. */
export function canSee(visibility: Visibility, context: ViewerContext): boolean {
  if (context.isBlocked) return false;
  if (context.isSelf) return true;
  switch (visibility) {
    case 'PUBLIC':
      return true;
    case 'FRIENDS':
      return context.isFriend;
    case 'PRIVATE':
      return false;
    default:
      return false;
  }
}

/** Privacy row with safe defaults, for users who have never touched settings. */
export const DEFAULT_PRIVACY = {
  profileVisibility: 'FRIENDS',
  birthdayVisibility: 'FRIENDS',
  wishlistVisibility: 'FRIENDS',
  giftHistoryVisibility: 'PRIVATE',
  showAge: true,
  showBirthYear: true,
  discoverableByPhone: true,
  discoverableByEmail: true,
  discoverableByUsername: true,
} as const;

export type PrivacyShape = {
  profileVisibility: Visibility;
  birthdayVisibility: Visibility;
  wishlistVisibility: Visibility;
  giftHistoryVisibility: Visibility;
  showAge: boolean;
  showBirthYear: boolean;
  discoverableByPhone: boolean;
  discoverableByEmail: boolean;
  discoverableByUsername: boolean;
};

export function privacyOrDefaults(privacy: PrivacyShape | null | undefined): PrivacyShape {
  return privacy ?? (DEFAULT_PRIVACY as unknown as PrivacyShape);
}

/**
 * Spec §58 rule 2 — the birthday person must not see who reserved what.
 *
 * Used by the wishlist, reservation and group-gift services before attaching
 * any reservation or contributor detail to a response.
 */
export function isGiftSecretFrom(viewerId: string | null, beneficiaryId: string | null): boolean {
  return viewerId != null && beneficiaryId != null && viewerId === beneficiaryId;
}

/** Loads a user for display, or throws NOT_FOUND for deleted/missing rows. */
export async function requireActiveUser(userId: string, db: Db = prisma) {
  const user = await db.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: {
      id: true,
      username: true,
      status: true,
      isPremium: true,
      profile: { select: { displayName: true, avatarUrl: true } },
    },
  });
  if (!user) throw new AppError('NOT_FOUND', { message: 'That account could not be found.' });
  return user;
}
