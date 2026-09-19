import {
  DIGITAL_GIFT_META,
  GLOBAL_BIRTHDAYS,
  type DigitalGiftCatalogItem,
  type DigitalGiftDto,
  type PaymentDto,
  type SendDigitalGiftInput,
} from '@bday/shared';
import type { BirthdayCard, DigitalGift, DigitalGiftType, Prisma } from '@prisma/client';
import { humanCode } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { prisma, type Tx } from '../lib/prisma';
import { RealtimeEvent, emitToUser } from '../realtime/emitter';
import { isBlockedEitherWay } from './access.service';
import { assertCanReach } from './global.service';
import { notify } from './notification.service';
import { createPaymentRecord, initiateWithProvider, toPaymentDto } from './payment.service';
import { toCardDto } from './wish.service';

/**
 * Digital gifts (spec §16).
 *
 * Free types (a card, animated flowers, a cake) are delivered immediately.
 * Types carrying real value — vouchers, airtime, wallet credit — require a
 * settled payment first, and the redemption code is only minted once the
 * provider confirms, so a failed payment can never produce a spendable code.
 */

const SENDER_SELECT = {
  id: true,
  username: true,
  profile: { select: { displayName: true, avatarUrl: true } },
} as const;

type DigitalGiftRow = DigitalGift & {
  sender: { id: string; username: string; profile: { displayName: string; avatarUrl: string | null } | null } | null;
  card: BirthdayCard | null;
};

/** Platform fee per value-bearing gift type, in minor units. */
const GIFT_FEES_MINOR: Partial<Record<DigitalGiftType, number>> = {
  VOUCHER: 0,
  AIRTIME: 0,
  DATA_BUNDLE: 0,
  EGIFT_CARD: 0,
  WALLET_CREDIT: 0,
};

const PREMIUM_TYPES: DigitalGiftType[] = ['ANIMATION'];

export function digitalGiftCatalog(): DigitalGiftCatalogItem[] {
  return (Object.keys(DIGITAL_GIFT_META) as DigitalGiftType[]).map((type) => {
    const meta = DIGITAL_GIFT_META[type];
    return {
      type,
      label: meta.label,
      emoji: meta.emoji,
      previewUrl: null,
      requiresValue: meta.requiresValue,
      feeMinor: GIFT_FEES_MINOR[type] ?? 0,
      suggestedValuesMinor: meta.requiresValue ? [50_000, 100_000, 250_000, 500_000] : [],
      isPremium: PREMIUM_TYPES.includes(type),
    };
  });
}

function toDigitalGiftDto(row: DigitalGiftRow, viewerId: string): DigitalGiftDto {
  const isRecipient = row.recipientUserId === viewerId;
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    animation: row.animation,
    card: toCardDto(row.card),
    valueMinor: row.valueMinor,
    currency: row.currency,
    sender:
      row.isAnonymous || !row.sender
        ? null
        : {
            id: row.sender.id,
            displayName: row.sender.profile?.displayName ?? row.sender.username,
            avatarUrl: row.sender.profile?.avatarUrl ?? null,
          },
    recipientId: row.recipientUserId ?? '',
    isAnonymous: row.isAnonymous,
    deliverAt: row.deliverAt?.toISOString() ?? null,
    deliveredAt: row.deliveredAt?.toISOString() ?? null,
    openedAt: row.openedAt?.toISOString() ?? null,
    // The code is a bearer token for real value: only the recipient ever sees
    // it, and only after they have opened the gift.
    redemptionCode: isRecipient && row.openedAt ? row.redemptionCode : null,
    paymentStatus: row.paymentStatus,
    fromStranger: row.fromStranger,
    createdAt: row.createdAt.toISOString(),
  };
}

const GIFT_INCLUDE = { sender: { select: SENDER_SELECT }, card: true } as const;

export interface SendDigitalGiftResult {
  gift: DigitalGiftDto;
  payment: PaymentDto | null;
}

export async function sendDigitalGift(
  senderId: string,
  input: SendDigitalGiftInput,
  isPremium: boolean,
): Promise<SendDigitalGiftResult> {
  const meta = DIGITAL_GIFT_META[input.type];
  if (PREMIUM_TYPES.includes(input.type) && !isPremium) {
    throw new AppError('FORBIDDEN', { message: 'That gift is for premium members.' });
  }

  if (meta.requiresValue && (input.valueMinor == null || input.currency == null)) {
    throw new AppError('VALIDATION_ERROR', {
      fieldErrors: { 'body.valueMinor': ['Choose how much to send'] },
    });
  }

  let recipientUserId = input.recipientUserId ?? null;
  let fromStranger = false;
  if (!recipientUserId && input.recipientPhone) {
    const byPhone = await prisma.user.findFirst({
      where: { phone: input.recipientPhone, deletedAt: null },
      select: { id: true },
    });
    recipientUserId = byPhone?.id ?? null;
  }

  if (recipientUserId) {
    if (recipientUserId === senderId) {
      throw new AppError('VALIDATION_ERROR', { message: 'You cannot send a gift to yourself.' });
    }
    const recipient = await prisma.user.findFirst({
      where: { id: recipientUserId, deletedAt: null },
      select: { id: true },
    });
    if (!recipient) throw new AppError('NOT_FOUND', { message: 'That account could not be found.' });
    if (await isBlockedEitherWay(senderId, recipientUserId)) throw new AppError('BLOCKED_BY_USER');
    // Someone the sender reached by typing their phone number is someone they
    // know. Picking an account directly goes through the global-birthdays rules.
    if (input.recipientUserId) {
      ({ fromStranger } = await assertCanReach(senderId, recipientUserId, 'GIFT'));
      if (fromStranger && (input.valueMinor ?? 0) > GLOBAL_BIRTHDAYS.maxStrangerGiftMinor) {
        throw new AppError('VALIDATION_ERROR', {
          fieldErrors: { 'body.valueMinor': [`Gifts to people you have not met are capped at ${GLOBAL_BIRTHDAYS.maxStrangerGiftMinor / 100}`] },
        });
      }
    }
  } else if (!input.recipientPhone) {
    throw new AppError('VALIDATION_ERROR', { message: 'Choose who to send this to.' });
  }

  if (input.cardId) {
    const card = await prisma.birthdayCard.findFirst({
      where: { id: input.cardId, creatorId: senderId },
      select: { id: true },
    });
    if (!card) throw new AppError('NOT_FOUND', { message: 'That card could not be found.' });
  }

  const deliverAt = input.deliverAt ? new Date(input.deliverAt) : null;
  const dueNow = deliverAt == null || deliverAt.getTime() <= Date.now();
  const needsPayment = meta.requiresValue;

  const giftId = await prisma.$transaction(async (tx: Tx) => {
    const existing = await tx.digitalGift.findUnique({
      where: { idempotencyKey: `${senderId}:${input.idempotencyKey}` },
      select: { id: true },
    });
    if (existing) return existing.id;

    const gift = await tx.digitalGift.create({
      data: {
        type: input.type,
        senderId,
        recipientUserId,
        recipientPhone: recipientUserId ? null : input.recipientPhone ?? null,
        title: input.title ?? meta.label,
        message: input.message ?? null,
        animation: input.animation ?? null,
        cardId: input.cardId ?? null,
        valueMinor: input.valueMinor ?? null,
        currency: input.currency ?? null,
        isAnonymous: input.isAnonymous,
        fromStranger,
        deliverAt,
        // Free gifts land straight away; paid ones wait for settlement.
        deliveredAt: !needsPayment && dueNow ? new Date() : null,
        paymentStatus: needsPayment ? 'PENDING' : null,
        idempotencyKey: `${senderId}:${input.idempotencyKey}`,
      },
      select: { id: true },
    });
    return gift.id;
  });

  let payment: PaymentDto | null = null;

  if (needsPayment) {
    const current = await prisma.digitalGift.findUniqueOrThrow({
      where: { id: giftId },
      select: { paymentId: true, valueMinor: true, currency: true },
    });

    if (!current.paymentId) {
      if (!input.provider) {
        throw new AppError('VALIDATION_ERROR', {
          fieldErrors: { 'body.provider': ['Choose how to pay'] },
        });
      }
      const record = await createPaymentRecord({
        userId: senderId,
        provider: input.provider,
        amountMinor: current.valueMinor! + (GIFT_FEES_MINOR[input.type] ?? 0),
        currency: current.currency!,
        purpose: 'DIGITAL_GIFT',
        referenceType: 'DIGITAL_GIFT',
        referenceId: giftId,
        idempotencyKey: `dg:${input.idempotencyKey}`,
        description: `${meta.label} gift`,
      });
      await prisma.digitalGift.update({
        where: { id: giftId },
        data: { paymentId: record.id },
      });
      payment = await initiateWithProvider(record, {
        description: `${meta.label} gift`,
        payerPhone: input.payerPhone ?? null,
      });
    } else {
      const record = await prisma.payment.findUniqueOrThrow({ where: { id: current.paymentId } });
      payment = toPaymentDto(record);
    }
  } else if (dueNow && recipientUserId) {
    await notifyRecipient(giftId).catch(() => undefined);
  }

  const row = (await prisma.digitalGift.findUniqueOrThrow({
    where: { id: giftId },
    include: GIFT_INCLUDE,
  })) as DigitalGiftRow;

  return { gift: toDigitalGiftDto(row, senderId), payment };
}

/** Shared with the scheduled-delivery worker. */
export async function notifyRecipient(giftId: string): Promise<void> {
  const gift = await prisma.digitalGift.findUnique({
    where: { id: giftId },
    select: {
      id: true,
      type: true,
      title: true,
      recipientUserId: true,
      isAnonymous: true,
      sender: { select: { username: true, profile: { select: { displayName: true, avatarUrl: true } } } },
    },
  });
  if (!gift?.recipientUserId) return;

  const senderName = gift.isAnonymous
    ? 'Someone'
    : gift.sender?.profile?.displayName ?? gift.sender?.username ?? 'Someone';

  await notify({
    userId: gift.recipientUserId,
    type: 'GIFT_RECEIVED',
    title: `🎉 You received a gift from ${senderName}!`,
    body: gift.title,
    deepLink: `gifts/digital/${gift.id}`,
    data: { digitalGiftId: gift.id },
    imageUrl: gift.isAnonymous ? null : gift.sender?.profile?.avatarUrl ?? null,
  });

  emitToUser(gift.recipientUserId, RealtimeEvent.NOTIFICATION_CREATED, { digitalGiftId: gift.id });
}

/**
 * Opening a gift.
 *
 * This is where a value-bearing gift becomes spendable: the redemption code is
 * minted on first open, inside a conditional update so two taps cannot produce
 * two codes. Wallet credit is applied straight to the balance instead.
 */
export async function openDigitalGift(userId: string, giftId: string): Promise<DigitalGiftDto> {
  const gift = await prisma.digitalGift.findUnique({
    where: { id: giftId },
    select: {
      id: true,
      recipientUserId: true,
      deliveredAt: true,
      openedAt: true,
      type: true,
      valueMinor: true,
      currency: true,
      paymentStatus: true,
      redemptionCode: true,
      senderId: true,
      title: true,
    },
  });
  if (!gift) throw new AppError('NOT_FOUND');
  if (gift.recipientUserId !== userId) throw new AppError('FORBIDDEN');
  if (!gift.deliveredAt) throw new AppError('NOT_FOUND', { message: 'This gift is not ready yet.' });
  if (gift.paymentStatus && gift.paymentStatus !== 'SUCCESSFUL') {
    throw new AppError('PAYMENT_NOT_CONFIRMED', { message: 'This gift is still being processed.' });
  }

  if (!gift.openedAt) {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.digitalGift.updateMany({
        where: { id: giftId, openedAt: null },
        data: { openedAt: new Date() },
      });
      // Lost the race with a concurrent open — the other one does the work.
      if (claimed.count === 0) return;

      if (gift.type === 'WALLET_CREDIT' && gift.valueMinor && gift.currency) {
        await creditWallet(tx, userId, gift.valueMinor, gift.currency, giftId);
      } else if (DIGITAL_GIFT_META[gift.type].requiresValue && !gift.redemptionCode) {
        await tx.digitalGift.update({
          where: { id: giftId },
          data: { redemptionCode: `${gift.type.slice(0, 3)}-${humanCode(10)}` },
        });
      }

      await writeDigitalGiftHistory(tx, giftId);
    });
  }

  const row = (await prisma.digitalGift.findUniqueOrThrow({
    where: { id: giftId },
    include: GIFT_INCLUDE,
  })) as DigitalGiftRow;
  return toDigitalGiftDto(row, userId);
}

async function creditWallet(
  tx: Tx,
  userId: string,
  amountMinor: number,
  currency: string,
  giftId: string,
): Promise<void> {
  const [wallet] = await tx.$queryRaw<Array<{ id: string; balanceMinor: number; currency: string }>>`
    SELECT id, "balanceMinor", currency FROM wallets WHERE "userId" = ${userId} FOR UPDATE
  `;
  const target =
    wallet ??
    (await tx.wallet.create({
      data: { userId, currency },
      select: { id: true, balanceMinor: true, currency: true },
    }));
  if (target.currency !== currency) throw new AppError('CURRENCY_MISMATCH');

  const balanceAfter = target.balanceMinor + amountMinor;
  await tx.wallet.update({ where: { id: target.id }, data: { balanceMinor: balanceAfter } });
  await tx.walletTransaction.create({
    data: {
      walletId: target.id,
      type: 'CREDIT',
      reason: 'GIFT_RECEIVED',
      amountMinor,
      balanceAfterMinor: balanceAfter,
      currency,
      description: 'Gift credit',
      referenceType: 'DIGITAL_GIFT',
      referenceId: giftId,
      idempotencyKey: `dgcredit:${giftId}`,
    },
  });
}

async function writeDigitalGiftHistory(tx: Tx, giftId: string): Promise<void> {
  const gift = await tx.digitalGift.findUnique({
    where: { id: giftId },
    select: {
      id: true,
      title: true,
      senderId: true,
      recipientUserId: true,
      isAnonymous: true,
      valueMinor: true,
      currency: true,
    },
  });
  if (!gift?.recipientUserId) return;

  const [sender, recipient] = await Promise.all([
    tx.user.findUnique({
      where: { id: gift.senderId },
      select: { username: true, profile: { select: { displayName: true } } },
    }),
    tx.user.findUnique({
      where: { id: gift.recipientUserId },
      select: { username: true, profile: { select: { displayName: true } } },
    }),
  ]);
  const year = new Date().getFullYear();

  await tx.giftHistoryEntry.createMany({
    data: [
      {
        userId: gift.recipientUserId,
        direction: 'RECEIVED',
        title: gift.title,
        counterpartyUserId: gift.isAnonymous ? null : gift.senderId,
        counterpartyName: gift.isAnonymous
          ? 'Anonymous'
          : sender?.profile?.displayName ?? sender?.username ?? null,
        celebrationYear: year,
        priceMinor: gift.valueMinor,
        currency: gift.currency,
        priceHidden: true,
        source: 'DIGITAL_GIFT',
        sourceId: gift.id,
      },
      {
        userId: gift.senderId,
        direction: 'SENT',
        title: gift.title,
        counterpartyUserId: gift.recipientUserId,
        counterpartyName: recipient?.profile?.displayName ?? recipient?.username ?? null,
        celebrationYear: year,
        priceMinor: gift.valueMinor,
        currency: gift.currency,
        priceHidden: false,
        source: 'DIGITAL_GIFT',
        sourceId: gift.id,
      },
    ],
    skipDuplicates: true,
  });
}

export async function listReceivedDigitalGifts(userId: string): Promise<DigitalGiftDto[]> {
  const rows = (await prisma.digitalGift.findMany({
    where: {
      recipientUserId: userId,
      deliveredAt: { not: null },
      OR: [{ paymentStatus: null }, { paymentStatus: 'SUCCESSFUL' }],
    },
    orderBy: { deliveredAt: 'desc' },
    include: GIFT_INCLUDE,
  })) as DigitalGiftRow[];
  return rows.map((row) => toDigitalGiftDto(row, userId));
}

export async function listSentDigitalGifts(userId: string): Promise<DigitalGiftDto[]> {
  const rows = (await prisma.digitalGift.findMany({
    where: { senderId: userId },
    orderBy: { createdAt: 'desc' },
    include: GIFT_INCLUDE,
  })) as DigitalGiftRow[];
  return rows.map((row) => toDigitalGiftDto(row, userId));
}

export async function getDigitalGift(userId: string, giftId: string): Promise<DigitalGiftDto> {
  const row = (await prisma.digitalGift.findUnique({
    where: { id: giftId },
    include: GIFT_INCLUDE,
  })) as DigitalGiftRow | null;
  if (!row) throw new AppError('NOT_FOUND');
  if (row.senderId !== userId && row.recipientUserId !== userId) throw new AppError('FORBIDDEN');
  if (row.recipientUserId === userId && !row.deliveredAt) {
    throw new AppError('NOT_FOUND', { message: 'This gift is not ready yet.' });
  }
  return toDigitalGiftDto(row, userId);
}

/**
 * Releases scheduled gifts whose moment has arrived (spec §18).
 *
 * Called by the cron worker. Paid gifts are only released once their payment
 * settled, so a scheduled voucher with a failed card never lands.
 */
export async function releaseScheduledDigitalGifts(limit = 200): Promise<number> {
  const due = await prisma.digitalGift.findMany({
    where: {
      deliveredAt: null,
      deliverAt: { lte: new Date() },
      OR: [{ paymentStatus: null }, { paymentStatus: 'SUCCESSFUL' }],
    },
    take: limit,
    select: { id: true },
  });

  let released = 0;
  for (const gift of due) {
    const claimed = await prisma.digitalGift.updateMany({
      where: { id: gift.id, deliveredAt: null },
      data: { deliveredAt: new Date() },
    });
    if (claimed.count === 0) continue;
    released += 1;
    await notifyRecipient(gift.id).catch(() => undefined);
  }
  return released;
}

/** Wallet snapshot and ledger (spec §33). */
export async function getWallet(userId: string) {
  const wallet = await prisma.wallet.findUnique({
    where: { userId },
    include: { transactions: { orderBy: { createdAt: 'desc' }, take: 50 } },
  });
  if (!wallet) {
    const created = await prisma.wallet.create({ data: { userId } });
    return { id: created.id, balanceMinor: 0, currency: created.currency, transactions: [] };
  }
  return {
    id: wallet.id,
    balanceMinor: wallet.balanceMinor,
    currency: wallet.currency,
    transactions: wallet.transactions.map((txn) => ({
      id: txn.id,
      type: txn.type,
      reason: txn.reason,
      amountMinor: txn.amountMinor,
      balanceAfterMinor: txn.balanceAfterMinor,
      currency: txn.currency,
      description: txn.description,
      createdAt: txn.createdAt.toISOString(),
    })),
  };
}

export type { Prisma };
