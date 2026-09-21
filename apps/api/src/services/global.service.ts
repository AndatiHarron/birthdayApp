import {
  GLOBAL_BIRTHDAYS,
  celebrationDayInYear,
  type BirthdayTwinsDto,
  type CheerInput,
  type CheerResultDto,
  type GlobalCelebrantDto,
  type GlobalIneligibleReason,
  type GlobalStatusDto,
  type GlobalTodayDto,
  type GlobalTodayQuery,
  type UpdateGlobalSettingsInput,
} from '@bday/shared';
import { Prisma, type UserStatus } from '@prisma/client';
import { createHash } from 'node:crypto';
import { addCivilDays, zonedNow, type CivilDate } from '../lib/dates';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { areFriends, isBlockedEitherWay } from './access.service';
import { notify } from './notification.service';

/**
 * Global birthdays: celebrating people you have never met.
 *
 * The rules, in one place so every entry point agrees:
 *   * Nobody is visible or reachable by strangers unless they opted in
 *     (`privacy.celebrateGlobally`), and only verified adults can opt in or
 *     reach out — minors are never shown to strangers and never shown them.
 *   * Strangers may send wishes, cheers and digital gifts (money included).
 *     Physical gifts need a real connection; that rule lives in the order,
 *     reservation and group-gift services via `assertKnownForPhysicalGift`.
 *   * Per-sender daily caps keep it from becoming a spam or fraud channel.
 *   * The feed shows the least-celebrated people first, so the point of the
 *     feature — nobody's birthday going unnoticed — is built into the ordering.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

type BirthParts = { birthMonth: number | null; birthDay: number | null; birthYear: number | null };

interface Eligibility {
  eligible: boolean;
  reason: GlobalIneligibleReason;
}

function eligibility(user: { status: UserStatus; profile: (BirthParts & { timezone: string }) | null } | null): Eligibility {
  if (!user || user.status !== 'ACTIVE') return { eligible: false, reason: 'NOT_VERIFIED' };
  const profile = user.profile;
  if (!profile || profile.birthYear == null || profile.birthMonth == null || profile.birthDay == null) {
    return { eligible: false, reason: 'NO_BIRTH_YEAR' };
  }
  const age = ageOn(profile, zonedNow(profile.timezone));
  return age >= GLOBAL_BIRTHDAYS.minAge ? { eligible: true, reason: null } : { eligible: false, reason: 'UNDER_AGE' };
}

/** Age on a civil date (the person's own "today"), birthday counted from its celebration day. */
function ageOn(profile: BirthParts, today: CivilDate): number {
  const celebration = celebrationDayInYear({ month: profile.birthMonth!, day: profile.birthDay! }, today.year);
  const hadBirthday = today.month > celebration.month || (today.month === celebration.month && today.day >= celebration.day);
  return today.year - profile.birthYear! - (hadBirthday ? 0 : 1);
}

/** Whether it is this person's birthday right now where they live, and which year's. */
function birthdayToday(profile: BirthParts & { timezone: string }, at: Date): { isToday: boolean; year: number } {
  const local = zonedNow(profile.timezone, at);
  if (profile.birthMonth == null || profile.birthDay == null) return { isToday: false, year: local.year };
  const celebration = celebrationDayInYear({ month: profile.birthMonth, day: profile.birthDay }, local.year);
  return { isToday: celebration.month === local.month && celebration.day === local.day, year: local.year };
}

/** The most recent celebration (today counts), so counts keep meaning after the day. */
function recentCelebrationYear(profile: BirthParts & { timezone: string }, at: Date): number {
  const local = zonedNow(profile.timezone, at);
  if (profile.birthMonth == null || profile.birthDay == null) return local.year;
  const celebration = celebrationDayInYear({ month: profile.birthMonth, day: profile.birthDay }, local.year);
  const reached = local.month > celebration.month || (local.month === celebration.month && local.day >= celebration.day);
  return reached ? local.year : local.year - 1;
}

const PERSON_SELECT = {
  status: true,
  profile: { select: { birthMonth: true, birthDay: true, birthYear: true, timezone: true } },
  privacy: { select: { celebrateGlobally: true } },
} as const;

/* ------------------------------ reach checks ------------------------------ */

export type ReachKind = 'WISH' | 'GIFT' | 'CHEER';

/**
 * May `senderId` send this to `recipientId`? Connected people always may.
 * Strangers may only reach an opted-in adult, only as a verified adult
 * themselves, and only within their daily cap. Callers check blocking first.
 */
export async function assertCanReach(senderId: string, recipientId: string, kind: ReachKind): Promise<{ fromStranger: boolean }> {
  if (await areFriends(senderId, recipientId)) return { fromStranger: false };

  const [sender, recipient] = await Promise.all([
    prisma.user.findUnique({ where: { id: senderId }, select: PERSON_SELECT }),
    prisma.user.findUnique({ where: { id: recipientId }, select: PERSON_SELECT }),
  ]);
  if (!recipient?.privacy?.celebrateGlobally || !eligibility(recipient).eligible) {
    throw new AppError('RECIPIENT_NOT_ACCEPTING');
  }
  if (!eligibility(sender).eligible) throw new AppError('GLOBAL_CELEBRATION_NOT_ELIGIBLE');

  const since = new Date(Date.now() - DAY_MS);
  const [count, cap] =
    kind === 'WISH'
      ? [await prisma.birthdayMessage.count({ where: { senderId, fromStranger: true, createdAt: { gte: since } } }), GLOBAL_BIRTHDAYS.strangerWishesPerDay]
      : kind === 'GIFT'
        ? [await prisma.digitalGift.count({ where: { senderId, fromStranger: true, createdAt: { gte: since } } }), GLOBAL_BIRTHDAYS.strangerGiftsPerDay]
        : [await prisma.birthdayCheer.count({ where: { fromUserId: senderId, createdAt: { gte: since } } }), GLOBAL_BIRTHDAYS.cheersPerDay];
  if (count >= cap) throw new AppError('STRANGER_LIMIT_REACHED');

  return { fromStranger: true };
}

/**
 * Physical gifts (orders, reservations, group gifts) go only to people you are
 * connected with — unless they published a link-in-bio page and switched on
 * gifting from it, which is an explicit invitation to anyone holding the link.
 */
export async function assertKnownForPhysicalGift(senderId: string, recipientId: string): Promise<void> {
  if (senderId === recipientId) return;
  if (await areFriends(senderId, recipientId)) return;
  if (await acceptsGiftsFromAnyone(recipientId)) return;
  throw new AppError('PHYSICAL_GIFT_REQUIRES_CONNECTION');
}

/** True when this person invites gifts from anyone with their public link. */
export async function acceptsGiftsFromAnyone(userId: string): Promise<boolean> {
  const privacy = await prisma.privacySetting.findUnique({ where: { userId }, select: { publicPage: true, publicGifting: true } });
  return Boolean(privacy?.publicPage && privacy.publicGifting);
}

/* -------------------------------- settings -------------------------------- */

export async function getGlobalStatus(userId: string): Promise<GlobalStatusDto> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: {
      status: true,
      profile: {
        select: { birthMonth: true, birthDay: true, birthYear: true, timezone: true, celebrationNote: true, firstCelebration: true },
      },
      privacy: { select: { celebrateGlobally: true } },
    },
  });
  const now = new Date();
  const { eligible, reason } = eligibility(user);
  const profile = user.profile;
  const today = profile ? birthdayToday(profile, now) : { isToday: false, year: now.getUTCFullYear() };
  const year = profile ? recentCelebrationYear(profile, now) : now.getUTCFullYear();
  const since = new Date(now.getTime() - DAY_MS);
  const giftWindowStart = new Date(Date.UTC(year, (profile?.birthMonth ?? 1) - 1, profile?.birthDay ?? 1) - 30 * DAY_MS);

  const [cheersReceived, strangerWishesReceived, strangerGiftsReceived, cheered, wished, gifted] = await Promise.all([
    prisma.birthdayCheer.count({ where: { toUserId: userId, celebrationYear: year } }),
    prisma.birthdayMessage.count({ where: { recipientUserId: userId, fromStranger: true, celebrationYear: year, deliveredAt: { not: null } } }),
    prisma.digitalGift.count({ where: { recipientUserId: userId, fromStranger: true, deliveredAt: { gte: giftWindowStart } } }),
    prisma.birthdayCheer.findMany({ where: { fromUserId: userId, createdAt: { gte: since } }, select: { toUserId: true } }),
    prisma.birthdayMessage.findMany({ where: { senderId: userId, fromStranger: true, createdAt: { gte: since } }, select: { recipientUserId: true } }),
    prisma.digitalGift.findMany({ where: { senderId: userId, fromStranger: true, createdAt: { gte: since } }, select: { recipientUserId: true } }),
  ]);
  const people = new Set<string>([
    ...cheered.map((row) => row.toUserId),
    ...wished.map((row) => row.recipientUserId),
    ...gifted.flatMap((row) => (row.recipientUserId ? [row.recipientUserId] : [])),
  ]);

  return {
    celebrateGlobally: (user.privacy?.celebrateGlobally ?? false) && eligible,
    celebrationNote: profile?.celebrationNote ?? null,
    firstCelebration: profile?.firstCelebration ?? false,
    eligible,
    ineligibleReason: reason,
    isMyBirthdayToday: today.isToday,
    cheersReceived,
    strangerWishesReceived,
    strangerGiftsReceived,
    peopleCelebratedToday: people.size,
  };
}

export async function updateGlobalSettings(userId: string, input: UpdateGlobalSettingsInput): Promise<GlobalStatusDto> {
  if (input.celebrateGlobally === true) {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: PERSON_SELECT });
    if (!eligibility(user).eligible) throw new AppError('GLOBAL_CELEBRATION_NOT_ELIGIBLE');
  }
  await prisma.$transaction(async (tx) => {
    if (input.celebrateGlobally !== undefined) {
      await tx.privacySetting.update({ where: { userId }, data: { celebrateGlobally: input.celebrateGlobally } });
    }
    const profile: Prisma.ProfileUpdateInput = {};
    if (input.celebrationNote !== undefined) profile.celebrationNote = input.celebrationNote;
    if (input.firstCelebration !== undefined) profile.firstCelebration = input.firstCelebration;
    if (Object.keys(profile).length > 0) await tx.profile.update({ where: { userId }, data: profile });
  });
  return getGlobalStatus(userId);
}

/* ---------------------------------- feeds ---------------------------------- */

const CELEBRANT_SELECT = {
  userId: true,
  displayName: true,
  avatarUrl: true,
  city: true,
  countryCode: true,
  birthMonth: true,
  birthDay: true,
  birthYear: true,
  timezone: true,
  celebrationNote: true,
  firstCelebration: true,
  user: { select: { username: true, privacy: { select: { showAge: true } } } },
} as const;

type CelebrantRow = Prisma.ProfileGetPayload<{ select: typeof CELEBRANT_SELECT }>;

/** Only verified adults may browse or reach strangers. */
async function assertViewerEligible(viewerId: string): Promise<void> {
  const viewer = await prisma.user.findUnique({ where: { id: viewerId }, select: PERSON_SELECT });
  if (!eligibility(viewer).eligible) throw new AppError('GLOBAL_CELEBRATION_NOT_ELIGIBLE');
}

async function blockedIds(viewerId: string): Promise<string[]> {
  const rows = await prisma.blockedUser.findMany({
    where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
    select: { blockerId: true, blockedId: true },
  });
  return rows.map((row) => (row.blockerId === viewerId ? row.blockedId : row.blockerId));
}

/** Everyone listed must be an opted-in, active adult (year known, so age is checkable). */
function celebrantWhere(viewerId: string, exclude: string[], maxBirthYear: number): Prisma.ProfileWhereInput {
  return {
    userId: { notIn: [viewerId, ...exclude] },
    birthYear: { not: null, lte: maxBirthYear },
    user: { status: 'ACTIVE', deletedAt: null, privacy: { celebrateGlobally: true } },
  };
}

/** Stable per-day shuffle, so equal-priority people rotate instead of the same faces topping every list. */
function dailyRank(userId: string, dayKey: string): string {
  return createHash('sha1').update(`${dayKey}:${userId}`).digest('hex');
}

async function toCelebrants(viewerId: string, rows: Array<{ row: CelebrantRow; isToday: boolean; year: number }>): Promise<GlobalCelebrantDto[]> {
  const today = rows.filter((entry) => entry.isToday);
  const ids = today.map((entry) => entry.row.userId);
  const years = Array.from(new Set(today.map((entry) => entry.year)));

  const [cheers, wishes, mine] = ids.length
    ? await Promise.all([
        prisma.birthdayCheer.groupBy({ by: ['toUserId'], where: { toUserId: { in: ids }, celebrationYear: { in: years } }, _count: { _all: true } }),
        prisma.birthdayMessage.groupBy({
          by: ['recipientUserId'],
          where: { recipientUserId: { in: ids }, celebrationYear: { in: years }, deliveredAt: { not: null } },
          _count: { _all: true },
        }),
        prisma.birthdayCheer.findMany({ where: { fromUserId: viewerId, toUserId: { in: ids }, celebrationYear: { in: years } }, select: { toUserId: true } }),
      ])
    : [[], [], []];
  const cheerCount = new Map(cheers.map((row) => [row.toUserId, row._count._all]));
  const wishCount = new Map(wishes.map((row) => [row.recipientUserId, row._count._all]));
  const cheeredByMe = new Set(mine.map((row) => row.toUserId));

  return rows.map(({ row, isToday }) => {
    const local = zonedNow(row.timezone);
    return {
      userId: row.userId,
      username: row.user.username,
      displayName: row.displayName,
      avatarUrl: row.avatarUrl,
      city: row.city,
      countryCode: row.countryCode,
      turningAge: isToday && (row.user.privacy?.showAge ?? true) ? ageOn(row, local) : null,
      note: row.celebrationNote,
      firstCelebration: row.firstCelebration,
      cheerCount: cheerCount.get(row.userId) ?? 0,
      wishCount: wishCount.get(row.userId) ?? 0,
      cheeredByMe: cheeredByMe.has(row.userId),
      isToday,
    };
  });
}

/** Least-celebrated first; first-ever celebrations before everyone. */
function byLeastCelebrated(dayKey: string) {
  return (a: GlobalCelebrantDto, b: GlobalCelebrantDto): number =>
    Number(b.firstCelebration) - Number(a.firstCelebration) ||
    a.cheerCount + a.wishCount - (b.cheerCount + b.wishCount) ||
    dailyRank(a.userId, dayKey).localeCompare(dailyRank(b.userId, dayKey));
}

/**
 * Everyone whose birthday is today where they live. "Today" differs by time
 * zone, so the candidates are birthdays on yesterday/today/tomorrow (UTC),
 * narrowed to those whose own local date matches.
 */
export async function listCelebratingToday(viewerId: string, query: GlobalTodayQuery): Promise<GlobalTodayDto> {
  await assertViewerEligible(viewerId);
  const now = new Date();
  const utc = zonedNow('UTC', now);
  const pairs = new Map<string, { birthMonth: number; birthDay: number }>();
  for (const offset of [-1, 0, 1]) {
    const date = addCivilDays(utc, offset);
    pairs.set(`${date.month}-${date.day}`, { birthMonth: date.month, birthDay: date.day });
    // 29 February birthdays are celebrated on the 28th in common years.
    if (date.month === 2 && date.day === 28 && celebrationDayInYear({ month: 2, day: 29 }, date.year).day === 28) {
      pairs.set('2-29', { birthMonth: 2, birthDay: 29 });
    }
  }

  const rows = await prisma.profile.findMany({
    where: {
      ...celebrantWhere(viewerId, await blockedIds(viewerId), utc.year - GLOBAL_BIRTHDAYS.minAge + 1),
      OR: Array.from(pairs.values()),
      ...(query.country ? { countryCode: query.country } : {}),
    },
    select: CELEBRANT_SELECT,
    take: 2000,
  });

  const celebrating = rows
    .map((row) => ({ row, ...birthdayToday(row, now) }))
    .filter((entry) => entry.isToday && ageOn(entry.row, zonedNow(entry.row.timezone, now)) >= GLOBAL_BIRTHDAYS.minAge);

  const items = (await toCelebrants(viewerId, celebrating)).sort(byLeastCelebrated(`${utc.year}-${utc.month}-${utc.day}`));
  return {
    totalCelebrating: items.length,
    countries: new Set(items.map((item) => item.countryCode)).size,
    items: items.slice(0, query.limit),
  };
}

/** People who share your birthday (day and month), anywhere in the world. */
export async function listBirthdayTwins(viewerId: string): Promise<BirthdayTwinsDto> {
  await assertViewerEligible(viewerId);
  const me = await prisma.profile.findUniqueOrThrow({ where: { userId: viewerId }, select: { birthMonth: true, birthDay: true } });
  if (me.birthMonth == null || me.birthDay == null) return { month: null, day: null, total: 0, items: [] };

  const now = new Date();
  const utc = zonedNow('UTC', now);
  const where: Prisma.ProfileWhereInput = {
    ...celebrantWhere(viewerId, await blockedIds(viewerId), utc.year - GLOBAL_BIRTHDAYS.minAge + 1),
    birthMonth: me.birthMonth,
    birthDay: me.birthDay,
  };
  const [total, rows] = await Promise.all([prisma.profile.count({ where }), prisma.profile.findMany({ where, select: CELEBRANT_SELECT, take: 500 })]);

  const adults = rows
    .map((row) => ({ row, ...birthdayToday(row, now) }))
    .filter((entry) => ageOn(entry.row, zonedNow(entry.row.timezone, now)) >= GLOBAL_BIRTHDAYS.minAge);
  const items = (await toCelebrants(viewerId, adults)).sort(byLeastCelebrated(`${utc.year}-${utc.month}-${utc.day}`));
  return { month: me.birthMonth, day: me.birthDay, total, items: items.slice(0, 50) };
}

/* --------------------------------- cheers --------------------------------- */

/** A one-tap "happy birthday" on the day itself. Idempotent per person per year. */
export async function cheer(fromUserId: string, toUserId: string, input: CheerInput): Promise<CheerResultDto> {
  if (fromUserId === toUserId) throw new AppError('VALIDATION_ERROR', { message: 'You cannot cheer yourself, but happy birthday!' });
  if (await isBlockedEitherWay(fromUserId, toUserId)) throw new AppError('BLOCKED_BY_USER');

  const recipient = await prisma.profile.findFirst({
    where: { userId: toUserId, user: { deletedAt: null } },
    select: { birthMonth: true, birthDay: true, birthYear: true, timezone: true },
  });
  if (!recipient) throw new AppError('NOT_FOUND', { message: 'That account could not be found.' });
  const { isToday, year } = birthdayToday(recipient, new Date());
  if (!isToday) throw new AppError('NOT_BIRTHDAY_TODAY');

  await assertCanReach(fromUserId, toUserId, 'CHEER');

  let created = true;
  try {
    await prisma.birthdayCheer.create({ data: { fromUserId, toUserId, celebrationYear: year, emoji: input.emoji } });
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    created = false;
  }

  const cheerCount = await prisma.birthdayCheer.count({ where: { toUserId, celebrationYear: year } });
  if (created && (GLOBAL_BIRTHDAYS.cheerMilestones as readonly number[]).includes(cheerCount)) {
    await notify({
      userId: toUserId,
      type: 'BIRTHDAY_CHEER',
      title: cheerCount === 1 ? '🌍 Someone just celebrated your birthday!' : `🎉 ${cheerCount} people have celebrated you today!`,
      body: cheerCount === 1 ? 'You are being noticed today. Open the app to see the love.' : 'People around the world see you. Happy birthday!',
      deepLink: 'global',
      data: { cheerCount },
    }).catch(() => undefined);
  }
  return { cheerCount, cheeredByMe: true };
}
