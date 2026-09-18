import type { ValidateCouponInput } from '@bday/shared';
import type { Promotion } from '@prisma/client';
import { AppError } from '../lib/errors';
import { prisma, type Db } from '../lib/prisma';

/**
 * Coupons and promotions (spec §36).
 *
 * The discount is always computed on the server from the stored promotion, and
 * never taken from the client — a `discountMinor` in a request body would be a
 * free-money bug.
 */

export interface CouponEvaluation {
  promotionId: string;
  code: string;
  type: Promotion['type'];
  discountMinor: number;
  description: string | null;
  freeDelivery: boolean;
}

/**
 * Validates a code for a subtotal and returns the discount it would give.
 *
 * The discount is clamped to the subtotal so a large fixed-value coupon on a
 * small basket can never produce a negative total.
 */
export async function evaluateCoupon(
  userId: string,
  input: ValidateCouponInput,
  db: Db = prisma,
): Promise<CouponEvaluation> {
  const promotion = await db.promotion.findUnique({ where: { code: input.code } });
  if (!promotion || !promotion.isActive) throw new AppError('COUPON_INVALID');

  const now = new Date();
  if (promotion.startsAt && promotion.startsAt > now) throw new AppError('COUPON_INVALID');
  if (promotion.endsAt && promotion.endsAt < now) throw new AppError('COUPON_EXPIRED');

  if (promotion.usageLimit != null && promotion.usageCount >= promotion.usageLimit) {
    throw new AppError('COUPON_USAGE_EXCEEDED');
  }

  const usedByUser = await db.promotionRedemption.count({
    where: { promotionId: promotion.id, userId },
  });
  if (usedByUser >= promotion.perUserLimit) {
    throw new AppError('COUPON_USAGE_EXCEEDED', { message: 'You have already used this code.' });
  }

  if (promotion.currency && promotion.currency !== input.currency) {
    throw new AppError('CURRENCY_MISMATCH');
  }
  if (input.subtotalMinor < promotion.minSubtotalMinor) {
    throw new AppError('COUPON_INVALID', {
      message: `This code applies to orders over ${promotion.minSubtotalMinor / 100}.`,
    });
  }

  let discountMinor = 0;
  switch (promotion.type) {
    case 'PERCENTAGE_DISCOUNT':
      discountMinor = Math.round((input.subtotalMinor * (promotion.valueBps ?? 0)) / 10_000);
      break;
    case 'FIXED_DISCOUNT':
      discountMinor = promotion.valueMinor ?? 0;
      break;
    case 'FREE_DELIVERY':
    case 'BUNDLE':
      discountMinor = 0;
      break;
    default:
      discountMinor = 0;
  }

  if (promotion.maxDiscountMinor != null) {
    discountMinor = Math.min(discountMinor, promotion.maxDiscountMinor);
  }
  discountMinor = Math.max(0, Math.min(discountMinor, input.subtotalMinor));

  return {
    promotionId: promotion.id,
    code: promotion.code,
    type: promotion.type,
    discountMinor,
    description: promotion.description,
    freeDelivery: promotion.type === 'FREE_DELIVERY',
  };
}

/**
 * Records a redemption against an order.
 *
 * The unique index on (promotionId, orderId) makes this safe to call twice for
 * the same order, which matters when an order creation is retried.
 */
export async function redeemCoupon(
  db: Db,
  input: { promotionId: string; userId: string; orderId: string; discountMinor: number; currency: string },
): Promise<void> {
  await db.promotionRedemption.create({
    data: {
      promotionId: input.promotionId,
      userId: input.userId,
      orderId: input.orderId,
      discountMinor: input.discountMinor,
      currency: input.currency,
    },
  });
  await db.promotion.update({
    where: { id: input.promotionId },
    data: { usageCount: { increment: 1 } },
  });
}

/** Promotions a shopper can see and use right now. */
export async function listActivePromotions(limit = 20) {
  const now = new Date();
  const promotions = await prisma.promotion.findMany({
    where: {
      isActive: true,
      OR: [{ endsAt: null }, { endsAt: { gte: now } }],
      AND: [{ OR: [{ startsAt: null }, { startsAt: { lte: now } }] }],
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      code: true,
      type: true,
      valueBps: true,
      valueMinor: true,
      currency: true,
      minSubtotalMinor: true,
      description: true,
      endsAt: true,
    },
  });
  return promotions.map((promotion) => ({
    ...promotion,
    endsAt: promotion.endsAt?.toISOString() ?? null,
  }));
}
