import type { GlobalSearchInput, GlobalSearchResponse } from '@bday/shared';
import { prisma } from '../lib/prisma';
import { listProducts, listVendors } from './catalog.service';
import { searchUsers } from './user.service';

/**
 * Global search (spec §37).
 *
 * Each section reuses the service that owns the data, so the privacy rules of
 * people search and the visibility rules of the catalogue apply unchanged. A
 * wishlist only appears when the viewer could open it.
 */
export async function globalSearch(viewerId: string, input: GlobalSearchInput): Promise<GlobalSearchResponse> {
  const wants = new Set(input.types);
  const term = input.q.trim();

  const [people, products, wishlists, events, vendors] = await Promise.all([
    wants.has('PEOPLE') ? searchUsers(viewerId, { q: term, limit: input.limit }) : Promise.resolve([]),
    wants.has('PRODUCTS')
      ? listProducts({
          q: term,
          limit: input.limit,
          minPriceMinor: input.minPriceMinor,
          maxPriceMinor: input.maxPriceMinor,
          city: input.city,
          inStockOnly: false,
          sort: 'RELEVANCE',
        }).then((page) => page.items)
      : Promise.resolve([]),
    wants.has('WISHLISTS') ? searchWishlists(viewerId, term, input.limit) : Promise.resolve([]),
    wants.has('EVENTS') ? searchEvents(viewerId, term, input.limit) : Promise.resolve([]),
    wants.has('VENDORS') ? listVendors({ q: term, city: input.city, limit: input.limit }) : Promise.resolve([]),
  ]);

  return { people, products, wishlists, events, vendors };
}

async function searchWishlists(viewerId: string, term: string, limit: number) {
  const friendIds = (
    await prisma.friendship.findMany({
      where: { status: 'ACCEPTED', OR: [{ requesterId: viewerId }, { addresseeId: viewerId }] },
      select: { requesterId: true, addresseeId: true },
    })
  ).map((row) => (row.requesterId === viewerId ? row.addresseeId : row.requesterId));

  const rows = await prisma.wishlist.findMany({
    where: {
      deletedAt: null,
      owner: {
        deletedAt: null,
        blocksMade: { none: { blockedId: viewerId } },
        blocksReceived: { none: { blockerId: viewerId } },
      },
      AND: [
        {
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { owner: { username: { contains: term.toLowerCase() } } },
            { owner: { profile: { displayName: { contains: term, mode: 'insensitive' } } } },
          ],
        },
        {
          OR: [
            { ownerId: viewerId },
            // The stricter of the list's and the owner's visibility wins.
            { visibility: 'PUBLIC', owner: { privacy: { wishlistVisibility: 'PUBLIC' } } },
            {
              ownerId: { in: friendIds },
              visibility: { in: ['PUBLIC', 'FRIENDS'] },
              owner: { privacy: { wishlistVisibility: { in: ['PUBLIC', 'FRIENDS'] } } },
            },
          ],
        },
      ],
    },
    take: limit,
    select: {
      id: true,
      title: true,
      shareSlug: true,
      owner: { select: { username: true, profile: { select: { displayName: true } } } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    owner: row.owner.profile?.displayName ?? row.owner.username,
    shareSlug: row.shareSlug,
  }));
}

async function searchEvents(viewerId: string, term: string, limit: number) {
  const rows = await prisma.birthdayEvent.findMany({
    where: {
      cancelledAt: null,
      name: { contains: term, mode: 'insensitive' },
      OR: [{ hostId: viewerId }, { guests: { some: { userId: viewerId } } }],
    },
    orderBy: { startsAt: 'desc' },
    take: limit,
    select: {
      id: true,
      name: true,
      startsAt: true,
      coverImageUrl: true,
      venueName: true,
      hostId: true,
      guests: { where: { userId: viewerId }, select: { rsvp: true } },
      _count: { select: { guests: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    startsAt: row.startsAt.toISOString(),
    coverImageUrl: row.coverImageUrl,
    venueName: row.venueName,
    hostId: row.hostId,
    myRsvp: row.guests[0]?.rsvp ?? null,
    guestCount: row._count.guests,
  }));
}
