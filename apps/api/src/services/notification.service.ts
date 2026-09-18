import type {
  MarkNotificationsReadInput,
  NotificationDto,
  NotificationQueryInput,
  Paginated,
} from '@bday/shared';
import type { NotificationType, Prisma } from '@prisma/client';
import { env } from '../config/env';
import { isWithinQuietHours, zonedNow } from '../lib/dates';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { prisma, type Db } from '../lib/prisma';
import { decodeCursor, encodeCursor } from '../lib/response';
import { push } from '../providers/push';
import { RealtimeEvent, emitToUser } from '../realtime/emitter';

/**
 * Notifications (spec §28, §58 rule 7).
 *
 * Every notification is persisted first and delivered second. The in-app list
 * is therefore the source of truth: a muted type, a quiet hour or a failed push
 * changes whether a device buzzes, never whether the user can find the event
 * later.
 */

export interface NotifyInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  deepLink?: string | null;
  imageUrl?: string | null;
  data?: Record<string, unknown>;
  /** Skip the push even if the user allows it (for low-value updates). */
  silent?: boolean;
  /** Makes repeat sends idempotent; see NotificationDispatch.dedupeKey. */
  dedupeKey?: string;
  db?: Db;
}

function deepLinkUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path;
  return `${env.APP_DEEP_LINK_SCHEME}://${path.replace(/^\/+/, '')}`;
}

/**
 * Creates a notification, pushes it, and mirrors it over the socket.
 *
 * Never throws for delivery problems: a failed push must not roll back the
 * action that caused it (a reserved gift stays reserved even if the gifter's
 * phone is unreachable).
 */
export async function notify(input: NotifyInput): Promise<{ id: string } | null> {
  const db = input.db ?? prisma;

  const preference = await db.notificationPreference.findUnique({
    where: { userId: input.userId },
    select: {
      pushEnabled: true,
      mutedTypes: true,
      quietHoursStart: true,
      quietHoursEnd: true,
      timezone: true,
    },
  });

  if (preference?.mutedTypes.includes(input.type)) {
    return null;
  }

  const notification = await db.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      imageUrl: input.imageUrl ?? null,
      deepLink: deepLinkUrl(input.deepLink),
      data: (input.data ?? {}) as Prisma.InputJsonValue,
    },
    select: { id: true, type: true, title: true, body: true, imageUrl: true, deepLink: true, data: true, createdAt: true },
  });

  emitToUser(input.userId, RealtimeEvent.NOTIFICATION_CREATED, toNotificationDto({ ...notification, readAt: null }));

  if (input.silent || preference?.pushEnabled === false) {
    return { id: notification.id };
  }

  const zone = preference?.timezone ?? 'Africa/Nairobi';
  const { hour } = zonedNow(zone);
  if (isWithinQuietHours(hour, preference?.quietHoursStart, preference?.quietHoursEnd)) {
    await recordDispatch(db, {
      notificationId: notification.id,
      userId: input.userId,
      channel: 'PUSH',
      status: 'SKIPPED',
      dedupeKey: input.dedupeKey ?? `quiet:${notification.id}`,
      error: 'quiet hours',
    });
    return { id: notification.id };
  }

  await sendPush(db, {
    notificationId: notification.id,
    userId: input.userId,
    title: input.title,
    body: input.body,
    data: { ...(input.data ?? {}), type: input.type, deepLink: deepLinkUrl(input.deepLink) },
    dedupeKey: input.dedupeKey ?? `push:${notification.id}`,
  });

  return { id: notification.id };
}

/** Same as `notify`, for many recipients, without N round trips of preferences. */
export async function notifyMany(
  userIds: string[],
  input: Omit<NotifyInput, 'userId'>,
): Promise<void> {
  const unique = Array.from(new Set(userIds));
  for (const userId of unique) {
    await notify({ ...input, userId }).catch((error: unknown) =>
      logger.warn({ err: error, userId, type: input.type }, 'notification failed'),
    );
  }
}

interface DispatchInput {
  notificationId?: string | null;
  userId: string;
  channel: 'PUSH' | 'EMAIL' | 'SMS' | 'IN_APP';
  status: 'QUEUED' | 'SENT' | 'FAILED' | 'SKIPPED';
  dedupeKey: string;
  providerRef?: string | null;
  error?: string | null;
  trackedBirthdayId?: string | null;
}

/**
 * Records a delivery attempt.
 *
 * The unique `dedupeKey` is the real mechanism behind "a restarted reminder
 * worker does not ping everyone twice", so a duplicate key is an expected
 * outcome rather than an error.
 */
export async function recordDispatch(db: Db, input: DispatchInput): Promise<boolean> {
  try {
    await db.notificationDispatch.create({
      data: {
        notificationId: input.notificationId ?? null,
        userId: input.userId,
        channel: input.channel,
        status: input.status,
        dedupeKey: input.dedupeKey,
        providerRef: input.providerRef ?? null,
        error: input.error ?? null,
        trackedBirthdayId: input.trackedBirthdayId ?? null,
        attemptedAt: new Date(),
      },
    });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === 'P2002') return false;
    logger.warn({ err: error, dedupeKey: input.dedupeKey }, 'dispatch record failed');
    return false;
  }
}

async function sendPush(
  db: Db,
  input: {
    notificationId: string | null;
    userId: string;
    title: string;
    body: string;
    data: Record<string, unknown>;
    dedupeKey: string;
  },
): Promise<void> {
  const devices = await db.device.findMany({
    where: { userId: input.userId, pushToken: { not: null } },
    select: { id: true, pushToken: true },
  });
  const tokens = devices.map((device) => device.pushToken!).filter(Boolean);
  if (tokens.length === 0) return;

  const claimed = await recordDispatch(db, {
    notificationId: input.notificationId,
    userId: input.userId,
    channel: 'PUSH',
    status: 'QUEUED',
    dedupeKey: input.dedupeKey,
  });
  if (!claimed) return;

  try {
    const result = await push().send({
      tokens,
      title: input.title,
      body: input.body,
      data: input.data,
    });

    if (result.invalidTokens.length > 0) {
      // Expo reports tokens the OS has retired. Keeping them would make every
      // future send to this user look partially failed.
      await db.device.updateMany({
        where: { pushToken: { in: result.invalidTokens } },
        data: { pushToken: null },
      });
    }

    await db.notificationDispatch.updateMany({
      where: { dedupeKey: input.dedupeKey },
      data: { status: result.sent > 0 ? 'SENT' : 'FAILED', attemptedAt: new Date() },
    });
  } catch (error) {
    logger.warn({ err: error, userId: input.userId }, 'push send failed');
    await db.notificationDispatch.updateMany({
      where: { dedupeKey: input.dedupeKey },
      data: { status: 'FAILED', error: String(error).slice(0, 480) },
    });
  }
}

/* ------------------------------- reading ------------------------------- */

interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  imageUrl: string | null;
  deepLink: string | null;
  data: Prisma.JsonValue;
  readAt: Date | null;
  createdAt: Date;
}

export function toNotificationDto(row: NotificationRow): NotificationDto {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    imageUrl: row.imageUrl,
    deepLink: row.deepLink,
    data: (row.data as Record<string, unknown>) ?? {},
    readAt: row.readAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listNotifications(
  userId: string,
  input: NotificationQueryInput,
): Promise<Paginated<NotificationDto>> {
  const cursor = decodeCursor<{ createdAt: string; id: string }>(input.cursor);

  const rows = await prisma.notification.findMany({
    where: {
      userId,
      ...(input.unreadOnly ? { readAt: null } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.createdAt) } },
              { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
  });

  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const last = items[items.length - 1];

  return {
    items: items.map(toNotificationDto),
    nextCursor:
      hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
  };
}

export async function unreadCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export async function markRead(userId: string, input: MarkNotificationsReadInput): Promise<number> {
  if (!input.all && (!input.ids || input.ids.length === 0)) {
    throw new AppError('VALIDATION_ERROR', { message: 'Choose what to mark as read.' });
  }
  const result = await prisma.notification.updateMany({
    where: {
      userId,
      readAt: null,
      ...(input.all ? {} : { id: { in: input.ids! } }),
    },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function deleteNotification(userId: string, id: string): Promise<void> {
  const result = await prisma.notification.deleteMany({ where: { id, userId } });
  if (result.count === 0) throw new AppError('NOT_FOUND');
}
