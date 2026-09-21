import {
  LIMITS,
  type CreateWishlistInput,
  type ReorderWishlistItemsInput,
  type UpdateWishlistInput,
  type UpdateWishlistItemInput,
  type WishlistDto,
  type WishlistItemDto,
  type WishlistItemInput,
} from '@bday/shared';
import type { Prisma } from '@prisma/client';
import { shareSlug } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { prisma, type Db } from '../lib/prisma';
import {
  WISHLIST_ITEM_INCLUDE,
  shareUrl,
  toWishlistDto,
  toWishlistItemDto,
  type ItemViewerContext,
  type WishlistItemRow,
  type WishlistRow,
} from '../mappers/wishlist.mapper';
import { RealtimeEvent, emitToWishlist } from '../realtime/emitter';
import { canSee, privacyOrDefaults, viewerContext } from './access.service';
import { notify } from './notification.service';

/**
 * Wishlists (spec §10, §11, §12).
 *
 * Read access is decided by two settings at once — the list's own `visibility`
 * and the owner's global `wishlistVisibility` — and the stricter of the two
 * wins. That lets someone flip one switch in settings to hide every list
 * without editing each one.
 */

const OWNER_SELECT = {
  id: true,
  username: true,
  profile: { select: { displayName: true, avatarUrl: true } },
} as const;

async function loadWishlistOrThrow(wishlistId: string, db: Db = prisma) {
  const wishlist = await db.wishlist.findFirst({
    where: { id: wishlistId, deletedAt: null },
    include: { owner: { select: OWNER_SELECT } },
  });
  if (!wishlist) throw new AppError('NOT_FOUND', { message: 'That wishlist no longer exists.' });
  return wishlist;
}

async function assertOwner(wishlistId: string, userId: string, db: Db = prisma) {
  const wishlist = await db.wishlist.findFirst({
    where: { id: wishlistId, ownerId: userId, deletedAt: null },
    select: { id: true, ownerId: true },
  });
  if (!wishlist) throw new AppError('NOT_FOUND', { message: 'That wishlist no longer exists.' });
  return wishlist;
}

/** Resolves whether `viewerId` may read `wishlist`, throwing if not. */
async function assertCanView(
  wishlist: { id: string; ownerId: string; visibility: 'PUBLIC' | 'FRIENDS' | 'PRIVATE' },
  viewerId: string | null,
): Promise<ItemViewerContext> {
  if (viewerId === wishlist.ownerId) return { viewerId, isOwner: true };

  const context = await viewerContext(viewerId, wishlist.ownerId);
  if (context.isBlocked) throw new AppError('NOT_FOUND');

  const privacy = privacyOrDefaults(
    await prisma.privacySetting.findUnique({
      where: { userId: wishlist.ownerId },
      select: {
        profileVisibility: true,
        birthdayVisibility: true,
        wishlistVisibility: true,
        giftHistoryVisibility: true,
        showAge: true,
        showBirthYear: true,
        discoverableByPhone: true,
        discoverableByEmail: true,
        discoverableByUsername: true,
        publicPage: true,
        publicGifting: true,
      },
    }),
  );

  // A published link-in-bio page is meant to be read by anyone holding the
  // link, so the list is readable here too — they can already see it on the
  // page. Claiming a gift is separate, and still needs `publicGifting`.
  // Who reserved what stays hidden either way; `ItemViewerContext` governs that.
  if (privacy.publicPage && wishlist.visibility !== 'PRIVATE') {
    return { viewerId, isOwner: false };
  }

  // Stricter of the two wins.
  const effective =
    privacy.wishlistVisibility === 'PRIVATE' || wishlist.visibility === 'PRIVATE'
      ? 'PRIVATE'
      : privacy.wishlistVisibility === 'FRIENDS' || wishlist.visibility === 'FRIENDS'
        ? 'FRIENDS'
        : 'PUBLIC';

  if (!canSee(effective, context)) throw new AppError('WISHLIST_PRIVATE');
  return { viewerId, isOwner: false };
}

/** Group gifts this viewer has already backed, to set `hasContributed`. */
async function contributedGroupGiftIds(viewerId: string | null): Promise<Set<string>> {
  if (!viewerId) return new Set();
  const rows = await prisma.giftContribution.findMany({
    where: { contributorId: viewerId, status: { in: ['PENDING', 'SUCCESSFUL'] } },
    select: { groupGiftId: true },
  });
  return new Set(rows.map((row) => row.groupGiftId));
}

/* ------------------------------- reading ------------------------------- */

export async function listMyWishlists(userId: string): Promise<WishlistDto[]> {
  const wishlists = await prisma.wishlist.findMany({
    where: { ownerId: userId, deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    include: {
      owner: { select: OWNER_SELECT },
      _count: { select: { items: { where: { deletedAt: null } } } },
    },
  });

  return wishlists.map((wishlist) =>
    toWishlistDto(wishlist as unknown as WishlistRow, { viewerId: userId, isOwner: true }, {
      itemCount: wishlist._count.items,
    }),
  );
}

export async function getWishlist(viewerId: string | null, wishlistId: string): Promise<WishlistDto> {
  const wishlist = await loadWishlistOrThrow(wishlistId);
  const context = await assertCanView(wishlist, viewerId);

  const items = (await prisma.wishlistItem.findMany({
    where: { wishlistId, deletedAt: null },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: WISHLIST_ITEM_INCLUDE,
  })) as unknown as WishlistItemRow[];

  if (!context.isOwner) {
    await prisma.wishlist.update({
      where: { id: wishlistId },
      data: { viewCount: { increment: 1 } },
    });
  }

  return toWishlistDto({ ...wishlist, items } as unknown as WishlistRow, context, {
    contributedGroupGiftIds: await contributedGroupGiftIds(viewerId),
  });
}

/** The default list for a user, which is what a gifter opens from a profile. */
export async function getUserWishlist(viewerId: string | null, ownerId: string): Promise<WishlistDto> {
  const wishlist = await prisma.wishlist.findFirst({
    where: { ownerId, deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  if (!wishlist) throw new AppError('NOT_FOUND', { message: 'They have not created a wishlist yet.' });
  return getWishlist(viewerId, wishlist.id);
}

/**
 * Public share link (spec §12).
 *
 * The slug is unguessable, but it is not a bearer credential for private
 * lists: a PRIVATE list stays private even when its link is pasted somewhere.
 */
export async function getWishlistBySlug(viewerId: string | null, slug: string): Promise<WishlistDto> {
  const wishlist = await prisma.wishlist.findFirst({
    where: { shareSlug: slug, deletedAt: null },
    include: { owner: { select: OWNER_SELECT } },
  });
  if (!wishlist) throw new AppError('NOT_FOUND', { message: 'That wishlist link is not valid.' });

  if (wishlist.visibility === 'PRIVATE' && viewerId !== wishlist.ownerId) {
    throw new AppError('WISHLIST_PRIVATE');
  }
  // A share link implies the owner meant this to be openable, so FRIENDS lists
  // opened by slug are readable by anyone holding the link.
  const context: ItemViewerContext = {
    viewerId,
    isOwner: viewerId === wishlist.ownerId,
  };

  const items = (await prisma.wishlistItem.findMany({
    where: { wishlistId: wishlist.id, deletedAt: null },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
    include: WISHLIST_ITEM_INCLUDE,
  })) as unknown as WishlistItemRow[];

  if (!context.isOwner) {
    await prisma.wishlist.update({ where: { id: wishlist.id }, data: { viewCount: { increment: 1 } } });
  }

  return toWishlistDto({ ...wishlist, items } as unknown as WishlistRow, context, {
    contributedGroupGiftIds: await contributedGroupGiftIds(viewerId),
  });
}

/* ------------------------------ mutations ------------------------------ */

export async function createWishlist(userId: string, input: CreateWishlistInput): Promise<WishlistDto> {
  const [count, user] = await Promise.all([
    prisma.wishlist.count({ where: { ownerId: userId, deletedAt: null } }),
    prisma.user.findUnique({ where: { id: userId }, select: { isPremium: true } }),
  ]);
  const cap = user?.isPremium ? LIMITS.wishlistsPerUser.premium : LIMITS.wishlistsPerUser.free;
  if (count >= cap) {
    throw new AppError('FORBIDDEN', {
      message: `You can have up to ${cap} wishlists. Upgrade for more.`,
    });
  }

  const wishlist = await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.wishlist.updateMany({ where: { ownerId: userId }, data: { isDefault: false } });
    }
    return tx.wishlist.create({
      data: {
        ownerId: userId,
        title: input.title,
        description: input.description ?? null,
        visibility: input.visibility,
        isDefault: input.isDefault || count === 0,
        shareSlug: shareSlug(),
      },
      include: { owner: { select: OWNER_SELECT } },
    });
  });

  return toWishlistDto(wishlist as unknown as WishlistRow, { viewerId: userId, isOwner: true }, { itemCount: 0 });
}

export async function updateWishlist(
  userId: string,
  wishlistId: string,
  input: UpdateWishlistInput,
): Promise<WishlistDto> {
  await assertOwner(wishlistId, userId);

  await prisma.$transaction(async (tx) => {
    if (input.isDefault) {
      await tx.wishlist.updateMany({ where: { ownerId: userId }, data: { isDefault: false } });
    }
    await tx.wishlist.update({
      where: { id: wishlistId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description ?? null } : {}),
        ...(input.visibility !== undefined ? { visibility: input.visibility } : {}),
        ...(input.isDefault !== undefined ? { isDefault: input.isDefault } : {}),
      },
    });
  });

  return getWishlist(userId, wishlistId);
}

export async function deleteWishlist(userId: string, wishlistId: string): Promise<void> {
  const wishlist = await prisma.wishlist.findFirst({
    where: { id: wishlistId, ownerId: userId, deletedAt: null },
    select: { id: true, isDefault: true },
  });
  if (!wishlist) throw new AppError('NOT_FOUND');

  const remaining = await prisma.wishlist.count({
    where: { ownerId: userId, deletedAt: null, NOT: { id: wishlistId } },
  });
  if (remaining === 0) {
    throw new AppError('CONFLICT', { message: 'You need at least one wishlist.' });
  }

  // An active reservation means someone is mid-purchase; deleting the list
  // under them would lose the claim that stops a duplicate gift.
  const reserved = await prisma.giftReservation.count({
    where: {
      status: { in: ['RESERVED', 'PURCHASED'] },
      wishlistItem: { wishlistId, deletedAt: null },
    },
  });
  if (reserved > 0) {
    throw new AppError('CONFLICT', {
      message: 'Someone is already getting something from this list. Archive the items instead.',
    });
  }

  await prisma.$transaction(async (tx) => {
    await tx.wishlist.update({ where: { id: wishlistId }, data: { deletedAt: new Date() } });
    if (wishlist.isDefault) {
      const next = await tx.wishlist.findFirst({
        where: { ownerId: userId, deletedAt: null },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (next) await tx.wishlist.update({ where: { id: next.id }, data: { isDefault: true } });
    }
  });
}

export async function rotateShareSlug(userId: string, wishlistId: string): Promise<{ shareSlug: string; shareUrl: string }> {
  await assertOwner(wishlistId, userId);
  const updated = await prisma.wishlist.update({
    where: { id: wishlistId },
    data: { shareSlug: shareSlug() },
    select: { shareSlug: true },
  });
  return { shareSlug: updated.shareSlug, shareUrl: shareUrl(updated.shareSlug) };
}

/* --------------------------------- items --------------------------------- */

async function resolveTargetWishlist(userId: string, wishlistId?: string): Promise<string> {
  if (wishlistId) {
    await assertOwner(wishlistId, userId);
    return wishlistId;
  }
  const existing = await prisma.wishlist.findFirst({
    where: { ownerId: userId, deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  if (existing) return existing.id;

  // A user who deleted their way to zero lists still expects "add to wishlist"
  // to work, so one is recreated rather than erroring.
  const created = await prisma.wishlist.create({
    data: { ownerId: userId, title: 'My wishlist', isDefault: true, shareSlug: shareSlug() },
    select: { id: true },
  });
  return created.id;
}

export async function addWishlistItem(
  userId: string,
  input: WishlistItemInput,
): Promise<WishlistItemDto> {
  const wishlistId = await resolveTargetWishlist(userId, input.wishlistId);

  const [count, user] = await Promise.all([
    prisma.wishlistItem.count({ where: { wishlistId, deletedAt: null } }),
    prisma.user.findUnique({ where: { id: userId }, select: { isPremium: true } }),
  ]);
  const cap = user?.isPremium ? LIMITS.wishlistItemsPerList.premium : LIMITS.wishlistItemsPerList.free;
  if (count >= cap) {
    throw new AppError('FORBIDDEN', { message: `A wishlist can hold up to ${cap} items.` });
  }

  if (input.productId) {
    const product = await prisma.product.findFirst({
      where: { id: input.productId, deletedAt: null },
      select: { id: true },
    });
    if (!product) throw new AppError('NOT_FOUND', { message: 'That product is no longer available.' });
  }

  const item = (await prisma.wishlistItem.create({
    data: {
      wishlistId,
      name: input.name,
      description: input.description ?? null,
      imageUrl: input.imageUrl ?? null,
      priceMinor: input.priceMinor ?? null,
      currency: input.currency ?? 'KES',
      productUrl: input.productUrl ?? null,
      merchant: input.merchant ?? null,
      category: input.category ?? null,
      priority: input.priority,
      size: input.size ?? null,
      color: input.color ?? null,
      quantity: input.quantity,
      notes: input.notes ?? null,
      preferredVendorId: input.preferredVendorId ?? null,
      productId: input.productId ?? null,
      position: count,
    },
    include: WISHLIST_ITEM_INCLUDE,
  })) as unknown as WishlistItemRow;

  const dto = toWishlistItemDto(item, { viewerId: userId, isOwner: true });
  emitToWishlist(wishlistId, RealtimeEvent.WISHLIST_ITEM_ADDED, dto);
  await notifyFriendsOfNewItem(userId, item.name);

  return dto;
}

/**
 * Tells close friends that a new wish appeared (spec §28).
 *
 * Limited to favourites and people whose birthday-gifting relationship is
 * closest, because broadcasting every addition to every contact is how a
 * helpful nudge turns into spam.
 */
async function notifyFriendsOfNewItem(ownerId: string, itemName: string): Promise<void> {
  const owner = await prisma.user.findUnique({
    where: { id: ownerId },
    select: { username: true, profile: { select: { displayName: true, avatarUrl: true } } },
  });
  const name = owner?.profile?.displayName ?? owner?.username ?? 'A friend';

  const watchers = await prisma.trackedBirthday.findMany({
    where: { linkedUserId: ownerId, deletedAt: null, isFavorite: true },
    select: { ownerId: true },
    take: 50,
  });

  for (const watcher of watchers) {
    await notify({
      userId: watcher.ownerId,
      type: 'WISHLIST_UPDATED',
      title: `${name} added something new`,
      body: `${itemName} is now on their wishlist.`,
      deepLink: `wishlist/user/${ownerId}`,
      data: { ownerId },
      imageUrl: owner?.profile?.avatarUrl ?? null,
      silent: true,
    }).catch(() => undefined);
  }
}

export async function updateWishlistItem(
  userId: string,
  itemId: string,
  input: UpdateWishlistItemInput,
): Promise<WishlistItemDto> {
  const item = await prisma.wishlistItem.findFirst({
    where: { id: itemId, deletedAt: null, wishlist: { ownerId: userId, deletedAt: null } },
    select: { id: true, wishlistId: true, reservedQuantity: true },
  });
  if (!item) throw new AppError('WISHLIST_ITEM_NOT_FOUND');

  if (input.quantity !== undefined && input.quantity < item.reservedQuantity) {
    // Silently shrinking below what gifters have claimed would strand a
    // reservation that no longer has an item to attach to.
    throw new AppError('CONFLICT', {
      message: 'Someone is already getting some of these. Cancel their claim first.',
    });
  }

  const data: Prisma.WishlistItemUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.description !== undefined) data.description = input.description ?? null;
  if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl ?? null;
  if (input.priceMinor !== undefined) data.priceMinor = input.priceMinor ?? null;
  if (input.currency !== undefined) data.currency = input.currency;
  if (input.productUrl !== undefined) data.productUrl = input.productUrl ?? null;
  if (input.merchant !== undefined) data.merchant = input.merchant ?? null;
  if (input.category !== undefined) data.category = input.category ?? null;
  if (input.priority !== undefined) data.priority = input.priority;
  if (input.size !== undefined) data.size = input.size ?? null;
  if (input.color !== undefined) data.color = input.color ?? null;
  if (input.quantity !== undefined) data.quantity = input.quantity;
  if (input.notes !== undefined) data.notes = input.notes ?? null;

  const updated = (await prisma.wishlistItem.update({
    where: { id: itemId },
    data,
    include: WISHLIST_ITEM_INCLUDE,
  })) as unknown as WishlistItemRow;

  const dto = toWishlistItemDto(updated, { viewerId: userId, isOwner: true });
  emitToWishlist(item.wishlistId, RealtimeEvent.WISHLIST_ITEM_UPDATED, dto);
  return dto;
}

export async function deleteWishlistItem(userId: string, itemId: string): Promise<void> {
  const item = await prisma.wishlistItem.findFirst({
    where: { id: itemId, deletedAt: null, wishlist: { ownerId: userId, deletedAt: null } },
    select: { id: true, wishlistId: true },
  });
  if (!item) throw new AppError('WISHLIST_ITEM_NOT_FOUND');

  const active = await prisma.giftReservation.findMany({
    where: { wishlistItemId: itemId, status: { in: ['RESERVED', 'PURCHASED'] } },
    select: { reserverId: true },
  });

  await prisma.wishlistItem.update({
    where: { id: itemId },
    data: { deletedAt: new Date(), status: 'ARCHIVED' },
  });

  emitToWishlist(item.wishlistId, RealtimeEvent.WISHLIST_ITEM_REMOVED, { id: itemId });

  // Gifters who had claimed it need to know before they buy something that is
  // no longer wanted — and the owner must not learn that they were notified.
  for (const reservation of active) {
    await notify({
      userId: reservation.reserverId,
      type: 'GIFT_RESERVATION_CANCELLED',
      title: 'A gift you claimed was removed',
      body: 'The item you reserved is no longer on their wishlist.',
      deepLink: 'gifts/reservations',
      data: { wishlistItemId: itemId },
    }).catch(() => undefined);
  }
}

export async function reorderWishlistItems(
  userId: string,
  wishlistId: string,
  input: ReorderWishlistItemsInput,
): Promise<void> {
  await assertOwner(wishlistId, userId);

  const owned = await prisma.wishlistItem.findMany({
    where: { wishlistId, deletedAt: null, id: { in: input.itemIds } },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((item) => item.id));

  await prisma.$transaction(
    input.itemIds
      .filter((id) => ownedIds.has(id))
      .map((id, index) =>
        prisma.wishlistItem.update({ where: { id }, data: { position: index } }),
      ),
  );
}

/** Single item read, used by the gift flow before reserving. */
export async function getWishlistItem(
  viewerId: string | null,
  itemId: string,
): Promise<WishlistItemDto> {
  const item = (await prisma.wishlistItem.findFirst({
    where: { id: itemId, deletedAt: null },
    include: { ...WISHLIST_ITEM_INCLUDE, wishlist: { select: { id: true, ownerId: true, visibility: true } } },
  })) as unknown as (WishlistItemRow & { wishlist: { id: string; ownerId: string; visibility: 'PUBLIC' | 'FRIENDS' | 'PRIVATE' } }) | null;
  if (!item) throw new AppError('WISHLIST_ITEM_NOT_FOUND');

  const context = await assertCanView(item.wishlist, viewerId);
  return toWishlistItemDto(item, context, {
    contributedGroupGiftIds: await contributedGroupGiftIds(viewerId),
  });
}

export { assertCanView as assertCanViewWishlist };
