import { ALLOWED_REMINDER_OFFSETS_DAYS, celebrationDayInYear } from '@bday/shared';
import { addCivilDays, civilDaysBetween, safeTimeZone, zonedNow, type CivilDate } from '../lib/dates';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { notify, recordDispatch } from './notification.service';
import { deliverWishNotification } from './wish.service';

/**
 * Birthday reminders (spec §21, §22, §58 rule 7).
 *
 * Runs every few minutes. For each user whose local clock has passed their
 * digest hour, it works out which of their tracked birthdays land on one of
 * their reminder offsets today and notifies once per (person, year, offset).
 *
 * Exactly-once comes from claiming `reminder:<trackedBirthdayId>:<year>:<offset>`
 * in `notification_dispatches` *before* creating the notification — the unique
 * index means a second worker, or a restart mid-batch, simply loses the claim.
 */

const BATCH = 500;

function daysUntilCelebration(month: number, day: number, today: CivilDate): { days: number; year: number } {
  let year = today.year;
  let celebration = celebrationDayInYear({ month, day }, year);
  let days = civilDaysBetween(today, { year, ...celebration });
  if (days < 0) {
    year += 1;
    celebration = celebrationDayInYear({ month, day }, year);
    days = civilDaysBetween(today, { year, ...celebration });
  }
  return { days, year };
}

/** Month/day pairs that could be `offset` days away from `today`. */
function candidateDates(today: CivilDate): Array<{ birthMonth: number; birthDay: number }> {
  const pairs = new Map<string, { birthMonth: number; birthDay: number }>();
  for (const offset of ALLOWED_REMINDER_OFFSETS_DAYS) {
    const date = addCivilDays(today, offset);
    pairs.set(`${date.month}-${date.day}`, { birthMonth: date.month, birthDay: date.day });
    // 29 Feb birthdays are celebrated on 28 Feb in common years.
    if (date.month === 2 && date.day === 28) pairs.set('2-29', { birthMonth: 2, birthDay: 29 });
  }
  return [...pairs.values()];
}

function reminderCopy(name: string, days: number, turningAge: number | null) {
  const firstName = name.split(' ')[0] ?? name;
  if (days === 0) {
    return {
      type: 'BIRTHDAY_TODAY' as const,
      title: `🎉 It's ${firstName}'s birthday today!`,
      body: turningAge ? `${firstName} turns ${turningAge}. Send a wish or a gift.` : 'Send a wish or a gift to make their day.',
    };
  }
  if (days === 1) {
    return { type: 'BIRTHDAY_REMINDER' as const, title: `🎂 ${firstName}'s birthday is tomorrow`, body: 'There is still time to send something special.' };
  }
  return {
    type: 'BIRTHDAY_REMINDER' as const,
    title: `🎂 ${firstName}'s birthday is in ${days} days`,
    body: days >= 7 ? 'Plenty of time to plan the perfect gift.' : 'Time to pick a gift or plan a surprise.',
  };
}

export async function runBirthdayReminders(now = new Date()): Promise<{ usersChecked: number; sent: number }> {
  let cursor: string | undefined;
  let usersChecked = 0;
  let sent = 0;

  for (;;) {
    const users = await prisma.user.findMany({
      where: { deletedAt: null, status: { in: ['ACTIVE', 'PENDING_VERIFICATION'] } },
      orderBy: { id: 'asc' },
      take: BATCH,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: {
        id: true,
        notificationPreference: { select: { reminderOffsetsDays: true, digestHour: true, timezone: true, mutedTypes: true } },
        profile: { select: { timezone: true, birthMonth: true, birthDay: true, displayName: true } },
      },
    });
    if (users.length === 0) break;
    cursor = users[users.length - 1]!.id;

    for (const user of users) {
      usersChecked += 1;
      const zone = safeTimeZone(user.notificationPreference?.timezone ?? user.profile?.timezone);
      const local = zonedNow(zone, now);
      const digestHour = user.notificationPreference?.digestHour ?? 8;
      if (local.hour < digestHour) continue;

      try {
        sent += await remindUser(user, local);
        sent += await celebrateOwnBirthday(user, local);
      } catch (error) {
        logger.warn({ err: error, userId: user.id }, 'reminders failed for user');
      }
    }

    if (users.length < BATCH) break;
  }

  return { usersChecked, sent };
}

async function remindUser(
  user: { id: string; notificationPreference: { reminderOffsetsDays: number[]; mutedTypes: string[] } | null },
  today: CivilDate,
): Promise<number> {
  const defaults = user.notificationPreference?.reminderOffsetsDays ?? [30, 14, 7, 3, 1, 0];
  const tracked = await prisma.trackedBirthday.findMany({
    where: { ownerId: user.id, deletedAt: null, OR: candidateDates(today) },
    select: { id: true, name: true, birthMonth: true, birthDay: true, birthYear: true, reminderOffsetsDays: true, linkedUserId: true },
  });

  let sent = 0;
  for (const person of tracked) {
    const offsets = person.reminderOffsetsDays.length > 0 ? person.reminderOffsetsDays : defaults;
    const { days, year } = daysUntilCelebration(person.birthMonth, person.birthDay, today);
    if (!offsets.includes(days)) continue;

    const dedupeKey = `reminder:${person.id}:${year}:${days}`;
    const claimed = await recordDispatch(prisma, {
      userId: user.id,
      channel: 'IN_APP',
      status: 'SENT',
      dedupeKey,
      trackedBirthdayId: person.id,
    });
    if (!claimed) continue;

    const copy = reminderCopy(person.name, days, person.birthYear ? year - person.birthYear : null);
    await notify({
      userId: user.id,
      type: copy.type,
      title: copy.title,
      body: copy.body,
      deepLink: `birthdays/${person.id}`,
      data: { trackedBirthdayId: person.id, daysUntil: days, linkedUserId: person.linkedUserId },
      dedupeKey: `push:${dedupeKey}`,
    });
    sent += 1;
  }
  return sent;
}

/** Birthday morning for the user themself (spec §22). */
async function celebrateOwnBirthday(
  user: { id: string; profile: { birthMonth: number | null; birthDay: number | null; displayName: string } | null },
  today: CivilDate,
): Promise<number> {
  const profile = user.profile;
  if (profile?.birthMonth == null || profile.birthDay == null) return 0;
  const { days, year } = daysUntilCelebration(profile.birthMonth, profile.birthDay, today);
  if (days !== 0) return 0;

  const dedupeKey = `own-birthday:${user.id}:${year}`;
  const claimed = await recordDispatch(prisma, { userId: user.id, channel: 'IN_APP', status: 'SENT', dedupeKey });
  if (!claimed) return 0;

  const [wishCount, giftCount] = await Promise.all([
    prisma.birthdayMessage.count({ where: { recipientUserId: user.id, celebrationYear: year, deliveredAt: { not: null } } }),
    prisma.digitalGift.count({ where: { recipientUserId: user.id, deliveredAt: { not: null }, openedAt: null } }),
  ]);

  const firstName = profile.displayName.split(' ')[0] ?? profile.displayName;
  const extras = [
    wishCount > 0 ? `${wishCount} ${wishCount === 1 ? 'wish' : 'wishes'}` : null,
    giftCount > 0 ? `${giftCount} ${giftCount === 1 ? 'gift' : 'gifts'} waiting` : null,
  ].filter(Boolean);

  await notify({
    userId: user.id,
    type: 'BIRTHDAY_TODAY',
    title: `🎉 Happy birthday, ${firstName}!`,
    body: extras.length > 0 ? `You have ${extras.join(' and ')}.` : 'Your friends are celebrating you today.',
    deepLink: 'celebration',
    data: { celebrationYear: year },
    dedupeKey: `push:${dedupeKey}`,
  });
  return 1;
}

/** Wishes written ahead of time whose moment has arrived. */
export async function releaseScheduledWishes(limit = 500): Promise<number> {
  const due = await prisma.birthdayMessage.findMany({
    where: { deliveredAt: null, deliverAt: { lte: new Date() } },
    orderBy: { deliverAt: 'asc' },
    take: limit,
    select: { id: true },
  });
  let released = 0;
  for (const wish of due) {
    const claimed = await prisma.birthdayMessage.updateMany({
      where: { id: wish.id, deliveredAt: null },
      data: { deliveredAt: new Date() },
    });
    if (claimed.count === 0) continue;
    released += 1;
    await deliverWishNotification(wish.id).catch((error: unknown) => logger.warn({ err: error, wishId: wish.id }, 'wish delivery failed'));
  }
  return released;
}

/** Premium lapses when its paid period ends. */
export async function expirePremium(): Promise<number> {
  const result = await prisma.user.updateMany({
    where: { isPremium: true, premiumUntil: { lt: new Date() } },
    data: { isPremium: false },
  });
  return result.count;
}
