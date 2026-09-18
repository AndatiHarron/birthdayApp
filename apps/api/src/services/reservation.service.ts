import type { ItemReservationView, ReserveItemInput, UpdateReservationInput } from '@bday/shared';
import { AppError } from '../lib/errors';
import { prisma, serializableTransaction, type Tx } from '../lib/prisma';
import { toItemReservationView } from '../mappers/wishlist.mapper';
import { RealtimeEvent, emitToUser, emitToWishlist } from '../realtime/emitter';
import { assertCanViewWishlist } from './wishlist.service';
import { notify } from './notification.service';

/**
 * Gift reservations (spec §13, §58 rules 1 and 2).
 *
 * Two properties have to hold no matter what:
 *
 *   1. two gifters tapping "I'll get this" at the same instant must not both
 *      succeed on a single-quantity item, and
 *   2. the wishlist owner must never be able to read these rows.
 *
 * The first is enforced with a serializable transaction plus a row lock on the
 * wishlist item, and by keeping `reservedQuantity` on the item itself so the
 * check and the increment touch the same row. The second is enforced here and
 * in the mapper, not in the UI.
 */

interface ItemLockRow {
  id: string;
  wishlist_id: string;
  owner_id: string;
  quantity: number;
  reserved_quantity: number;
  name: string;
  deleted_at: Date | null;
}

/**
 * Locks the item row for the rest of the transaction.
 *
 * `SELECT … FOR UPDATE` is what makes the read-then-write below atomic: a
 * concurrent reserver blocks here rather than reading a stale
 * `reservedQuantity` and overwriting our increment.
 */
async function lockItem(tx: Tx, itemId: string): Promise<ItemLockRow> {
  // Tables are @@map'd to snake_case but columns keep Prisma's camelCase names,
  // so they must be quoted and aliased here.
  const rows = await tx.$queryRaw<ItemLockRow[]>`
    SELECT i.id,
           i."wishlistId"       AS wishlist_id,
           w."ownerId"          AS owner_id,
           i.quantity,
           i."reservedQuantity" AS reserved_quantity,
           i.name,
           i."deletedAt"        AS deleted_at
      FROM wishlist_items i
      JOIN wishlists w ON w.id = i."wishlistId"
     WHERE i.id = ${itemId}
     FOR UPDATE OF i
  `;
  const row = rows[0];
  if (!row || row.deleted_at) throw new AppError('WISHLIST_ITEM_NOT_FOUND');
  return row;
}

export interface ReserveResult {
  reservationId: string;
  itemId: string;
  wishlistId: string;
  view: ItemReservationView;
}

export async function reserveItem(
  reserverId: string,
  itemId: string,
  input: ReserveItemInput,
): Promise<ReserveResult> {
  // Authorisation runs outside the transaction: it does several reads of its
  // own, and holding a row lock across them would widen the contention window
  // for no benefit.
  const item = await prisma.wishlistItem.findFirst({
    where: { id: itemId, deletedAt: null },
    select: { id: true, wishlist: { select: { id: true, ownerId: true, visibility: true } } },
  });
  if (!item) throw new AppError('WISHLIST_ITEM_NOT_FOUND');
  if (item.wishlist.ownerId === reserverId) throw new AppError('CANNOT_RESERVE_OWN_ITEM');
  await assertCanViewWishlist(item.wishlist, reserverId);

  const result = await serializableTransaction(async (tx) => {
    const locked = await lockItem(tx, itemId);

    const existing = await tx.giftReservation.findFirst({
      where: { wishlistItemId: itemId, reserverId, status: { not: 'CANCELLED' } },
      select: { id: true },
    });
    if (existing) {
      throw new AppError('GIFT_ALREADY_RESERVED', {
        message: 'You have already claimed this gift.',
      });
    }

    const remaining = locked.quantity - locked.reserved_quantity;
    if (remaining <= 0) throw new AppError('GIFT_ALREADY_RESERVED');
    if (input.quantity > remaining) {
      throw new AppError('ITEM_QUANTITY_EXHAUSTED', {
        message:
          remaining === 1
            ? 'Only one of these is still unclaimed.'
            : `Only ${remaining} of these are still unclaimed.`,
      });
    }

    const reservation = await tx.giftReservation.create({
      data: {
        wishlistItemId: itemId,
        reserverId,
        quantity: input.quantity,
        note: input.note ?? null,
        isAnonymous: input.isAnonymous,
      },
      include: {
        reserver: {
          select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } },
        },
      },
    });

    const reservedQuantity = locked.reserved_quantity + input.quantity;
    await tx.wishlistItem.update({
      where: { id: itemId },
      data: {
        reservedQuantity,
        status: reservedQuantity >= locked.quantity ? 'RESERVED' : 'AVAILABLE',
      },
    });

    return { reservation, wishlistId: locked.wishlist_id, itemName: locked.name };
  });

  const view = toItemReservationView([result.reservation], { viewerId: reserverId, isOwner: false })!;

  // Broadcast to the wishlist room so every other gifter's screen flips to
  // "Someone is already getting this" immediately (spec §43).
  emitToWishlist(result.wishlistId, RealtimeEvent.RESERVATION_CHANGED, {
    wishlistItemId: itemId,
    status: 'RESERVED',
  });

  await notify({
    userId: reserverId,
    type: 'GIFT_RESERVED',
    title: 'Gift reserved',
    body: `You have claimed “${result.itemName}”. Nobody else can now.`,
    deepLink: 'gifts/reservations',
    data: { reservationId: result.reservation.id, wishlistItemId: itemId },
    silent: true,
  }).catch(() => undefined);

  return {
    reservationId: result.reservation.id,
    itemId,
    wishlistId: result.wishlistId,
    view,
  };
}

/**
 * Releases a claim.
 *
 * Only the reserver may do this. The wishlist owner explicitly may not —
 * being able to cancel a reservation would tell them one exists.
 */
export async function cancelReservation(reserverId: string, reservationId: string): Promise<void> {
  const { wishlistId, itemId } = await serializableTransaction(async (tx) => {
    const reservation = await tx.giftReservation.findUnique({
      where: { id: reservationId },
      select: { id: true, reserverId: true, status: true, quantity: true, wishlistItemId: true },
    });
    if (!reservation) throw new AppError('NOT_FOUND', { message: 'That reservation no longer exists.' });
    if (reservation.reserverId !== reserverId) throw new AppError('NOT_RESERVATION_OWNER');
    if (reservation.status === 'CANCELLED') throw new AppError('GIFT_NOT_RESERVED');
    if (reservation.status === 'DELIVERED') {
      throw new AppError('CONFLICT', { message: 'This gift has already been delivered.' });
    }

    const locked = await lockItem(tx, reservation.wishlistItemId);

    await tx.giftReservation.update({
      where: { id: reservationId },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });

    const reservedQuantity = Math.max(0, locked.reserved_quantity - reservation.quantity);
    await tx.wishlistItem.update({
      where: { id: locked.id },
      data: {
        reservedQuantity,
        status: reservedQuantity >= locked.quantity ? 'RESERVED' : 'AVAILABLE',
      },
    });

    return { wishlistId: locked.wishlist_id, itemId: locked.id };
  });

  emitToWishlist(wishlistId, RealtimeEvent.RESERVATION_CHANGED, {
    wishlistItemId: itemId,
    status: 'AVAILABLE',
  });
}

/**
 * Moves a claim along the RESERVED → PURCHASED → DELIVERED pipeline.
 *
 * Reaching DELIVERED is what finally lets the owner see the gift: it writes the
 * gift-history entries for both sides and tells the recipient a gift arrived.
 */
export async function updateReservation(
  reserverId: string,
  reservationId: string,
  input: UpdateReservationInput,
): Promise<void> {
  if (input.status === 'CANCELLED') {
    await cancelReservation(reserverId, reservationId);
    return;
  }

  const reservation = await prisma.giftReservation.findUnique({
    where: { id: reservationId },
    select: {
      id: true,
      reserverId: true,
      status: true,
      isAnonymous: true,
      wishlistItem: {
        select: {
          id: true,
          name: true,
          imageUrl: true,
          priceMinor: true,
          currency: true,
          wishlistId: true,
          wishlist: { select: { ownerId: true } },
        },
      },
    },
  });
  if (!reservation) throw new AppError('NOT_FOUND');
  if (reservation.reserverId !== reserverId) throw new AppError('NOT_RESERVATION_OWNER');
  if (reservation.status === 'CANCELLED') throw new AppError('GIFT_NOT_RESERVED');

  const ownerId = reservation.wishlistItem.wishlist.ownerId;

  await prisma.$transaction(async (tx) => {
    await tx.giftReservation.update({
      where: { id: reservationId },
      data: {
        status: input.status,
        ...(input.note !== undefined ? { note: input.note ?? null } : {}),
        ...(input.status === 'PURCHASED' ? { purchasedAt: new Date() } : {}),
        ...(input.status === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
      },
    });

    await tx.wishlistItem.update({
      where: { id: reservation.wishlistItem.id },
      data: { status: input.status === 'DELIVERED' ? 'DELIVERED' : 'PURCHASED' },
    });

    if (input.status === 'DELIVERED') {
      await writeGiftHistoryPair(tx, {
        reservationId,
        ownerId,
        reserverId,
        isAnonymous: reservation.isAnonymous,
        title: reservation.wishlistItem.name,
        imageUrl: reservation.wishlistItem.imageUrl,
        priceMinor: reservation.wishlistItem.priceMinor,
        currency: reservation.wishlistItem.currency,
      });
    }
  });

  emitToWishlist(reservation.wishlistItem.wishlistId, RealtimeEvent.RESERVATION_CHANGED, {
    wishlistItemId: reservation.wishlistItem.id,
    status: input.status,
  });

  if (input.status === 'DELIVERED') {
    const giver = await prisma.user.findUnique({
      where: { id: reserverId },
      select: { username: true, profile: { select: { displayName: true } } },
    });
    const giverName = reservation.isAnonymous
      ? 'Someone'
      : giver?.profile?.displayName ?? giver?.username ?? 'Someone';

    await notify({
      userId: ownerId,
      type: 'GIFT_RECEIVED',
      title: '🎁 You received a gift!',
      body: `${giverName} got you “${reservation.wishlistItem.name}”.`,
      deepLink: 'gifts/received',
      data: { reservationId, wishlistItemId: reservation.wishlistItem.id },
    }).catch(() => undefined);

    emitToUser(ownerId, RealtimeEvent.RESERVATION_CHANGED, {
      wishlistItemId: reservation.wishlistItem.id,
      status: 'DELIVERED',
    });
  }
}

/**
 * Writes the "received" and "sent" ledger rows for one completed gift.
 *
 * The unique index on (userId, source, sourceId, direction) makes this safe to
 * call twice — a retried delivery update must not duplicate someone's history.
 */
async function writeGiftHistoryPair(
  tx: Tx,
  input: {
    reservationId: string;
    ownerId: string;
    reserverId: string;
    isAnonymous: boolean;
    title: string;
    imageUrl: string | null;
    priceMinor: number | null;
    currency: string;
  },
): Promise<void> {
  const [recipient, giver] = await Promise.all([
    tx.user.findUnique({
      where: { id: input.ownerId },
      select: { username: true, profile: { select: { displayName: true } } },
    }),
    tx.user.findUnique({
      where: { id: input.reserverId },
      select: { username: true, profile: { select: { displayName: true } } },
    }),
  ]);

  const year = new Date().getFullYear();

  await tx.giftHistoryEntry.createMany({
    data: [
      {
        userId: input.ownerId,
        direction: 'RECEIVED',
        title: input.title,
        imageUrl: input.imageUrl,
        counterpartyUserId: input.isAnonymous ? null : input.reserverId,
        counterpartyName: input.isAnonymous
          ? 'Anonymous'
          : giver?.profile?.displayName ?? giver?.username ?? null,
        celebrationYear: year,
        priceMinor: input.priceMinor,
        currency: input.currency,
        // What a gift cost is the giver's business, not something the
        // recipient's history should advertise.
        priceHidden: true,
        source: 'RESERVATION',
        sourceId: input.reservationId,
      },
      {
        userId: input.reserverId,
        direction: 'SENT',
        title: input.title,
        imageUrl: input.imageUrl,
        counterpartyUserId: input.ownerId,
        counterpartyName: recipient?.profile?.displayName ?? recipient?.username ?? null,
        celebrationYear: year,
        priceMinor: input.priceMinor,
        currency: input.currency,
        priceHidden: false,
        source: 'RESERVATION',
        sourceId: input.reservationId,
      },
    ],
    skipDuplicates: true,
  });
}

/* ------------------------------- listing ------------------------------- */

/** Gifts the caller has claimed — their own private "what I'm giving" list. */
export async function listMyReservations(reserverId: string) {
  const rows = await prisma.giftReservation.findMany({
    where: { reserverId, status: { not: 'CANCELLED' } },
    orderBy: { createdAt: 'desc' },
    include: {
      wishlistItem: {
        select: {
          id: true,
          name: true,
          imageUrl: true,
          priceMinor: true,
          currency: true,
          productUrl: true,
          wishlist: {
            select: {
              id: true,
              owner: {
                select: {
                  id: true,
                  username: true,
                  profile: { select: { displayName: true, avatarUrl: true, birthMonth: true, birthDay: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    quantity: row.quantity,
    note: row.note,
    isAnonymous: row.isAnonymous,
    createdAt: row.createdAt.toISOString(),
    item: {
      id: row.wishlistItem.id,
      name: row.wishlistItem.name,
      imageUrl: row.wishlistItem.imageUrl,
      priceMinor: row.wishlistItem.priceMinor,
      currency: row.wishlistItem.currency,
      productUrl: row.wishlistItem.productUrl,
    },
    recipient: {
      id: row.wishlistItem.wishlist.owner.id,
      displayName:
        row.wishlistItem.wishlist.owner.profile?.displayName ?? row.wishlistItem.wishlist.owner.username,
      avatarUrl: row.wishlistItem.wishlist.owner.profile?.avatarUrl ?? null,
    },
  }));
}

/**
 * Gifts the caller has *received* — only ones that have actually been handed
 * over. Anything still RESERVED or PURCHASED stays hidden (spec §58 rule 2).
 */
export async function listReceivedGifts(userId: string) {
  const rows = await prisma.giftReservation.findMany({
    where: {
      status: 'DELIVERED',
      wishlistItem: { wishlist: { ownerId: userId } },
    },
    orderBy: { deliveredAt: 'desc' },
    include: {
      wishlistItem: { select: { id: true, name: true, imageUrl: true } },
      reserver: {
        select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } },
      },
      thankYous: { where: { senderId: userId }, select: { id: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    item: row.wishlistItem,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    thanked: row.thankYous.length > 0,
    from: row.isAnonymous
      ? null
      : {
          id: row.reserver.id,
          displayName: row.reserver.profile?.displayName ?? row.reserver.username,
          avatarUrl: row.reserver.profile?.avatarUrl ?? null,
        },
  }));
}

/**
 * Explicitly refuses to show an owner the reservations on their own list.
 *
 * Exists so the failure is a clear, intentional error code rather than an
 * empty array that looks like a bug.
 */
export async function listItemReservations(viewerId: string, itemId: string) {
  const item = await prisma.wishlistItem.findFirst({
    where: { id: itemId, deletedAt: null },
    select: { id: true, wishlist: { select: { ownerId: true, id: true, visibility: true } } },
  });
  if (!item) throw new AppError('WISHLIST_ITEM_NOT_FOUND');
  if (item.wishlist.ownerId === viewerId) throw new AppError('OWNER_CANNOT_VIEW_RESERVATIONS');

  await assertCanViewWishlist(item.wishlist, viewerId);

  const reservations = await prisma.giftReservation.findMany({
    where: { wishlistItemId: itemId, status: { not: 'CANCELLED' } },
    include: {
      reserver: {
        select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } },
      },
    },
  });

  return reservations.map((reservation) => ({
    id: reservation.id,
    status: reservation.status,
    quantity: reservation.quantity,
    isMine: reservation.reserverId === viewerId,
    reservedBy:
      reservation.isAnonymous && reservation.reserverId !== viewerId
        ? null
        : {
            id: reservation.reserver.id,
            displayName: reservation.reserver.profile?.displayName ?? reservation.reserver.username,
            avatarUrl: reservation.reserver.profile?.avatarUrl ?? null,
          },
    note: reservation.isAnonymous && reservation.reserverId !== viewerId ? null : reservation.note,
    createdAt: reservation.createdAt.toISOString(),
  }));
}
