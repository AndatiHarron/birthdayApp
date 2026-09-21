import { formatCountdown, getBirthdayCountdown, type WishlistItemPriority } from '@bday/shared';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';

/**
 * The link-in-bio page at /@username: a profile, a birthday countdown and a
 * wishlist anyone can open — the page people put in an Instagram or TikTok bio.
 *
 * It exists only when the owner switched it on, and it carries strictly less
 * than the in-app profile: no contact details, no birth year, no reservation
 * state (the owner must never learn who claimed what), and no address even
 * when gifting is open.
 */

export interface PublicPageItem {
  id: string;
  name: string;
  imageUrl: string | null;
  priceMinor: number | null;
  currency: string;
  priority: WishlistItemPriority;
  notes: string | null;
  size: string | null;
  color: string | null;
  /** Already claimed by someone: shown as taken, never by whom. */
  claimed: boolean;
}

export interface PublicPage {
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  city: string | null;
  countryCode: string;
  /** Null when they keep their birthday private. */
  countdown: { daysUntil: number; isToday: boolean; label: string; nextDate: string } | null;
  wishlist: { title: string; shareSlug: string; items: PublicPageItem[] } | null;
  /** Anyone with the link may claim and buy gifts. */
  giftingOpen: boolean;
  /** They accept wishes and digital gifts from anyone (global birthdays). */
  acceptsWishes: boolean;
}

export async function getPublicPage(username: string): Promise<PublicPage> {
  const user = await prisma.user.findFirst({
    where: { username: username.toLowerCase(), deletedAt: null, status: 'ACTIVE' },
    select: {
      id: true,
      username: true,
      profile: { select: { displayName: true, avatarUrl: true, bio: true, city: true, countryCode: true, birthMonth: true, birthDay: true } },
      privacy: { select: { publicPage: true, publicGifting: true, birthdayVisibility: true, wishlistVisibility: true, celebrateGlobally: true } },
    },
  });
  if (!user?.privacy?.publicPage || !user.profile) {
    throw new AppError('NOT_FOUND', { message: 'There is no page at that address.' });
  }

  const profile = user.profile;
  const showBirthday = user.privacy.birthdayVisibility !== 'PRIVATE' && profile.birthMonth != null && profile.birthDay != null;
  const countdown = showBirthday
    ? (({ daysUntil, isToday, nextDate, hoursUntil }) => ({ daysUntil, isToday, nextDate, label: formatCountdown({ daysUntil, hoursUntil }) }))(
        getBirthdayCountdown({ month: profile.birthMonth!, day: profile.birthDay! }),
      )
    : null;

  let wishlist: PublicPage['wishlist'] = null;
  if (user.privacy.wishlistVisibility !== 'PRIVATE') {
    const list = await prisma.wishlist.findFirst({
      where: { ownerId: user.id, deletedAt: null },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      select: { id: true, title: true, shareSlug: true },
    });
    if (list) {
      const items = await prisma.wishlistItem.findMany({
        where: { wishlistId: list.id, deletedAt: null, status: { not: 'ARCHIVED' } },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          name: true,
          imageUrl: true,
          priceMinor: true,
          currency: true,
          priority: true,
          notes: true,
          size: true,
          color: true,
          quantity: true,
          reservations: { where: { status: { not: 'CANCELLED' } }, select: { quantity: true } },
        },
        take: 60,
      });
      wishlist = {
        title: list.title,
        shareSlug: list.shareSlug,
        items: items.map((item) => ({
          id: item.id,
          name: item.name,
          imageUrl: item.imageUrl,
          priceMinor: item.priceMinor,
          currency: item.currency,
          priority: item.priority,
          notes: item.notes,
          size: item.size,
          color: item.color,
          claimed: item.reservations.reduce((total, row) => total + row.quantity, 0) >= item.quantity,
        })),
      };
      await prisma.wishlist.update({ where: { id: list.id }, data: { viewCount: { increment: 1 } } });
    }
  }

  return {
    username: user.username,
    displayName: profile.displayName,
    avatarUrl: profile.avatarUrl,
    bio: profile.bio,
    city: profile.city,
    countryCode: profile.countryCode,
    countdown,
    wishlist,
    giftingOpen: user.privacy.publicGifting,
    acceptsWishes: user.privacy.celebrateGlobally,
  };
}
