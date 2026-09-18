import type { InitiatePaymentInput, PaymentDto } from '@bday/shared';
import type {
  Payment,
  PaymentProvider as PaymentProviderName,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { env } from '../config/env';
import { paymentReference } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { prisma, serializableTransaction, type Tx } from '../lib/prisma';
import { adapterForWebhookSlug, availableProviders, paymentAdapter } from '../providers/payments';
import type { NormalisedWebhookEvent } from '../providers/payments/types';
import { RealtimeEvent, emitToGroupGift, emitToUser } from '../realtime/emitter';
import { notify } from './notification.service';
import { onOrderPaid } from './order.service';

/**
 * Payments (spec §32, §58 rules 4 and 5).
 *
 * The rule that shapes this whole file: **a payment only becomes SUCCESSFUL
 * because the provider said so.** Nothing a client sends can move that status.
 * There are exactly two entry points to settlement — a signature-checked
 * webhook and a server-initiated `verify` call — and both funnel through
 * `applySettlement`, which is idempotent because a settled payment cannot be
 * settled again.
 */

export function toPaymentDto(
  payment: Payment,
  action: PaymentDto['action'] = null,
): PaymentDto {
  return {
    id: payment.id,
    reference: payment.reference,
    provider: payment.provider,
    status: payment.status,
    amountMinor: payment.amountMinor,
    currency: payment.currency,
    purpose: payment.purpose,
    action,
    failureReason: payment.failureReason,
    createdAt: payment.createdAt.toISOString(),
    settledAt: payment.settledAt?.toISOString() ?? null,
  };
}

export interface CreatePaymentInput {
  userId: string;
  provider: PaymentProviderName;
  amountMinor: number;
  currency: string;
  purpose: PaymentPurpose;
  referenceType: 'ORDER' | 'GROUP_GIFT' | 'DIGITAL_GIFT' | 'WALLET' | 'SUBSCRIPTION';
  referenceId?: string | null;
  idempotencyKey: string;
  description: string;
  payerPhone?: string | null;
  returnUrl?: string | null;
  orderId?: string | null;
  db?: Tx;
}

/**
 * Creates the Payment row.
 *
 * The idempotency key is namespaced per user so one client's key cannot
 * collide with — or be used to read — another's payment.
 */
export async function createPaymentRecord(input: CreatePaymentInput): Promise<Payment> {
  const db = input.db ?? prisma;
  const key = `${input.userId}:${input.idempotencyKey}`;

  const existing = await db.payment.findUnique({ where: { idempotencyKey: key } });
  if (existing) {
    if (existing.amountMinor !== input.amountMinor || existing.currency !== input.currency) {
      throw new AppError('DUPLICATE_REQUEST', {
        message: 'That request was already used for a different amount.',
      });
    }
    return existing;
  }

  return db.payment.create({
    data: {
      reference: paymentReference(),
      userId: input.userId,
      provider: input.provider,
      amountMinor: input.amountMinor,
      currency: input.currency,
      purpose: input.purpose,
      referenceType: input.referenceType,
      referenceId: input.referenceId ?? null,
      orderId: input.orderId ?? null,
      idempotencyKey: key,
    },
  });
}

/**
 * Hands the payment to its provider and records what the client must do next.
 *
 * A provider that settles synchronously (the wallet) comes back SUCCESSFUL, and
 * settlement is applied here rather than waiting for a callback that will never
 * arrive.
 */
export async function initiateWithProvider(
  payment: Payment,
  options: { description: string; payerPhone?: string | null; returnUrl?: string | null },
): Promise<PaymentDto> {
  if (payment.status !== 'PENDING') {
    return toPaymentDto(payment, { type: 'NONE' });
  }

  const adapter = paymentAdapter(payment.provider);
  if (!adapter.supports(payment.currency)) {
    throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', {
      message: `That payment method does not support ${payment.currency}.`,
    });
  }

  const payer = await prisma.user.findUnique({
    where: { id: payment.userId },
    select: { phone: true, email: true },
  });

  let result;
  try {
    result = await adapter.initiate({
      paymentId: payment.id,
      reference: payment.reference,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      description: options.description,
      payerPhone: options.payerPhone ?? payer?.phone ?? null,
      payerEmail: payer?.email ?? null,
      payerUserId: payment.userId,
      returnUrl: options.returnUrl ?? null,
      metadata: { purpose: payment.purpose, referenceId: payment.referenceId ?? '' },
    });
  } catch (error) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        failureReason: error instanceof AppError ? error.message : 'The payment could not be started.',
      },
    });
    throw error;
  }

  const updated = await prisma.payment.update({
    where: { id: payment.id },
    data: {
      providerRef: result.providerRef,
      providerPayload: (result.raw ?? {}) as Prisma.InputJsonValue,
    },
  });

  if (result.status === 'SUCCESSFUL' || result.status === 'FAILED') {
    const settled = await applySettlement(updated.id, {
      status: result.status,
      providerRef: result.providerRef,
      failureReason: null,
      raw: result.raw,
    });
    return toPaymentDto(settled, result.action);
  }

  return toPaymentDto(updated, result.action);
}

/** The generic `POST /payments` entry point. */
export async function initiatePayment(
  userId: string,
  input: InitiatePaymentInput,
): Promise<PaymentDto> {
  const payment = await createPaymentRecord({
    userId,
    provider: input.provider,
    amountMinor: input.amountMinor,
    currency: input.currency,
    purpose: input.purpose,
    referenceType: input.referenceType,
    referenceId: input.referenceId ?? null,
    idempotencyKey: input.idempotencyKey,
    description: describePurpose(input.purpose),
  });

  return initiateWithProvider(payment, {
    description: describePurpose(input.purpose),
    payerPhone: input.payerPhone ?? null,
    returnUrl: input.returnUrl ?? null,
  });
}

function describePurpose(purpose: PaymentPurpose | InitiatePaymentInput['purpose']): string {
  switch (purpose) {
    case 'GIFT_ORDER':
      return 'Birthday App gift order';
    case 'GROUP_CONTRIBUTION':
      return 'Group gift contribution';
    case 'DIGITAL_GIFT':
      return 'Digital gift';
    case 'WALLET_TOPUP':
      return 'Wallet top-up';
    case 'PREMIUM_SUBSCRIPTION':
      return 'Birthday App premium';
    default:
      return 'Birthday App payment';
  }
}

/* ------------------------------ settlement ------------------------------ */

interface SettlementInput {
  status: PaymentStatus;
  providerRef?: string | null;
  failureReason?: string | null;
  raw?: unknown;
}

/**
 * The one place a payment's status changes and its side effects run.
 *
 * Idempotent by construction: the status update is conditional on the payment
 * still being PENDING, so a webhook delivered three times performs the side
 * effects once. Everything runs in a serializable transaction because the side
 * effects move money-like counters (`raisedMinor`, wallet balances).
 */
export async function applySettlement(
  paymentId: string,
  input: SettlementInput,
): Promise<Payment> {
  const outcome = await serializableTransaction(async (tx) => {
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment) throw new AppError('NOT_FOUND', { message: 'That payment could not be found.' });

    if (payment.status !== 'PENDING') {
      // Already settled. Not an error — replayed callbacks are normal.
      return { payment, applied: false as const };
    }

    const updated = await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: input.status,
        providerRef: input.providerRef ?? payment.providerRef,
        failureReason: input.failureReason ?? null,
        settledAt: input.status === 'SUCCESSFUL' ? new Date() : null,
        ...(input.raw !== undefined
          ? { providerPayload: (input.raw ?? {}) as Prisma.InputJsonValue }
          : {}),
      },
    });

    const effects =
      input.status === 'SUCCESSFUL'
        ? await onPaymentSucceeded(tx, updated)
        : await onPaymentFailed(tx, updated);

    return { payment: updated, applied: true as const, effects };
  });

  if (outcome.applied) {
    emitToUser(outcome.payment.userId, RealtimeEvent.PAYMENT_UPDATED, toPaymentDto(outcome.payment));
    await runPostSettlementNotifications(outcome.payment, outcome.effects).catch((error: unknown) =>
      logger.warn({ err: error, paymentId }, 'post-settlement notifications failed'),
    );
  }

  return outcome.payment;
}

interface SettlementEffects {
  groupGiftId?: string;
  groupGiftFunded?: boolean;
  groupGiftTitle?: string;
  contributorName?: string;
  contributionAmountMinor?: number;
  currency?: string;
  orderId?: string;
  digitalGiftId?: string;
  digitalGiftRecipientId?: string | null;
  walletCredited?: number;
  organizerId?: string;
}

async function onPaymentSucceeded(tx: Tx, payment: Payment): Promise<SettlementEffects> {
  switch (payment.purpose) {
    case 'GROUP_CONTRIBUTION':
      return settleContribution(tx, payment);
    case 'GIFT_ORDER':
      return settleOrder(tx, payment);
    case 'DIGITAL_GIFT':
      return settleDigitalGift(tx, payment);
    case 'WALLET_TOPUP':
      return settleWalletTopup(tx, payment);
    case 'PREMIUM_SUBSCRIPTION':
      return settlePremium(tx, payment);
    default:
      return {};
  }
}

async function onPaymentFailed(tx: Tx, payment: Payment): Promise<SettlementEffects> {
  if (payment.purpose === 'GROUP_CONTRIBUTION') {
    await tx.giftContribution.updateMany({
      where: { paymentId: payment.id },
      data: { status: payment.status },
    });
  }
  if (payment.purpose === 'GIFT_ORDER' && payment.referenceId) {
    // The order stays AWAITING_PAYMENT so the buyer can retry with another
    // method rather than having to rebuild the basket.
    await tx.order.updateMany({
      where: { id: payment.referenceId, status: 'AWAITING_PAYMENT' },
      data: {},
    });
  }
  if (payment.purpose === 'DIGITAL_GIFT') {
    await tx.digitalGift.updateMany({
      where: { paymentId: payment.id },
      data: { paymentStatus: payment.status },
    });
  }
  return {};
}

/**
 * Group contribution (spec §58 rule 4).
 *
 * `raisedMinor` is a denormalised total, so it moves only here — inside the
 * same serializable transaction that flips the contribution to SUCCESSFUL.
 * That is what keeps the progress bar equal to the sum of settled rows.
 */
async function settleContribution(tx: Tx, payment: Payment): Promise<SettlementEffects> {
  const contribution = await tx.giftContribution.findFirst({
    where: { paymentId: payment.id },
    select: { id: true, groupGiftId: true, amountMinor: true, currency: true, status: true, contributorId: true, isAnonymous: true },
  });
  if (!contribution || contribution.status === 'SUCCESSFUL') return {};

  await tx.giftContribution.update({
    where: { id: contribution.id },
    data: { status: 'SUCCESSFUL' },
  });

  const gift = await tx.groupGift.update({
    where: { id: contribution.groupGiftId },
    data: { raisedMinor: { increment: contribution.amountMinor } },
    select: { id: true, title: true, targetMinor: true, raisedMinor: true, status: true, organizerId: true, currency: true },
  });

  let funded = false;
  if (gift.raisedMinor >= gift.targetMinor && gift.status === 'OPEN') {
    await tx.groupGift.update({ where: { id: gift.id }, data: { status: 'FUNDED' } });
    funded = true;
  }

  // A contributor becomes a member, so they can see the planning chat.
  await tx.groupGiftMember.upsert({
    where: { groupGiftId_userId: { groupGiftId: gift.id, userId: contribution.contributorId } },
    create: { groupGiftId: gift.id, userId: contribution.contributorId, joinedAt: new Date() },
    update: { joinedAt: new Date() },
  });

  const contributor = contribution.isAnonymous
    ? null
    : await tx.user.findUnique({
        where: { id: contribution.contributorId },
        select: { username: true, profile: { select: { displayName: true } } },
      });

  return {
    groupGiftId: gift.id,
    groupGiftTitle: gift.title,
    groupGiftFunded: funded,
    organizerId: gift.organizerId,
    contributorName: contributor?.profile?.displayName ?? contributor?.username ?? 'Someone',
    contributionAmountMinor: contribution.amountMinor,
    currency: contribution.currency,
  };
}

async function settleOrder(tx: Tx, payment: Payment): Promise<SettlementEffects> {
  const orderId = payment.orderId ?? payment.referenceId;
  if (!orderId) return {};

  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      buyerId: true,
      recipientUserId: true,
      recipientName: true,
      recipientPhone: true,
      deliveryTarget: true,
      scheduledDate: true,
      scheduledWindow: true,
      items: { select: { productId: true, quantity: true, wishlistItemId: true } },
    },
  });
  if (!order || order.status !== 'AWAITING_PAYMENT') return {};

  await tx.order.update({ where: { id: order.id }, data: { status: 'PAID' } });

  // Stock is decremented at payment, not at checkout: reserving it earlier
  // would let an abandoned basket hold inventory hostage.
  for (const item of order.items) {
    await tx.product.updateMany({
      where: { id: item.productId, stock: { not: null } },
      data: { stock: { decrement: item.quantity }, purchaseCount: { increment: item.quantity } },
    });
  }

  const existingDelivery = await tx.delivery.findUnique({
    where: { orderId: order.id },
    select: { id: true },
  });
  if (existingDelivery) {
    await onOrderPaid(tx, order.id);
  } else {
    await tx.delivery.create({
      data: {
        orderId: order.id,
        target: order.deliveryTarget,
        recipientName: order.recipientName ?? 'Recipient',
        recipientPhone: order.recipientPhone,
        scheduledDate: order.scheduledDate,
        scheduledWindow: order.scheduledWindow,
        status: 'PENDING',
        events: { create: { status: 'PENDING', note: 'Order paid.' } },
      },
    });
  }

  return { orderId: order.id };
}

async function settleDigitalGift(tx: Tx, payment: Payment): Promise<SettlementEffects> {
  const gift = await tx.digitalGift.findFirst({
    where: { paymentId: payment.id },
    select: { id: true, deliverAt: true, recipientUserId: true, deliveredAt: true },
  });
  if (!gift) return {};

  const dueNow = gift.deliverAt == null || gift.deliverAt.getTime() <= Date.now();

  await tx.digitalGift.update({
    where: { id: gift.id },
    data: {
      paymentStatus: 'SUCCESSFUL',
      // A scheduled gift stays undelivered until the worker releases it.
      ...(dueNow && !gift.deliveredAt ? { deliveredAt: new Date() } : {}),
    },
  });

  return {
    digitalGiftId: gift.id,
    digitalGiftRecipientId: dueNow ? gift.recipientUserId : null,
  };
}

async function settleWalletTopup(tx: Tx, payment: Payment): Promise<SettlementEffects> {
  const existing = await tx.walletTransaction.findUnique({
    where: { idempotencyKey: `topup:${payment.id}` },
    select: { id: true },
  });
  if (existing) return {};

  const [wallet] = await tx.$queryRaw<Array<{ id: string; balanceMinor: number; currency: string }>>`
    SELECT id, "balanceMinor", currency FROM wallets WHERE "userId" = ${payment.userId} FOR UPDATE
  `;
  const target =
    wallet ??
    (await tx.wallet.create({
      data: { userId: payment.userId, currency: payment.currency },
      select: { id: true, balanceMinor: true, currency: true },
    }));

  if (target.currency !== payment.currency) throw new AppError('CURRENCY_MISMATCH');

  const balanceAfter = target.balanceMinor + payment.amountMinor;
  await tx.wallet.update({ where: { id: target.id }, data: { balanceMinor: balanceAfter } });
  await tx.walletTransaction.create({
    data: {
      walletId: target.id,
      type: 'CREDIT',
      reason: 'TOPUP',
      amountMinor: payment.amountMinor,
      balanceAfterMinor: balanceAfter,
      currency: payment.currency,
      description: 'Wallet top-up',
      referenceType: 'PAYMENT',
      referenceId: payment.id,
      paymentId: payment.id,
      idempotencyKey: `topup:${payment.id}`,
    },
  });

  return { walletCredited: payment.amountMinor };
}

async function settlePremium(tx: Tx, payment: Payment): Promise<SettlementEffects> {
  const user = await tx.user.findUnique({
    where: { id: payment.userId },
    select: { premiumUntil: true },
  });
  // Renewals extend from the existing expiry, so paying early never burns time.
  const base =
    user?.premiumUntil && user.premiumUntil.getTime() > Date.now() ? user.premiumUntil : new Date();
  const until = new Date(base.getTime() + 30 * 86_400_000);

  await tx.user.update({
    where: { id: payment.userId },
    data: { isPremium: true, premiumUntil: until },
  });
  return {};
}

async function runPostSettlementNotifications(
  payment: Payment,
  effects: SettlementEffects | undefined,
): Promise<void> {
  if (!effects) return;

  if (effects.groupGiftId) {
    emitToGroupGift(effects.groupGiftId, RealtimeEvent.CONTRIBUTION_ADDED, {
      groupGiftId: effects.groupGiftId,
      amountMinor: effects.contributionAmountMinor,
      currency: effects.currency,
    });

    const members = await prisma.groupGiftMember.findMany({
      where: { groupGiftId: effects.groupGiftId },
      select: { userId: true },
    });

    for (const member of members) {
      if (member.userId === payment.userId) continue;
      await notify({
        userId: member.userId,
        type: 'GROUP_GIFT_CONTRIBUTION',
        title: 'New contribution',
        body: `${effects.contributorName} contributed to “${effects.groupGiftTitle}”.`,
        deepLink: `group-gift/${effects.groupGiftId}`,
        data: { groupGiftId: effects.groupGiftId },
        silent: true,
      }).catch(() => undefined);
    }

    if (effects.groupGiftFunded && effects.organizerId) {
      await notify({
        userId: effects.organizerId,
        type: 'GROUP_GIFT_FUNDED',
        title: '🎉 Fully funded!',
        body: `“${effects.groupGiftTitle}” has reached its goal. Time to buy it.`,
        deepLink: `group-gift/${effects.groupGiftId}`,
        data: { groupGiftId: effects.groupGiftId },
      }).catch(() => undefined);
    }
  }

  if (effects.orderId) {
    await notify({
      userId: payment.userId,
      type: 'ORDER_UPDATE',
      title: 'Payment confirmed',
      body: 'Your gift order is being prepared.',
      deepLink: `orders/${effects.orderId}`,
      data: { orderId: effects.orderId },
    }).catch(() => undefined);
  }

  if (effects.digitalGiftId && effects.digitalGiftRecipientId) {
    const sender = await prisma.user.findUnique({
      where: { id: payment.userId },
      select: { username: true, profile: { select: { displayName: true } } },
    });
    await notify({
      userId: effects.digitalGiftRecipientId,
      type: 'GIFT_RECEIVED',
      title: '🎉 You received a gift!',
      body: `${sender?.profile?.displayName ?? sender?.username ?? 'Someone'} sent you a gift.`,
      deepLink: `gifts/digital/${effects.digitalGiftId}`,
      data: { digitalGiftId: effects.digitalGiftId },
    }).catch(() => undefined);
  }

  if (effects.walletCredited) {
    await notify({
      userId: payment.userId,
      type: 'PAYMENT_UPDATE',
      title: 'Wallet topped up',
      body: 'Your wallet balance has been updated.',
      deepLink: 'wallet',
      data: {},
      silent: true,
    }).catch(() => undefined);
  }
}

/* -------------------------------- webhooks -------------------------------- */

/**
 * Inbound provider callback.
 *
 * The raw payload is stored before it is acted on, and `(provider, externalId)`
 * is unique, so a replayed webhook is recognised and skipped. A payload whose
 * signature does not verify is never written and never trusted.
 */
export async function handleWebhook(
  slug: string,
  headers: Record<string, string | string[] | undefined>,
  rawBody: Buffer,
): Promise<{ received: true; duplicate: boolean }> {
  const adapter = adapterForWebhookSlug(slug);

  let event: NormalisedWebhookEvent;
  try {
    event = await adapter.parseWebhook({ headers, rawBody });
  } catch (error) {
    logger.warn({ err: error, slug }, 'webhook signature rejected');
    throw error instanceof AppError ? error : new AppError('WEBHOOK_SIGNATURE_INVALID');
  }

  const record = await prisma.paymentWebhookEvent
    .create({
      data: {
        provider: adapter.name,
        externalId: event.externalId,
        payload: (event.raw ?? {}) as Prisma.InputJsonValue,
        signatureValid: true,
      },
      select: { id: true },
    })
    .catch((error: unknown) => {
      if ((error as { code?: string }).code === 'P2002') return null;
      throw error;
    });

  if (!record) return { received: true, duplicate: true };

  try {
    const payment = await findPaymentForEvent(event);
    if (!payment) {
      await prisma.paymentWebhookEvent.update({
        where: { id: record.id },
        data: { processedAt: new Date(), error: 'no matching payment' },
      });
      logger.warn({ event: event.externalId, provider: adapter.name }, 'webhook had no matching payment');
      return { received: true, duplicate: false };
    }

    // Amount tampering check: a callback claiming a smaller amount than the
    // one we asked for must not settle the original obligation.
    if (event.amountMinor != null && event.amountMinor < payment.amountMinor) {
      await prisma.paymentWebhookEvent.update({
        where: { id: record.id },
        data: { processedAt: new Date(), error: 'amount mismatch' },
      });
      logger.error(
        { paymentId: payment.id, expected: payment.amountMinor, received: event.amountMinor },
        'webhook amount mismatch — not settling',
      );
      return { received: true, duplicate: false };
    }

    if (event.status !== 'PENDING') {
      await applySettlement(payment.id, {
        status: event.status,
        providerRef: event.providerRef,
        failureReason: event.failureReason,
        raw: event.raw,
      });
    }

    await prisma.paymentWebhookEvent.update({
      where: { id: record.id },
      data: { processedAt: new Date() },
    });
  } catch (error) {
    await prisma.paymentWebhookEvent.update({
      where: { id: record.id },
      data: { error: String(error).slice(0, 480) },
    });
    throw error;
  }

  return { received: true, duplicate: false };
}

async function findPaymentForEvent(event: NormalisedWebhookEvent): Promise<Payment | null> {
  if (event.paymentReference) {
    const byReference = await prisma.payment.findUnique({
      where: { reference: event.paymentReference },
    });
    if (byReference) return byReference;
  }
  if (event.providerRef) {
    return prisma.payment.findFirst({ where: { providerRef: event.providerRef } });
  }
  return null;
}

/* ------------------------------ verification ------------------------------ */

/**
 * Asks the provider what happened.
 *
 * Used when the client polls after an STK push and by the reconciliation
 * worker. This — not the client's word — is the second legitimate path to
 * SUCCESSFUL.
 */
export async function verifyPayment(userId: string | null, paymentId: string): Promise<PaymentDto> {
  const payment = await prisma.payment.findUnique({ where: { id: paymentId } });
  if (!payment) throw new AppError('NOT_FOUND', { message: 'That payment could not be found.' });
  if (userId && payment.userId !== userId) throw new AppError('FORBIDDEN');

  if (payment.status !== 'PENDING') return toPaymentDto(payment);

  const adapter = paymentAdapter(payment.provider);
  const result = await adapter.verify({
    id: payment.id,
    reference: payment.reference,
    providerRef: payment.providerRef,
  });

  if (result.status === 'PENDING') return toPaymentDto(payment);

  if (result.status === 'SUCCESSFUL' && result.amountMinor != null && result.amountMinor < payment.amountMinor) {
    logger.error(
      { paymentId: payment.id, expected: payment.amountMinor, reported: result.amountMinor },
      'provider reported a smaller amount than requested — not settling',
    );
    return toPaymentDto(payment);
  }

  const settled = await applySettlement(payment.id, {
    status: result.status,
    providerRef: result.providerRef,
    failureReason: result.failureReason,
    raw: result.raw,
  });
  return toPaymentDto(settled);
}

export async function getPayment(userId: string, paymentId: string): Promise<PaymentDto> {
  const payment = await prisma.payment.findFirst({ where: { id: paymentId, userId } });
  if (!payment) throw new AppError('NOT_FOUND');
  return toPaymentDto(payment);
}

export async function listPayments(userId: string, limit = 30): Promise<PaymentDto[]> {
  const payments = await prisma.payment.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return payments.map((payment) => toPaymentDto(payment));
}

/** Which methods the client should offer for a currency (spec §32). */
export function listProviders(currency: string) {
  return availableProviders(currency).map((name) => ({
    provider: name,
    label:
      name === 'MPESA'
        ? 'M-Pesa'
        : name === 'CARD'
          ? 'Card'
          : name === 'WALLET'
            ? 'Birthday wallet'
            : name,
    requiresPhone: name === 'MPESA',
    publishableKey: name === 'CARD' ? env.STRIPE_PUBLISHABLE_KEY ?? null : null,
  }));
}

/**
 * Reconciliation sweep for the cron worker.
 *
 * Providers do miss callbacks. Without this, a contribution whose webhook was
 * lost would sit PENDING forever and the group-gift total would be wrong.
 */
export async function reconcilePendingPayments(olderThanMinutes = 3, limit = 100): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60_000);
  const pending = await prisma.payment.findMany({
    where: { status: 'PENDING', createdAt: { lt: cutoff }, provider: { not: 'MANUAL' } },
    orderBy: { createdAt: 'asc' },
    take: limit,
    select: { id: true },
  });

  let settled = 0;
  for (const payment of pending) {
    try {
      const result = await verifyPayment(null, payment.id);
      if (result.status !== 'PENDING') settled += 1;
    } catch (error) {
      logger.warn({ err: error, paymentId: payment.id }, 'payment reconciliation failed');
    }
  }
  return settled;
}
