import {
  fundingPercent,
  type GroupGiftSummary,
  type ItemReservationView,
  type WishlistDto,
  type WishlistItemDto,
} from '@bday/shared';
import type { GiftReservation, GroupGift, Wishlist, WishlistItem } from '@prisma/client';
import { env } from '../config/env';

export type WishlistItemRow = WishlistItem & {
  reservations?: Array<
    GiftReservation & {
      reserver?: { id: string; username: string; profile: { displayName: string; avatarUrl: string | null } | null } | null;
    }
  >;
  groupGifts?: Array<GroupGift & { _count?: { contributions: number } }>;
};

export interface ItemViewerContext {
  viewerId: string | null;
  /** True when the viewer owns the wishlist — spec §58 rule 2 applies. */
  isOwner: boolean;
}

export function shareUrl(slug: string): string {
  return `${env.WEB_BASE_URL}/wishlist/${slug}`;
}

/**
 * Reservation state as this viewer is permitted to see it.
 *
 * Returns `null` for the wishlist owner under every circumstance — that is the
 * single most important privacy rule in the product, and putting it here means
 * no route can forget it. Other gifters see that an item is taken, and by whom
 * only when the reserver did not choose anonymity.
 */
export function toItemReservationView(
  reservations: WishlistItemRow['reservations'],
  context: ItemViewerContext,
): ItemReservationView | null {
  if (context.isOwner) return null;
  if (!reservations || reservations.length === 0) return null;

  const active = reservations.filter((reservation) => reservation.status !== 'CANCELLED');
  if (active.length === 0) return null;

  const mine = active.find((reservation) => reservation.reserverId === context.viewerId);
  const representative = mine ?? active[0]!;
  const quantityReserved = active.reduce((sum, reservation) => sum + reservation.quantity, 0);

  const revealReserver =
    representative.reserverId === context.viewerId || !representative.isAnonymous;

  return {
    status: representative.status,
    isMine: representative.reserverId === context.viewerId,
    reservedByMe: mine != null,
    reservedBy:
      revealReserver && representative.reserver
        ? {
            id: representative.reserver.id,
            displayName: representative.reserver.profile?.displayName ?? representative.reserver.username,
            avatarUrl: representative.reserver.profile?.avatarUrl ?? null,
          }
        : null,
    quantityReserved,
    reservedAt: representative.createdAt.toISOString(),
    // The private note is written for other gifters, not for the public.
    note: revealReserver ? representative.note : null,
  };
}

export function toGroupGiftSummary(
  gift: GroupGift & { _count?: { contributions: number } },
  hasContributed: boolean,
): GroupGiftSummary {
  return {
    id: gift.id,
    title: gift.title,
    status: gift.status,
    targetMinor: gift.targetMinor,
    raisedMinor: gift.raisedMinor,
    currency: gift.currency,
    percentFunded: fundingPercent(
      { amountMinor: gift.raisedMinor, currency: gift.currency as never },
      { amountMinor: gift.targetMinor, currency: gift.currency as never },
    ),
    contributorCount: gift._count?.contributions ?? 0,
    hasContributed,
    deadline: gift.deadline?.toISOString() ?? null,
  };
}

export function toWishlistItemDto(
  item: WishlistItemRow,
  context: ItemViewerContext,
  options: { contributedGroupGiftIds?: Set<string> } = {},
): WishlistItemDto {
  const groupGift = item.groupGifts?.find((gift) => gift.status !== 'CANCELLED') ?? null;

  return {
    id: item.id,
    wishlistId: item.wishlistId,
    name: item.name,
    description: item.description,
    imageUrl: item.imageUrl,
    priceMinor: item.priceMinor,
    currency: item.currency,
    productUrl: item.productUrl,
    merchant: item.merchant,
    category: item.category,
    priority: item.priority,
    size: item.size,
    color: item.color,
    quantity: item.quantity,
    notes: item.notes,
    preferredVendorId: item.preferredVendorId,
    productId: item.productId,
    // The owner sees AVAILABLE for everything: a RESERVED status would give the
    // surprise away just as surely as naming the gifter.
    status: context.isOwner ? 'AVAILABLE' : item.status,
    reservation: toItemReservationView(item.reservations, context),
    groupGift:
      groupGift && !context.isOwner
        ? toGroupGiftSummary(
            groupGift,
            options.contributedGroupGiftIds?.has(groupGift.id) ?? false,
          )
        : null,
    position: item.position,
    createdAt: item.createdAt.toISOString(),
  };
}

export type WishlistRow = Wishlist & {
  owner: { id: string; username: string; profile: { displayName: string; avatarUrl: string | null } | null };
  items?: WishlistItemRow[];
};

export function toWishlistDto(
  wishlist: WishlistRow,
  context: ItemViewerContext,
  options: { contributedGroupGiftIds?: Set<string>; itemCount?: number } = {},
): WishlistDto {
  const items = (wishlist.items ?? []).map((item) => toWishlistItemDto(item, context, options));
  return {
    id: wishlist.id,
    ownerId: wishlist.ownerId,
    owner: {
      id: wishlist.owner.id,
      username: wishlist.owner.username,
      displayName: wishlist.owner.profile?.displayName ?? wishlist.owner.username,
      avatarUrl: wishlist.owner.profile?.avatarUrl ?? null,
    },
    title: wishlist.title,
    description: wishlist.description,
    visibility: wishlist.visibility,
    isDefault: wishlist.isDefault,
    shareSlug: wishlist.shareSlug,
    shareUrl: shareUrl(wishlist.shareSlug),
    itemCount: options.itemCount ?? items.length,
    ...(context.isOwner ? { viewCount: wishlist.viewCount } : {}),
    items,
    createdAt: wishlist.createdAt.toISOString(),
    updatedAt: wishlist.updatedAt.toISOString(),
  };
}

/** Include shape that gives the mapper everything it needs, and nothing more. */
export const WISHLIST_ITEM_INCLUDE = {
  reservations: {
    where: { status: { not: 'CANCELLED' as const } },
    include: {
      reserver: {
        select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } },
      },
    },
  },
  groupGifts: {
    where: { status: { not: 'CANCELLED' as const } },
    include: { _count: { select: { contributions: true } } },
  },
} as const;
