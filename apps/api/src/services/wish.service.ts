import {
  CARD_TEMPLATE_META,
  getBirthdayCountdown,
  type BirthdayCardDto,
  type BirthdayCardInput,
  type BirthdayMessageDto,
  type CardTemplateDto,
  type Paginated,
  type ReactToMessageInput,
  type SendBirthdayMessageInput,
  type SendThankYouInput,
  type ThankYouDto,
} from '@bday/shared';
import type { BirthdayCard, BirthdayMessage, Prisma } from '@prisma/client';
import { AppError } from '../lib/errors';
import { prisma, type Tx } from '../lib/prisma';
import { decodeCursor, encodeCursor } from '../lib/response';
import { RealtimeEvent, emitToUser } from '../realtime/emitter';
import { isBlockedEitherWay } from './access.service';
import { notify } from './notification.service';

/**
 * Birthday wishes, cards and thank-yous (spec §23, §24, §27).
 *
 * Two details carry most of the weight here:
 *
 *   * `celebrationYear` groups wishes by the birthday they belong to, which is
 *     what makes the yearly memory view (spec §25) possible without guessing
 *     from timestamps, and
 *   * a scheduled wish is invisible until `deliverAt` passes — including to the
 *     recipient's own list queries, so an early-sent message cannot spoil the
 *     morning it was written for.
 */

const SENDER_SELECT = {
  id: true,
  username: true,
  profile: { select: { displayName: true, avatarUrl: true } },
} as const;

type MessageRow = BirthdayMessage & {
  sender: { id: string; username: string; profile: { displayName: string; avatarUrl: string | null } | null } | null;
  card: BirthdayCard | null;
  reactions: Array<{ emoji: string; userId: string }>;
};

export function toCardDto(card: BirthdayCard | null): BirthdayCardDto | null {
  if (!card) return null;
  return {
    id: card.id,
    templateId: card.templateId,
    style: card.style,
    backgroundUrl: card.backgroundUrl,
    backgroundColor: card.backgroundColor,
    headline: card.headline,
    body: card.body,
    fontFamily: card.fontFamily,
    stickers: (card.stickers as BirthdayCardDto['stickers']) ?? [],
    photos: (card.photos as BirthdayCardDto['photos']) ?? [],
    musicUrl: card.musicUrl,
    animation: card.animation,
  };
}

function toMessageDto(row: MessageRow, viewerId: string): BirthdayMessageDto {
  const counts = new Map<string, { count: number; mine: boolean }>();
  for (const reaction of row.reactions) {
    const entry = counts.get(reaction.emoji) ?? { count: 0, mine: false };
    entry.count += 1;
    if (reaction.userId === viewerId) entry.mine = true;
    counts.set(reaction.emoji, entry);
  }

  return {
    id: row.id,
    kind: row.kind,
    body: row.body,
    mediaUrl: row.mediaUrl,
    card: toCardDto(row.card),
    sender:
      row.isAnonymous || !row.sender
        ? null
        : {
            id: row.sender.id,
            displayName: row.sender.profile?.displayName ?? row.sender.username,
            avatarUrl: row.sender.profile?.avatarUrl ?? null,
          },
    recipientId: row.recipientUserId,
    celebrationYear: row.celebrationYear,
    deliverAt: row.deliverAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    readAt: row.readAt?.toISOString() ?? null,
    reactions: Array.from(counts.entries()).map(([emoji, value]) => ({
      emoji,
      count: value.count,
      mine: value.mine,
    })),
    createdAt: row.createdAt.toISOString(),
  };
}

const MESSAGE_INCLUDE = {
  sender: { select: SENDER_SELECT },
  card: true,
  reactions: { select: { emoji: true, userId: true } },
} as const;

/* -------------------------------- cards -------------------------------- */

export async function listCardTemplates(isPremium: boolean): Promise<CardTemplateDto[]> {
  const templates = await prisma.cardTemplate.findMany({
    where: { isActive: true, ...(isPremium ? {} : {}) },
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
  });

  return templates.map((template) => ({
    id: template.id,
    name: template.name,
    style: template.style,
    previewUrl: template.previewUrl,
    backgroundUrl: template.backgroundUrl,
    backgroundColor: template.backgroundColor,
    defaultHeadline: template.defaultHeadline,
    defaultBody: template.defaultBody,
    isPremium: template.isPremium,
  }));
}

export function cardStyleCatalog() {
  return Object.entries(CARD_TEMPLATE_META).map(([style, meta]) => ({ style, ...meta }));
}

/**
 * Creates a card row. Premium templates are gated here rather than in the UI,
 * so a crafted request cannot use one for free.
 */
async function createCard(
  tx: Tx,
  creatorId: string,
  input: BirthdayCardInput,
  isPremium: boolean,
): Promise<string> {
  if (input.templateId) {
    const template = await tx.cardTemplate.findUnique({
      where: { id: input.templateId },
      select: { isPremium: true, isActive: true },
    });
    if (!template?.isActive) throw new AppError('NOT_FOUND', { message: 'That card design is unavailable.' });
    if (template.isPremium && !isPremium) {
      throw new AppError('FORBIDDEN', { message: 'That card design is for premium members.' });
    }
  }

  const card = await tx.birthdayCard.create({
    data: {
      creatorId,
      templateId: input.templateId ?? null,
      style: input.style,
      backgroundUrl: input.backgroundUrl ?? null,
      backgroundColor: input.backgroundColor ?? null,
      headline: input.headline ?? null,
      body: input.body ?? null,
      fontFamily: input.fontFamily ?? null,
      stickers: input.stickers as Prisma.InputJsonValue,
      photos: input.photos as Prisma.InputJsonValue,
      musicUrl: input.musicUrl ?? null,
      animation: input.animation ?? null,
    },
    select: { id: true },
  });
  return card.id;
}

export async function createStandaloneCard(
  creatorId: string,
  input: BirthdayCardInput,
  isPremium: boolean,
): Promise<BirthdayCardDto> {
  const id = await prisma.$transaction((tx) => createCard(tx, creatorId, input, isPremium));
  const card = await prisma.birthdayCard.findUniqueOrThrow({ where: { id } });
  return toCardDto(card)!;
}

/* ------------------------------- wishes ------------------------------- */

/**
 * Which birthday a wish belongs to.
 *
 * Anchored on the recipient's own date rather than "now", so a wish sent a few
 * days early files under the birthday it is for, not the calendar year it was
 * typed in — which matters every December.
 */
async function resolveCelebrationYear(recipientUserId: string, now = new Date()): Promise<number> {
  const profile = await prisma.profile.findUnique({
    where: { userId: recipientUserId },
    select: { birthMonth: true, birthDay: true },
  });
  if (profile?.birthMonth == null || profile.birthDay == null) return now.getFullYear();

  const countdown = getBirthdayCountdown(
    { month: profile.birthMonth, day: profile.birthDay },
    now,
  );
  return Number(countdown.nextDate.slice(0, 4));
}

export async function sendBirthdayMessage(
  senderId: string,
  input: SendBirthdayMessageInput,
  isPremium: boolean,
): Promise<BirthdayMessageDto> {
  let recipientUserId = input.recipientUserId ?? null;
  let trackedBirthdayId: string | null = null;

  if (input.trackedBirthdayId) {
    const tracked = await prisma.trackedBirthday.findFirst({
      where: { id: input.trackedBirthdayId, ownerId: senderId, deletedAt: null },
      select: { id: true, linkedUserId: true },
    });
    if (!tracked) throw new AppError('NOT_FOUND', { message: 'That birthday is not on your calendar.' });
    trackedBirthdayId = tracked.id;
    recipientUserId = recipientUserId ?? tracked.linkedUserId;
    if (!recipientUserId) {
      throw new AppError('VALIDATION_ERROR', {
        message: 'They are not on the app yet — invite them first so they can receive it.',
      });
    }
  }

  if (!recipientUserId) throw new AppError('VALIDATION_ERROR', { message: 'Choose who to wish.' });
  if (recipientUserId === senderId) {
    throw new AppError('VALIDATION_ERROR', { message: 'You cannot wish yourself.' });
  }

  const recipient = await prisma.user.findFirst({
    where: { id: recipientUserId, deletedAt: null },
    select: { id: true },
  });
  if (!recipient) throw new AppError('NOT_FOUND', { message: 'That account could not be found.' });
  if (await isBlockedEitherWay(senderId, recipientUserId)) throw new AppError('BLOCKED_BY_USER');

  const celebrationYear = await resolveCelebrationYear(recipientUserId);
  const deliverAt = input.deliverAt ? new Date(input.deliverAt) : null;
  const deliverNow = deliverAt == null || deliverAt.getTime() <= Date.now();

  const messageId = await prisma.$transaction(async (tx) => {
    const cardId = input.card ? await createCard(tx, senderId, input.card, isPremium) : null;

    const message = await tx.birthdayMessage.create({
      data: {
        senderId,
        recipientUserId: recipientUserId!,
        trackedBirthdayId,
        kind: input.kind,
        body: input.body ?? null,
        mediaUrl: input.mediaUrl ?? null,
        durationSeconds: input.durationSeconds ?? null,
        cardId,
        celebrationYear,
        isAnonymous: input.isAnonymous,
        deliverAt,
        deliveredAt: deliverNow ? new Date() : null,
      },
      select: { id: true },
    });
    return message.id;
  });

  if (deliverNow) {
    await deliverWishNotification(messageId).catch(() => undefined);
  }

  const row = (await prisma.birthdayMessage.findUniqueOrThrow({
    where: { id: messageId },
    include: MESSAGE_INCLUDE,
  })) as MessageRow;
  return toMessageDto(row, senderId);
}

/** Notifies the recipient. Shared with the scheduled-delivery worker. */
export async function deliverWishNotification(messageId: string): Promise<void> {
  const message = await prisma.birthdayMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      recipientUserId: true,
      isAnonymous: true,
      body: true,
      kind: true,
      sender: { select: { username: true, profile: { select: { displayName: true, avatarUrl: true } } } },
    },
  });
  if (!message) return;

  const senderName = message.isAnonymous
    ? 'Someone'
    : message.sender?.profile?.displayName ?? message.sender?.username ?? 'Someone';

  const preview =
    message.kind === 'TEXT' && message.body
      ? message.body.slice(0, 90)
      : message.kind === 'VOICE'
        ? 'sent you a voice message'
        : message.kind === 'CARD'
          ? 'sent you a birthday card'
          : 'sent you a birthday wish';

  await notify({
    userId: message.recipientUserId,
    type: 'BIRTHDAY_WISH_RECEIVED',
    title: `🎉 ${senderName} wished you a happy birthday`,
    body: preview,
    deepLink: 'wishes',
    data: { messageId: message.id },
    imageUrl: message.isAnonymous ? null : message.sender?.profile?.avatarUrl ?? null,
  });

  emitToUser(message.recipientUserId, RealtimeEvent.NOTIFICATION_CREATED, { messageId: message.id });
}

/**
 * The recipient's wish inbox.
 *
 * Undelivered scheduled wishes are filtered out, so a wish written in advance
 * genuinely stays hidden until its moment.
 */
export async function listReceivedWishes(
  userId: string,
  options: { celebrationYear?: number; cursor?: string; limit: number },
): Promise<Paginated<BirthdayMessageDto>> {
  const cursor = decodeCursor<{ createdAt: string; id: string }>(options.cursor);
  const now = new Date();

  const rows = (await prisma.birthdayMessage.findMany({
    where: {
      recipientUserId: userId,
      ...(options.celebrationYear ? { celebrationYear: options.celebrationYear } : {}),
      OR: [{ deliverAt: null }, { deliverAt: { lte: now } }],
      ...(cursor
        ? {
            AND: [
              {
                OR: [
                  { createdAt: { lt: new Date(cursor.createdAt) } },
                  { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
                ],
              },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.limit + 1,
    include: MESSAGE_INCLUDE,
  })) as MessageRow[];

  const hasMore = rows.length > options.limit;
  const items = hasMore ? rows.slice(0, options.limit) : rows;
  const last = items[items.length - 1];

  return {
    items: items.map((row) => toMessageDto(row, userId)),
    nextCursor:
      hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
  };
}

/** Wishes the caller has sent, including ones still scheduled. */
export async function listSentWishes(userId: string, limit = 50): Promise<BirthdayMessageDto[]> {
  const rows = (await prisma.birthdayMessage.findMany({
    where: { senderId: userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: MESSAGE_INCLUDE,
  })) as MessageRow[];
  return rows.map((row) => toMessageDto(row, userId));
}

export async function markWishesRead(userId: string, ids?: string[]): Promise<number> {
  const result = await prisma.birthdayMessage.updateMany({
    where: {
      recipientUserId: userId,
      readAt: null,
      ...(ids && ids.length > 0 ? { id: { in: ids } } : {}),
    },
    data: { readAt: new Date() },
  });
  return result.count;
}

export async function reactToWish(
  userId: string,
  messageId: string,
  input: ReactToMessageInput,
): Promise<void> {
  const message = await prisma.birthdayMessage.findUnique({
    where: { id: messageId },
    select: { recipientUserId: true, senderId: true },
  });
  if (!message) throw new AppError('NOT_FOUND');
  if (message.recipientUserId !== userId && message.senderId !== userId) {
    throw new AppError('FORBIDDEN');
  }

  await prisma.birthdayMessageReaction.upsert({
    where: { messageId_userId_emoji: { messageId, userId, emoji: input.emoji } },
    create: { messageId, userId, emoji: input.emoji },
    update: {},
  });
}

export async function removeWishReaction(
  userId: string,
  messageId: string,
  emoji: string,
): Promise<void> {
  await prisma.birthdayMessageReaction.deleteMany({ where: { messageId, userId, emoji } });
}

export async function deleteWish(userId: string, messageId: string): Promise<void> {
  const message = await prisma.birthdayMessage.findUnique({
    where: { id: messageId },
    select: { senderId: true, recipientUserId: true, deliveredAt: true },
  });
  if (!message) throw new AppError('NOT_FOUND');

  // A sender may unsend only while the wish is still scheduled; the recipient
  // may always remove one from their own inbox.
  const senderCanDelete = message.senderId === userId && message.deliveredAt == null;
  const recipientCanDelete = message.recipientUserId === userId;
  if (!senderCanDelete && !recipientCanDelete) throw new AppError('FORBIDDEN');

  await prisma.birthdayMessage.delete({ where: { id: messageId } });
}

/* ------------------------------ thank-yous ------------------------------ */

/**
 * Thank-you note (spec §27).
 *
 * The gift reference is verified before anything is written: the caller must
 * actually be the recipient of the gift they are thanking someone for, or this
 * becomes a way to message strangers.
 */
export async function sendThankYou(
  senderId: string,
  input: SendThankYouInput,
): Promise<ThankYouDto> {
  let recipientUserId: string | null = null;
  const link: Prisma.ThankYouUncheckedCreateInput = {
    senderId,
    recipientUserId: '',
    kind: input.kind,
    body: input.body ?? null,
    mediaUrl: input.mediaUrl ?? null,
  };

  switch (input.giftType) {
    case 'RESERVATION': {
      const reservation = await prisma.giftReservation.findUnique({
        where: { id: input.giftId },
        select: {
          reserverId: true,
          status: true,
          isAnonymous: true,
          wishlistItem: { select: { wishlist: { select: { ownerId: true } } } },
        },
      });
      if (!reservation) throw new AppError('NOT_FOUND');
      if (reservation.wishlistItem.wishlist.ownerId !== senderId) throw new AppError('FORBIDDEN');
      if (reservation.status !== 'DELIVERED') {
        throw new AppError('CONFLICT', { message: 'You can thank them once the gift arrives.' });
      }
      recipientUserId = reservation.reserverId;
      link.reservationId = input.giftId;
      break;
    }
    case 'DIGITAL_GIFT': {
      const gift = await prisma.digitalGift.findUnique({
        where: { id: input.giftId },
        select: { senderId: true, recipientUserId: true, deliveredAt: true },
      });
      if (!gift) throw new AppError('NOT_FOUND');
      if (gift.recipientUserId !== senderId) throw new AppError('FORBIDDEN');
      if (!gift.deliveredAt) throw new AppError('CONFLICT');
      recipientUserId = gift.senderId;
      link.digitalGiftId = input.giftId;
      break;
    }
    case 'ORDER': {
      const order = await prisma.order.findUnique({
        where: { id: input.giftId },
        select: { buyerId: true, recipientUserId: true, status: true },
      });
      if (!order) throw new AppError('NOT_FOUND');
      if (order.recipientUserId !== senderId) throw new AppError('FORBIDDEN');
      recipientUserId = order.buyerId;
      link.orderId = input.giftId;
      break;
    }
    case 'GROUP_GIFT': {
      const gift = await prisma.groupGift.findUnique({
        where: { id: input.giftId },
        select: { beneficiaryUserId: true, organizerId: true, revealedAt: true },
      });
      if (!gift) throw new AppError('NOT_FOUND');
      if (gift.beneficiaryUserId !== senderId) throw new AppError('FORBIDDEN');
      if (!gift.revealedAt) throw new AppError('NOT_FOUND');
      recipientUserId = gift.organizerId;
      link.groupGiftId = input.giftId;
      break;
    }
    default:
      throw new AppError('VALIDATION_ERROR');
  }

  if (!recipientUserId) throw new AppError('NOT_FOUND');
  link.recipientUserId = recipientUserId;

  const thankYou = await prisma.thankYou.create({
    data: link,
    include: { sender: { select: SENDER_SELECT } },
  });

  // Mark the ledger row as thanked, so the history view can show it.
  await prisma.giftHistoryEntry.updateMany({
    where: { userId: senderId, source: input.giftType, sourceId: input.giftId, direction: 'RECEIVED' },
    data: { thankedAt: new Date() },
  });

  const sender = thankYou.sender;
  await notify({
    userId: recipientUserId,
    type: 'THANK_YOU_RECEIVED',
    title: `${sender.profile?.displayName ?? sender.username} said thank you ❤️`,
    body: (input.body ?? 'They sent you a thank-you message.').slice(0, 120),
    deepLink: 'gifts/thanks',
    data: { thankYouId: thankYou.id },
    imageUrl: sender.profile?.avatarUrl ?? null,
  }).catch(() => undefined);

  return {
    id: thankYou.id,
    giftReference: { type: input.giftType, id: input.giftId },
    kind: thankYou.kind,
    body: thankYou.body,
    mediaUrl: thankYou.mediaUrl,
    sender: {
      id: sender.id,
      displayName: sender.profile?.displayName ?? sender.username,
      avatarUrl: sender.profile?.avatarUrl ?? null,
    },
    recipientId: recipientUserId,
    createdAt: thankYou.createdAt.toISOString(),
  };
}

export async function listThankYous(
  userId: string,
  direction: 'RECEIVED' | 'SENT',
): Promise<ThankYouDto[]> {
  const rows = await prisma.thankYou.findMany({
    where: direction === 'RECEIVED' ? { recipientUserId: userId } : { senderId: userId },
    orderBy: { createdAt: 'desc' },
    take: 100,
    include: { sender: { select: SENDER_SELECT } },
  });

  return rows.map((row) => ({
    id: row.id,
    giftReference: {
      type: row.reservationId
        ? ('RESERVATION' as const)
        : row.digitalGiftId
          ? ('DIGITAL_GIFT' as const)
          : row.orderId
            ? ('ORDER' as const)
            : ('GROUP_GIFT' as const),
      id: row.reservationId ?? row.digitalGiftId ?? row.orderId ?? row.groupGiftId ?? '',
    },
    kind: row.kind,
    body: row.body,
    mediaUrl: row.mediaUrl,
    sender: {
      id: row.sender.id,
      displayName: row.sender.profile?.displayName ?? row.sender.username,
      avatarUrl: row.sender.profile?.avatarUrl ?? null,
    },
    recipientId: row.recipientUserId,
    createdAt: row.createdAt.toISOString(),
  }));
}
