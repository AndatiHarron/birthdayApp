import {
  GIFT_SHELVES,
  formatMoney,
  isSupportedCurrency,
  type ActivityItemDto,
  type HomeFeedResponse,
  type SpotlightDto,
  type TrackedBirthdayDto,
} from '@bday/shared';
import { zonedNow } from '../lib/dates';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { toActor } from '../mappers/user.mapper';
import { matchGifts } from './ai.service';
import { listProducts } from './catalog.service';
import { listCelebratingToday } from './global.service';
import { listUpcomingBirthdays, myBirthdayToday } from './birthday.service';
import { getPublicProfile } from './user.service';
import { getUserWishlist } from './wishlist.service';

/**
 * Home dashboard (spec §6, §45, §65).
 *
 * One request builds the whole screen. Each section fails independently — a
 * slow catalogue query must not blank out the birthday list, which is the one
 * thing the screen exists to show.
 */

function greetingFor(hour: number): string {
  if (hour < 5) return 'Hello';
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

async function safely<T>(label: string, work: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    logger.warn({ err: error, section: label }, 'home feed section failed');
    return fallback;
  }
}

/**
 * The "magical" prompt (spec §65): the soonest birthday of a real user whose
 * wishlist the viewer can see, with how many friends could chip in.
 */
async function buildSpotlight(userId: string, upcoming: TrackedBirthdayDto[]): Promise<SpotlightDto | null> {
  const candidate = upcoming.find((entry) => entry.linkedUser && entry.countdown.daysUntil <= 30);
  if (!candidate?.linkedUser) return null;

  let topWish: SpotlightDto['topWish'] = null;
  if (candidate.hasWishlist) {
    const wishlist = await getUserWishlist(userId, candidate.linkedUser.id).catch(() => null);
    const order = { MUST_HAVE: 0, HIGH: 1, NICE_TO_HAVE: 2 } as const;
    const best = wishlist?.items
      .filter((item) => item.status === 'AVAILABLE' && item.reservation == null)
      .sort((a, b) => order[a.priority] - order[b.priority] || a.position - b.position)[0];
    if (best) topWish = { id: best.id, name: best.name, priceMinor: best.priceMinor, currency: best.currency };
  }

  // Mutual friends are the people who could plausibly join a group gift.
  const [mine, theirs] = await Promise.all([friendIdsOf(userId), friendIdsOf(candidate.linkedUser.id)]);
  const theirSet = new Set(theirs);
  const potentialContributors = mine.filter((id) => id !== candidate.linkedUser!.id && theirSet.has(id)).length;

  const firstName = candidate.name.split(' ')[0] ?? candidate.name;
  const lines: string[] = [
    candidate.countdown.isToday
      ? `🎂 It's ${firstName}'s birthday today!`
      : `🎂 ${firstName}'s birthday is in ${candidate.countdown.daysUntil} ${candidate.countdown.daysUntil === 1 ? 'day' : 'days'}.`,
  ];
  if (candidate.newWishlistItemCount > 0) {
    lines.push(
      `❤️ ${firstName} added ${candidate.newWishlistItemCount} new ${candidate.newWishlistItemCount === 1 ? 'thing' : 'things'} to their wishlist.`,
    );
  }
  if (topWish) {
    lines.push(
      topWish.priceMinor != null && isSupportedCurrency(topWish.currency)
        ? `🎁 Their top wish is available for ${formatMoney(topWish.priceMinor, topWish.currency)}.`
        : `🎁 Their top wish, “${topWish.name}”, is still available.`,
    );
  }
  if (potentialContributors > 0) {
    lines.push(`👥 You and ${potentialContributors} ${potentialContributors === 1 ? 'friend' : 'friends'} can contribute toward it.`);
  }
  lines.push('✨ Want to create a surprise?');

  return {
    birthdayId: candidate.id,
    personName: candidate.name,
    personAvatarUrl: candidate.avatarUrl,
    daysUntil: candidate.countdown.daysUntil,
    newWishlistItemCount: candidate.newWishlistItemCount,
    topWish,
    potentialContributors,
    canCreateSurprise: true,
    lines,
  };
}

async function friendIdsOf(userId: string): Promise<string[]> {
  const rows = await prisma.friendship.findMany({
    where: { status: 'ACCEPTED', OR: [{ requesterId: userId }, { addresseeId: userId }] },
    select: { requesterId: true, addresseeId: true },
  });
  return rows.map((row) => (row.requesterId === userId ? row.addresseeId : row.requesterId));
}

async function buildActivity(userId: string): Promise<ActivityItemDto[]> {
  const friendIds = await friendIdsOf(userId);
  const since = new Date(Date.now() - 14 * 86_400_000);
  const userSelect = { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } } as const;

  const [newFriends, newItems, received, thanks] = await Promise.all([
    prisma.friendship.findMany({
      where: { status: 'ACCEPTED', respondedAt: { gte: since }, OR: [{ requesterId: userId }, { addresseeId: userId }] },
      orderBy: { respondedAt: 'desc' },
      take: 5,
      include: { requester: { select: userSelect }, addressee: { select: userSelect } },
    }),
    friendIds.length
      ? prisma.wishlistItem.findMany({
          where: {
            deletedAt: null,
            createdAt: { gte: since },
            wishlist: {
              ownerId: { in: friendIds },
              deletedAt: null,
              visibility: { in: ['PUBLIC', 'FRIENDS'] },
              owner: { privacy: { wishlistVisibility: { in: ['PUBLIC', 'FRIENDS'] } } },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: { wishlist: { select: { owner: { select: userSelect } } } },
        })
      : Promise.resolve([]),
    prisma.giftHistoryEntry.findMany({
      where: { userId, direction: 'RECEIVED', occurredAt: { gte: since } },
      orderBy: { occurredAt: 'desc' },
      take: 5,
      include: { counterparty: { select: userSelect } },
    }),
    prisma.thankYou.findMany({
      where: { recipientUserId: userId, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: { sender: { select: userSelect } },
    }),
  ]);

  const items: ActivityItemDto[] = [
    ...newFriends.map((row) => {
      const other = row.requesterId === userId ? row.addressee : row.requester;
      const actor = toActor(other);
      return {
        id: `friend:${row.id}`,
        type: 'FRIEND_JOINED' as const,
        actor,
        text: `You and ${actor?.displayName} are now connected.`,
        imageUrl: actor?.avatarUrl ?? null,
        deepLink: `profile/${other.id}`,
        createdAt: (row.respondedAt ?? row.createdAt).toISOString(),
      };
    }),
    ...newItems.map((row) => {
      const actor = toActor(row.wishlist.owner);
      return {
        id: `wish:${row.id}`,
        type: 'WISHLIST_ITEM_ADDED' as const,
        actor,
        text: `${actor?.displayName} added “${row.name}” to their wishlist.`,
        imageUrl: row.imageUrl,
        deepLink: `wishlist/user/${row.wishlist.owner.id}`,
        createdAt: row.createdAt.toISOString(),
      };
    }),
    ...received.map((row) => ({
      id: `gift:${row.id}`,
      type: 'GIFT_RECEIVED' as const,
      actor: toActor(row.counterparty),
      text: `You received “${row.title}”${row.counterpartyName ? ` from ${row.counterpartyName}` : ''}.`,
      imageUrl: row.imageUrl,
      deepLink: 'gifts/history',
      createdAt: row.occurredAt.toISOString(),
    })),
    ...thanks.map((row) => {
      const actor = toActor(row.sender);
      return {
        id: `thanks:${row.id}`,
        type: 'THANK_YOU' as const,
        actor,
        text: `${actor?.displayName} sent you a thank-you ❤️`,
        imageUrl: row.mediaUrl,
        deepLink: 'thank-yous',
        createdAt: row.createdAt.toISOString(),
      };
    }),
  ];

  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 15);
}

/** Curated marketplace rows. Keeps the home screen worth scrolling before you have friends on it. */
async function buildShelves(): Promise<HomeFeedResponse['shelves']> {
  const keys = ['popular', 'under_5000', 'premium'] as const;
  const rows = await Promise.all(
    keys.map(async (key) => {
      const shelf = GIFT_SHELVES.find((entry) => entry.key === key);
      const products = await listProducts({ shelf: key, limit: 10, sort: 'POPULAR' } as never);
      return { key, label: shelf?.label ?? key, products: products.items };
    }),
  );
  return rows.filter((row) => row.products.length > 0);
}

/** Birthday photos from you and the friends who shared them. */
async function buildMoments(userId: string): Promise<HomeFeedResponse['moments']> {
  const friends = await friendIdsOf(userId);
  const media = await prisma.memoryMedia.findMany({
    where: {
      memory: {
        OR: [{ userId }, { userId: { in: friends }, visibility: { not: 'PRIVATE' } }],
      },
    },
    orderBy: { createdAt: 'desc' },
    take: 12,
    select: {
      id: true,
      url: true,
      kind: true,
      caption: true,
      memory: {
        select: {
          celebrationYear: true,
          user: { select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } } },
        },
      },
    },
  });
  return media.map((row) => ({
    id: row.id,
    url: row.url,
    kind: row.kind,
    caption: row.caption,
    celebrationYear: row.memory.celebrationYear,
    owner: {
      id: row.memory.user.id,
      displayName: row.memory.user.profile?.displayName ?? row.memory.user.username,
      avatarUrl: row.memory.user.profile?.avatarUrl ?? null,
    },
  }));
}

export async function getHomeFeed(userId: string): Promise<HomeFeedResponse> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true, timezone: true } } },
  });
  const { hour } = zonedNow(user.profile?.timezone ?? 'Africa/Nairobi');

  const [birthdays, myToday] = await Promise.all([
    safely('birthdays', () => listUpcomingBirthdays(userId, { withinDays: 60, limit: 12, favoritesOnly: false }), {
      today: [],
      upcoming: [],
      mine: null,
    }),
    safely('myBirthdayToday', () => myBirthdayToday(userId), null),
  ]);
  const upcoming = [...birthdays.today, ...birthdays.upcoming];

  const [spotlight, giftIdeas, activity] = await Promise.all([
    safely('spotlight', () => buildSpotlight(userId, upcoming), null),
    safely(
      'giftIdeas',
      async () => {
        const next = upcoming.find((entry) => entry.linkedUser || entry.interests.length > 0);
        return matchGifts(userId, {
          ...(next?.linkedUser ? { recipientUserId: next.linkedUser.id } : next ? { trackedBirthdayId: next.id } : {}),
          limit: 6,
        });
      },
      [],
    ),
    safely('activity', () => buildActivity(userId), []),
  ]);

  const friendHighlights = await safely(
    'friendHighlights',
    async () => {
      const soon = upcoming.filter((entry) => entry.linkedUser).slice(0, 6);
      const profiles = await Promise.all(
        soon.map(async (entry) => {
          const profile = await getPublicProfile(userId, { userId: entry.linkedUser!.id }).catch(() => null);
          if (!profile) return null;
          return entry.newWishlistItemCount > 0
            ? {
                user: profile,
                reason: 'NEW_WISHLIST_ITEMS' as const,
                detail: `${entry.newWishlistItemCount} new wishlist ${entry.newWishlistItemCount === 1 ? 'item' : 'items'}`,
              }
            : { user: profile, reason: 'BIRTHDAY_SOON' as const, detail: entry.countdown.label };
        }),
      );
      return profiles.filter((row): row is NonNullable<typeof row> => row !== null);
    },
    [],
  );

  const [globalToday, shelves, moments] = await Promise.all([
    safely(
      'globalToday',
      async () => {
        // Throws for anyone who cannot browse global birthdays (minors, unverified).
        const feed = await listCelebratingToday(userId, { limit: 12 });
        return {
          total: feed.totalCelebrating,
          countries: feed.countries,
          people: feed.items.map((person) => ({
            userId: person.userId,
            displayName: person.displayName,
            avatarUrl: person.avatarUrl,
            city: person.city,
            countryCode: person.countryCode,
            firstCelebration: person.firstCelebration,
            cheeredByMe: person.cheeredByMe,
          })),
        };
      },
      null,
    ),
    safely('shelves', () => buildShelves(), []),
    safely('moments', () => buildMoments(userId), []),
  ]);

  return {
    greeting: `${greetingFor(hour)}, ${(user.profile?.displayName ?? user.username).split(' ')[0]}`,
    user: { id: user.id, displayName: user.profile?.displayName ?? user.username, avatarUrl: user.profile?.avatarUrl ?? null },
    myBirthdayToday: myToday,
    upcomingBirthdays: upcoming,
    giftIdeas,
    friendHighlights,
    activity,
    spotlight,
    globalToday,
    shelves,
    moments,
  };
}
