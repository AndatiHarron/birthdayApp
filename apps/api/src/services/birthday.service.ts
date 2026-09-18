import {
  celebrationDayInYear,
  daysInMonth,
  getBirthdayCountdown,
  type CalendarMonthResponse,
  type ConfirmContactImportInput,
  type ContactImportCandidate,
  type ContactImportInput,
  type CreateInviteInput,
  type CreateTrackedBirthdayInput,
  type EventSummaryDto,
  type InviteDto,
  type TrackedBirthdayDto,
  type UpcomingBirthdaysInput,
  type UpcomingBirthdaysResponse,
  type UpdateTrackedBirthdayInput,
} from '@bday/shared';
import type { Prisma } from '@prisma/client';
import QRCode from 'qrcode';
import { env } from '../config/env';
import { humanCode } from '../lib/crypto';
import { addDays } from '../lib/dates';
import { AppError } from '../lib/errors';
import { prisma, type Tx } from '../lib/prisma';
import {
  NEW_WISHLIST_ITEM_WINDOW_DAYS,
  TRACKED_BIRTHDAY_INCLUDE,
  toTrackedBirthdayDto,
  type TrackedBirthdayRow,
  type WishlistSignal,
} from '../mappers/birthday.mapper';
import { toCountdown } from '../mappers/user.mapper';
import { areFriends } from './access.service';

/**
 * The birthday calendar (spec §7, §8).
 *
 * Everything the calendar shows is a `TrackedBirthday` row owned by the viewer,
 * whether the person is a platform user or a contact typed in by hand. Sorting
 * "by how soon" is done in memory rather than in SQL: the comparison wraps
 * around the end of the year, which no index can express, and a user's calendar
 * is small enough that this never matters.
 */

/* ---------------------------- wishlist signals ---------------------------- */

/**
 * How many wishlist items each linked friend has, and how many are new.
 *
 * Only lists the viewer may actually see are counted — showing "8 items" for a
 * wishlist that then renders as private would leak its size.
 */
async function wishlistSignals(
  viewerId: string,
  linkedUserIds: string[],
): Promise<Map<string, WishlistSignal>> {
  const signals = new Map<string, WishlistSignal>();
  if (linkedUserIds.length === 0) return signals;

  const wishlists = await prisma.wishlist.findMany({
    where: {
      ownerId: { in: linkedUserIds },
      deletedAt: null,
      visibility: { in: ['PUBLIC', 'FRIENDS'] },
    },
    select: {
      id: true,
      ownerId: true,
      visibility: true,
      owner: { select: { privacy: { select: { wishlistVisibility: true } } } },
    },
  });
  if (wishlists.length === 0) return signals;

  // A wishlist is visible when both the list's own visibility and the owner's
  // global wishlist setting allow it.
  const visibleWishlists = wishlists.filter(
    (list) =>
      list.visibility === 'PUBLIC' ||
      (list.owner.privacy?.wishlistVisibility ?? 'FRIENDS') !== 'PRIVATE',
  );

  const friendChecks = await Promise.all(
    Array.from(new Set(visibleWishlists.map((list) => list.ownerId))).map(async (ownerId) => ({
      ownerId,
      isFriend: await areFriends(viewerId, ownerId),
    })),
  );
  const friendByOwner = new Map(friendChecks.map((row) => [row.ownerId, row.isFriend]));

  const readable = visibleWishlists.filter((list) => {
    const ownerVisibility = list.owner.privacy?.wishlistVisibility ?? 'FRIENDS';
    if (list.visibility === 'PUBLIC' && ownerVisibility === 'PUBLIC') return true;
    return friendByOwner.get(list.ownerId) === true;
  });
  if (readable.length === 0) return signals;

  const ownerByWishlist = new Map(readable.map((list) => [list.id, list.ownerId]));
  const since = addDays(new Date(), -NEW_WISHLIST_ITEM_WINDOW_DAYS);

  const [totals, recents] = await Promise.all([
    prisma.wishlistItem.groupBy({
      by: ['wishlistId'],
      where: { wishlistId: { in: readable.map((list) => list.id) }, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.wishlistItem.groupBy({
      by: ['wishlistId'],
      where: {
        wishlistId: { in: readable.map((list) => list.id) },
        deletedAt: null,
        createdAt: { gte: since },
      },
      _count: { _all: true },
    }),
  ]);

  for (const row of totals) {
    const ownerId = ownerByWishlist.get(row.wishlistId);
    if (!ownerId) continue;
    const current = signals.get(ownerId) ?? { itemCount: 0, newItemCount: 0 };
    current.itemCount += row._count._all;
    signals.set(ownerId, current);
  }
  for (const row of recents) {
    const ownerId = ownerByWishlist.get(row.wishlistId);
    if (!ownerId) continue;
    const current = signals.get(ownerId) ?? { itemCount: 0, newItemCount: 0 };
    current.newItemCount += row._count._all;
    signals.set(ownerId, current);
  }

  return signals;
}

async function groupCounts(ownerId: string): Promise<Map<string, number>> {
  const counts = await prisma.friendGroupMember.groupBy({
    by: ['groupId'],
    where: { group: { ownerId } },
    _count: { trackedBirthdayId: true },
  });
  return new Map(counts.map((row) => [row.groupId, row._count.trackedBirthdayId]));
}

async function decorate(
  viewerId: string,
  rows: TrackedBirthdayRow[],
  now = new Date(),
): Promise<TrackedBirthdayDto[]> {
  const linkedIds = rows.map((row) => row.linkedUserId).filter((id): id is string => Boolean(id));
  const [signals, counts] = await Promise.all([
    wishlistSignals(viewerId, linkedIds),
    groupCounts(viewerId),
  ]);
  return rows.map((row) =>
    toTrackedBirthdayDto(
      row,
      row.linkedUserId ? signals.get(row.linkedUserId) ?? null : null,
      counts,
      now,
    ),
  );
}

/* ------------------------------- listing ------------------------------- */

export async function listUpcomingBirthdays(
  userId: string,
  input: UpcomingBirthdaysInput,
  now = new Date(),
): Promise<UpcomingBirthdaysResponse> {
  const where: Prisma.TrackedBirthdayWhereInput = {
    ownerId: userId,
    deletedAt: null,
    ...(input.relationship ? { relationship: input.relationship } : {}),
    ...(input.favoritesOnly ? { isFavorite: true } : {}),
    ...(input.groupId ? { groupMembers: { some: { groupId: input.groupId } } } : {}),
  };

  const rows = (await prisma.trackedBirthday.findMany({
    where,
    include: TRACKED_BIRTHDAY_INCLUDE,
  })) as TrackedBirthdayRow[];

  const decorated = await decorate(userId, rows, now);

  const withinRange = decorated
    .filter((entry) => entry.countdown.daysUntil <= input.withinDays)
    .sort((a, b) => a.countdown.daysUntil - b.countdown.daysUntil || a.name.localeCompare(b.name));

  const today = withinRange.filter((entry) => entry.countdown.isToday);
  const upcoming = withinRange.filter((entry) => !entry.countdown.isToday).slice(0, input.limit);

  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { birthMonth: true, birthDay: true, birthYear: true },
  });

  return {
    today,
    upcoming,
    mine:
      profile?.birthMonth != null && profile.birthDay != null
        ? toCountdown(
            { month: profile.birthMonth, day: profile.birthDay, year: profile.birthYear },
            now,
          )
        : null,
  };
}

export async function listAllBirthdays(
  userId: string,
  options: { relationship?: Prisma.TrackedBirthdayWhereInput['relationship']; groupId?: string } = {},
): Promise<TrackedBirthdayDto[]> {
  const rows = (await prisma.trackedBirthday.findMany({
    where: {
      ownerId: userId,
      deletedAt: null,
      ...(options.relationship ? { relationship: options.relationship } : {}),
      ...(options.groupId ? { groupMembers: { some: { groupId: options.groupId } } } : {}),
    },
    include: TRACKED_BIRTHDAY_INCLUDE,
    orderBy: [{ birthMonth: 'asc' }, { birthDay: 'asc' }],
  })) as TrackedBirthdayRow[];
  return decorate(userId, rows);
}

export async function getTrackedBirthday(userId: string, id: string): Promise<TrackedBirthdayDto> {
  const row = (await prisma.trackedBirthday.findFirst({
    where: { id, ownerId: userId, deletedAt: null },
    include: TRACKED_BIRTHDAY_INCLUDE,
  })) as TrackedBirthdayRow | null;
  if (!row) throw new AppError('NOT_FOUND', { message: 'That birthday is not on your calendar.' });
  const [dto] = await decorate(userId, [row]);
  return dto!;
}

/**
 * Month view (spec §7).
 *
 * A 29 February birthday is placed on 28 February in common years, matching
 * `celebrationDayInYear`, so the calendar and the countdown never disagree.
 */
export async function getCalendarMonth(
  userId: string,
  input: { year: number; month: number; groupId?: string; relationship?: Prisma.TrackedBirthdayWhereInput['relationship'] },
): Promise<CalendarMonthResponse> {
  const entries = await listAllBirthdays(userId, {
    groupId: input.groupId,
    relationship: input.relationship,
  });

  const total = daysInMonth(input.month, input.year);
  const byDay = new Map<number, TrackedBirthdayDto[]>();

  for (const entry of entries) {
    const celebration = celebrationDayInYear(
      { month: entry.birthday.month, day: entry.birthday.day },
      input.year,
    );
    if (celebration.month !== input.month) continue;
    const bucket = byDay.get(celebration.day) ?? [];
    bucket.push(entry);
    byDay.set(celebration.day, bucket);
  }

  const monthStart = new Date(Date.UTC(input.year, input.month - 1, 1));
  const monthEnd = new Date(Date.UTC(input.year, input.month, 1));

  const events = await prisma.birthdayEvent.findMany({
    where: {
      cancelledAt: null,
      startsAt: { gte: monthStart, lt: monthEnd },
      OR: [{ hostId: userId }, { guests: { some: { userId } } }],
    },
    select: {
      id: true,
      name: true,
      startsAt: true,
      coverImageUrl: true,
      venueName: true,
      hostId: true,
      guests: { where: { userId }, select: { rsvp: true } },
      _count: { select: { guests: true } },
    },
  });

  const eventsByDay = new Map<number, EventSummaryDto[]>();
  for (const event of events) {
    const day = event.startsAt.getUTCDate();
    const bucket = eventsByDay.get(day) ?? [];
    bucket.push({
      id: event.id,
      name: event.name,
      startsAt: event.startsAt.toISOString(),
      coverImageUrl: event.coverImageUrl,
      venueName: event.venueName,
      hostId: event.hostId,
      myRsvp: event.guests[0]?.rsvp ?? null,
      guestCount: event._count.guests,
    });
    eventsByDay.set(day, bucket);
  }

  return {
    year: input.year,
    month: input.month,
    days: Array.from({ length: total }, (_, index) => {
      const day = index + 1;
      return {
        day,
        birthdays: byDay.get(day) ?? [],
        events: eventsByDay.get(day) ?? [],
      };
    }),
  };
}

/* ------------------------------ mutations ------------------------------ */

async function applyInterests(tx: Tx, trackedBirthdayId: string, slugs: string[]): Promise<void> {
  const unique = Array.from(new Set(slugs.map((slug) => slug.trim().toLowerCase()).filter(Boolean)));
  await tx.trackedBirthdayInterest.deleteMany({ where: { trackedBirthdayId } });
  if (unique.length === 0) return;

  // ON CONFLICT DO NOTHING, so a concurrent insert of the same new interest
  // cannot abort this transaction.
  await tx.interest.createMany({
    data: unique.map((slug) => ({ slug, label: slug.charAt(0).toUpperCase() + slug.slice(1) })),
    skipDuplicates: true,
  });
  const existing = await tx.interest.findMany({
    where: { slug: { in: unique } },
    select: { id: true, slug: true },
  });
  const bySlug = new Map(existing.map((row) => [row.slug, row.id]));

  await tx.trackedBirthdayInterest.createMany({
    data: unique
      .map((slug) => bySlug.get(slug))
      .filter((id): id is string => Boolean(id))
      .map((interestId) => ({ trackedBirthdayId, interestId })),
    skipDuplicates: true,
  });
}

async function applyGroups(tx: Tx, ownerId: string, trackedBirthdayId: string, groupIds: string[]): Promise<void> {
  const owned = await tx.friendGroup.findMany({
    where: { id: { in: groupIds }, ownerId },
    select: { id: true },
  });
  await tx.friendGroupMember.deleteMany({ where: { trackedBirthdayId } });
  if (owned.length === 0) return;
  await tx.friendGroupMember.createMany({
    data: owned.map((group) => ({ groupId: group.id, trackedBirthdayId })),
    skipDuplicates: true,
  });
}

export async function createTrackedBirthday(
  ownerId: string,
  input: CreateTrackedBirthdayInput,
): Promise<TrackedBirthdayDto> {
  if (input.linkedUserId) {
    const exists = await prisma.user.findFirst({
      where: { id: input.linkedUserId, deletedAt: null },
      select: { id: true },
    });
    if (!exists) throw new AppError('NOT_FOUND', { message: 'That account could not be found.' });

    const duplicate = await prisma.trackedBirthday.findUnique({
      where: { ownerId_linkedUserId: { ownerId, linkedUserId: input.linkedUserId } },
      select: { id: true, deletedAt: true },
    });
    if (duplicate && !duplicate.deletedAt) {
      throw new AppError('CONFLICT', { message: 'That person is already on your calendar.' });
    }
  }

  const id = await prisma.$transaction(async (tx) => {
    const row = await tx.trackedBirthday.create({
      data: {
        ownerId,
        name: input.name,
        avatarUrl: input.avatarUrl ?? null,
        birthMonth: input.birthday.month,
        birthDay: input.birthday.day,
        birthYear: input.birthday.year ?? null,
        relationship: input.relationship,
        isFavorite: input.isFavorite,
        notes: input.notes ?? null,
        phone: input.phone ?? null,
        email: input.email ?? null,
        reminderOffsetsDays: input.reminderOffsetsDays ?? [],
        linkedUserId: input.linkedUserId ?? null,
        source: input.linkedUserId ? 'LINKED_USER' : 'MANUAL',
      },
      select: { id: true },
    });
    if (input.interests) await applyInterests(tx, row.id, input.interests);
    if (input.groupIds.length > 0) await applyGroups(tx, ownerId, row.id, input.groupIds);
    return row.id;
  });

  return getTrackedBirthday(ownerId, id);
}

export async function updateTrackedBirthday(
  ownerId: string,
  id: string,
  input: UpdateTrackedBirthdayInput,
): Promise<TrackedBirthdayDto> {
  const existing = await prisma.trackedBirthday.findFirst({
    where: { id, ownerId, deletedAt: null },
    select: { id: true, linkedUserId: true },
  });
  if (!existing) throw new AppError('NOT_FOUND', { message: 'That birthday is not on your calendar.' });

  await prisma.$transaction(async (tx) => {
    const data: Prisma.TrackedBirthdayUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.avatarUrl !== undefined) data.avatarUrl = input.avatarUrl ?? null;
    if (input.relationship !== undefined) data.relationship = input.relationship;
    if (input.isFavorite !== undefined) data.isFavorite = input.isFavorite;
    if (input.notes !== undefined) data.notes = input.notes ?? null;
    if (input.phone !== undefined) data.phone = input.phone ?? null;
    if (input.email !== undefined) data.email = input.email ?? null;
    if (input.reminderOffsetsDays !== undefined) {
      data.reminderOffsetsDays = input.reminderOffsetsDays ?? [];
    }
    if (input.birthday) {
      // A linked friend's date is owned by their own profile; letting the
      // tracker edit it would silently desync the two.
      if (existing.linkedUserId) {
        throw new AppError('FORBIDDEN', {
          message: 'This birthday comes from their profile and cannot be edited here.',
        });
      }
      data.birthMonth = input.birthday.month;
      data.birthDay = input.birthday.day;
      data.birthYear = input.birthday.year ?? null;
    }

    if (Object.keys(data).length > 0) {
      await tx.trackedBirthday.update({ where: { id }, data });
    }
    if (input.interests) await applyInterests(tx, id, input.interests);
    if (input.groupIds) await applyGroups(tx, ownerId, id, input.groupIds);
  });

  return getTrackedBirthday(ownerId, id);
}

export async function deleteTrackedBirthday(ownerId: string, id: string): Promise<void> {
  const result = await prisma.trackedBirthday.updateMany({
    where: { id, ownerId, deletedAt: null },
    data: { deletedAt: new Date() },
  });
  if (result.count === 0) throw new AppError('NOT_FOUND');
}

/* --------------------------- contact import --------------------------- */

/**
 * Matches device contacts against the platform (spec §8).
 *
 * Only contacts that carry a birthday are offered for import — the rest are
 * noise on a birthday calendar — and matching by phone or email honours the
 * other user's discoverability switches.
 */
export async function previewContactImport(
  ownerId: string,
  input: ContactImportInput,
): Promise<ContactImportCandidate[]> {
  const phones = input.contacts.map((contact) => contact.phone).filter((v): v is string => Boolean(v));
  const emails = input.contacts.map((contact) => contact.email).filter((v): v is string => Boolean(v));

  const [matches, tracked] = await Promise.all([
    prisma.user.findMany({
      where: {
        deletedAt: null,
        OR: [
          ...(phones.length > 0 ? [{ phone: { in: phones }, privacy: { discoverableByPhone: true } }] : []),
          ...(emails.length > 0 ? [{ email: { in: emails }, privacy: { discoverableByEmail: true } }] : []),
        ],
      },
      select: {
        id: true,
        username: true,
        phone: true,
        email: true,
        profile: { select: { displayName: true, avatarUrl: true } },
      },
    }),
    prisma.trackedBirthday.findMany({
      where: { ownerId, deletedAt: null },
      select: { externalContactId: true, linkedUserId: true },
    }),
  ]);

  const byPhone = new Map(matches.filter((m) => m.phone).map((m) => [m.phone!, m]));
  const byEmail = new Map(matches.filter((m) => m.email).map((m) => [m.email!, m]));
  const trackedExternalIds = new Set(
    tracked.map((row) => row.externalContactId).filter((id): id is string => Boolean(id)),
  );
  const trackedUserIds = new Set(
    tracked.map((row) => row.linkedUserId).filter((id): id is string => Boolean(id)),
  );

  return input.contacts.map((contact) => {
    const match =
      (contact.phone ? byPhone.get(contact.phone) : undefined) ??
      (contact.email ? byEmail.get(contact.email) : undefined) ??
      null;

    return {
      externalId: contact.externalId,
      name: contact.name,
      phone: contact.phone ?? null,
      email: contact.email ?? null,
      birthday: contact.birthday
        ? {
            month: contact.birthday.month,
            day: contact.birthday.day,
            year: contact.birthday.year ?? null,
          }
        : null,
      matchedUser: match
        ? {
            id: match.id,
            username: match.username,
            displayName: match.profile?.displayName ?? match.username,
            avatarUrl: match.profile?.avatarUrl ?? null,
          }
        : null,
      alreadyTracked:
        trackedExternalIds.has(contact.externalId) || (match ? trackedUserIds.has(match.id) : false),
    };
  });
}

export async function confirmContactImport(
  ownerId: string,
  input: ConfirmContactImportInput,
): Promise<{ imported: number; skipped: number }> {
  let imported = 0;
  let skipped = 0;

  for (const selection of input.selections) {
    // Upsert on (owner, externalContactId) so re-importing the address book
    // updates entries instead of creating a second copy of every contact.
    const existing = await prisma.trackedBirthday.findUnique({
      where: {
        ownerId_externalContactId: { ownerId, externalContactId: selection.externalId },
      },
      select: { id: true },
    });

    if (existing) {
      await prisma.trackedBirthday.update({
        where: { id: existing.id },
        data: {
          name: selection.name,
          birthMonth: selection.birthday.month,
          birthDay: selection.birthday.day,
          birthYear: selection.birthday.year ?? null,
          phone: selection.phone ?? null,
          email: selection.email ?? null,
          relationship: selection.relationship,
          deletedAt: null,
        },
      });
      skipped += 1;
      continue;
    }

    await prisma.trackedBirthday.create({
      data: {
        ownerId,
        externalContactId: selection.externalId,
        name: selection.name,
        birthMonth: selection.birthday.month,
        birthDay: selection.birthday.day,
        birthYear: selection.birthday.year ?? null,
        phone: selection.phone ?? null,
        email: selection.email ?? null,
        relationship: selection.relationship,
        source: 'CONTACT_IMPORT',
      },
    });
    imported += 1;
  }

  return { imported, skipped };
}

/* -------------------------------- invites -------------------------------- */

export async function createInvite(
  inviterId: string,
  input: CreateInviteInput,
): Promise<InviteDto> {
  if (input.trackedBirthdayId) {
    const owned = await prisma.trackedBirthday.findFirst({
      where: { id: input.trackedBirthdayId, ownerId: inviterId, deletedAt: null },
      select: { id: true },
    });
    if (!owned) throw new AppError('NOT_FOUND', { message: 'That birthday is not on your calendar.' });
  }

  const code = await uniqueInviteCode();
  const invite = await prisma.invite.create({
    data: {
      code,
      inviterId,
      trackedBirthdayId: input.trackedBirthdayId ?? null,
      expiresAt: addDays(new Date(), input.expiresInDays),
    },
    select: { code: true, expiresAt: true, acceptedAt: true },
  });

  const url = `${env.WEB_BASE_URL}/invite/${invite.code}`;
  return {
    code: invite.code,
    url,
    qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 512 }),
    expiresAt: invite.expiresAt?.toISOString() ?? null,
    acceptedAt: invite.acceptedAt?.toISOString() ?? null,
  };
}

async function uniqueInviteCode(): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = humanCode(8);
    const taken = await prisma.invite.findUnique({ where: { code }, select: { id: true } });
    if (!taken) return code;
  }
  throw new AppError('INTERNAL_ERROR', { message: 'Could not generate an invite code.' });
}

export async function listInvites(inviterId: string): Promise<InviteDto[]> {
  const invites = await prisma.invite.findMany({
    where: { inviterId },
    orderBy: { createdAt: 'desc' },
    take: 50,
    select: { code: true, expiresAt: true, acceptedAt: true },
  });

  return Promise.all(
    invites.map(async (invite) => {
      const url = `${env.WEB_BASE_URL}/invite/${invite.code}`;
      return {
        code: invite.code,
        url,
        qrDataUrl: await QRCode.toDataURL(url, { margin: 1, width: 512 }),
        expiresAt: invite.expiresAt?.toISOString() ?? null,
        acceptedAt: invite.acceptedAt?.toISOString() ?? null,
      };
    }),
  );
}

/** Public preview of an invite, for the "you were invited by X" landing page. */
export async function previewInvite(code: string) {
  const invite = await prisma.invite.findUnique({
    where: { code: code.trim().toUpperCase() },
    select: {
      code: true,
      expiresAt: true,
      acceptedAt: true,
      inviter: {
        select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } },
      },
    },
  });
  if (!invite) throw new AppError('NOT_FOUND', { message: 'That invite link is not valid.' });

  const expired = invite.expiresAt != null && invite.expiresAt.getTime() < Date.now();
  return {
    code: invite.code,
    valid: !expired && invite.acceptedAt == null,
    expired,
    alreadyAccepted: invite.acceptedAt != null,
    inviter: {
      id: invite.inviter.id,
      username: invite.inviter.username,
      displayName: invite.inviter.profile?.displayName ?? invite.inviter.username,
      avatarUrl: invite.inviter.profile?.avatarUrl ?? null,
    },
  };
}

/* ------------------------------- birthday day ------------------------------- */

/**
 * Whether it is the user's own birthday, plus the counts that drive the
 * celebration screen (spec §22).
 */
export async function myBirthdayToday(
  userId: string,
  now = new Date(),
): Promise<{ wishCount: number; giftCount: number; hasSurprise: boolean } | null> {
  const profile = await prisma.profile.findUnique({
    where: { userId },
    select: { birthMonth: true, birthDay: true, birthYear: true },
  });
  if (profile?.birthMonth == null || profile.birthDay == null) return null;

  const countdown = getBirthdayCountdown(
    { month: profile.birthMonth, day: profile.birthDay, year: profile.birthYear },
    now,
  );
  if (!countdown.isToday) return null;

  const year = now.getFullYear();
  const [wishCount, digitalGifts, reservations, surprises] = await Promise.all([
    prisma.birthdayMessage.count({
      where: {
        recipientUserId: userId,
        celebrationYear: year,
        OR: [{ deliverAt: null }, { deliverAt: { lte: now } }],
      },
    }),
    prisma.digitalGift.count({
      where: { recipientUserId: userId, deliveredAt: { not: null }, openedAt: null },
    }),
    prisma.giftReservation.count({
      where: {
        status: { in: ['PURCHASED', 'DELIVERED'] },
        wishlistItem: { wishlist: { ownerId: userId } },
      },
    }),
    prisma.surprise.count({ where: { beneficiaryUserId: userId, revealedAt: null } }),
  ]);

  return {
    wishCount,
    giftCount: digitalGifts + reservations,
    // Only the existence of a surprise is revealed — never what or who.
    hasSurprise: surprises > 0,
  };
}
