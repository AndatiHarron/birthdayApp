import {
  allowedDeliveryTransitions,
  DELIVERY_STATUS_LABELS,
  type CancelOrderInput,
  type CreateOrderInput,
  type DeliveryDto,
  type OrderDto,
  type OrderQueryInput,
  type Paginated,
  type UpdateDeliveryStatusInput,
} from '@bday/shared';
import type { DeliveryStatus, Prisma } from '@prisma/client';
import { orderReference } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { prisma, serializableTransaction, type Tx } from '../lib/prisma';
import { decodeCursor, encodeCursor } from '../lib/response';
import { RealtimeEvent, emitToOrder, emitToUser } from '../realtime/emitter';
import { assertNotBlocked } from './access.service';
import { assertKnownForPhysicalGift } from './global.service';
import { evaluateCoupon, redeemCoupon } from './coupon.service';
import { notify } from './notification.service';
import { createPaymentRecord, initiateWithProvider, toPaymentDto } from './payment.service';
import { refundPayment } from './refund.service';

/**
 * Physical gift orders and delivery tracking (spec §17, §18, §58 rule 6).
 *
 * Prices, delivery fees and discounts are computed here from stored rows —
 * a client never supplies an amount. An order holds items from a single shop,
 * because one shop owns one delivery; the checkout splits baskets before they
 * reach this service.
 */

const ORDER_INCLUDE = {
  items: true,
  delivery: { include: { events: { orderBy: { occurredAt: 'asc' } } } },
  payments: { orderBy: { createdAt: 'desc' }, take: 1 },
} satisfies Prisma.OrderInclude;

type OrderRow = Prisma.OrderGetPayload<{ include: typeof ORDER_INCLUDE }>;

function toDeliveryDto(delivery: OrderRow['delivery']): DeliveryDto | null {
  if (!delivery) return null;
  return {
    id: delivery.id,
    status: delivery.status,
    target: delivery.target,
    recipientName: delivery.recipientName,
    recipientPhone: delivery.recipientPhone,
    addressLine1: delivery.addressLine1,
    addressLine2: delivery.addressLine2,
    city: delivery.city,
    area: delivery.area,
    instructions: delivery.instructions,
    latitude: delivery.latitude,
    longitude: delivery.longitude,
    scheduledDate: delivery.scheduledDate?.toISOString().slice(0, 10) ?? null,
    scheduledWindow: delivery.scheduledWindow,
    trackingCode: delivery.trackingCode,
    courier: delivery.courier,
    timeline: delivery.events.map((event) => ({
      status: event.status,
      note: event.note,
      at: event.occurredAt.toISOString(),
    })),
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
  };
}

/**
 * `viewerId` decides how much the recipient sees: an anonymous order hides
 * the buyer, and the recipient never sees what was paid.
 */
export function toOrderDto(order: OrderRow, viewerId: string | null): OrderDto {
  const isBuyer = viewerId === order.buyerId;
  const payment = order.payments[0] ?? null;
  return {
    id: order.id,
    reference: order.reference,
    buyerId: order.isAnonymous && !isBuyer ? '' : order.buyerId,
    status: order.status,
    subtotalMinor: isBuyer ? order.subtotalMinor : 0,
    deliveryFeeMinor: isBuyer ? order.deliveryFeeMinor : 0,
    discountMinor: isBuyer ? order.discountMinor : 0,
    totalMinor: isBuyer ? order.totalMinor : 0,
    currency: order.currency,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      name: item.name,
      imageUrl: item.imageUrl,
      unitPriceMinor: isBuyer ? item.unitPriceMinor : 0,
      quantity: item.quantity,
      totalMinor: isBuyer ? item.totalMinor : 0,
      vendorId: item.vendorId,
      personalization: item.personalization,
      wishlistItemId: item.wishlistItemId,
    })),
    payment: isBuyer && payment ? toPaymentDto(payment) : null,
    delivery: toDeliveryDto(order.delivery),
    recipient: order.recipientName
      ? { userId: order.recipientUserId, name: order.recipientName, phone: isBuyer ? order.recipientPhone : null }
      : null,
    giftMessage: order.giftMessage,
    isAnonymous: order.isAnonymous,
    scheduledFor: order.scheduledDate?.toISOString().slice(0, 10) ?? null,
    couponCode: isBuyer ? order.couponCode : null,
    createdAt: order.createdAt.toISOString(),
  };
}

/* ------------------------------- checkout ------------------------------- */

interface ResolvedRecipient {
  recipientUserId: string | null;
  trackedBirthdayId: string | null;
  name: string;
  phone: string | null;
}

async function resolveRecipient(buyerId: string, input: CreateOrderInput): Promise<ResolvedRecipient> {
  if (input.recipientUserId) {
    await assertNotBlocked(buyerId, input.recipientUserId);
    const user = await prisma.user.findFirst({
      where: { id: input.recipientUserId, deletedAt: null },
      select: { id: true, username: true, phone: true, profile: { select: { displayName: true } } },
    });
    if (!user) throw new AppError('NOT_FOUND', { message: 'That person could not be found.' });
    await assertKnownForPhysicalGift(buyerId, user.id);
    return {
      recipientUserId: user.id,
      trackedBirthdayId: null,
      name: user.profile?.displayName ?? user.username,
      phone: null,
    };
  }
  if (input.trackedBirthdayId) {
    const tracked = await prisma.trackedBirthday.findFirst({
      where: { id: input.trackedBirthdayId, ownerId: buyerId, deletedAt: null },
      select: { id: true, name: true, phone: true, linkedUserId: true },
    });
    if (!tracked) throw new AppError('NOT_FOUND', { message: 'That birthday is not on your calendar.' });
    return {
      recipientUserId: tracked.linkedUserId,
      trackedBirthdayId: tracked.id,
      name: tracked.name,
      phone: tracked.phone,
    };
  }
  const buyer = await prisma.user.findUniqueOrThrow({
    where: { id: buyerId },
    select: { username: true, phone: true, profile: { select: { displayName: true } } },
  });
  return {
    recipientUserId: null,
    trackedBirthdayId: null,
    name: buyer.profile?.displayName ?? buyer.username,
    phone: buyer.phone,
  };
}

async function resolveAddress(buyerId: string, input: CreateOrderInput) {
  if (input.deliveryTarget === 'SENDER' && !input.deliveryAddressId && !input.deliveryAddress) {
    return null;
  }
  if (input.deliveryAddressId) {
    const saved = await prisma.deliveryAddress.findFirst({
      where: { id: input.deliveryAddressId, userId: buyerId, deletedAt: null },
    });
    if (!saved) throw new AppError('NOT_FOUND', { message: 'That delivery address could not be found.' });
    return {
      recipientName: saved.recipientName,
      phone: saved.phone,
      addressLine1: saved.addressLine1,
      addressLine2: saved.addressLine2,
      city: saved.city,
      area: saved.area,
      latitude: saved.latitude,
      longitude: saved.longitude,
      instructions: saved.instructions,
    };
  }
  const inline = input.deliveryAddress!;
  return {
    recipientName: inline.recipientName,
    phone: inline.phone ?? null,
    addressLine1: inline.addressLine1,
    addressLine2: inline.addressLine2 ?? null,
    city: inline.city,
    area: inline.area ?? null,
    latitude: inline.latitude ?? null,
    longitude: inline.longitude ?? null,
    instructions: inline.instructions ?? null,
  };
}

function parseScheduledDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  if (Number.isNaN(date.getTime()) || date < today) {
    throw new AppError('VALIDATION_ERROR', {
      fieldErrors: { 'body.scheduledDate': ['Choose a delivery date from today onwards'] },
    });
  }
  if (date.getTime() - today.getTime() > 366 * 86_400_000) {
    throw new AppError('VALIDATION_ERROR', {
      fieldErrors: { 'body.scheduledDate': ['Deliveries can be scheduled up to a year ahead'] },
    });
  }
  return date;
}

export interface CreateOrderResult {
  order: OrderDto;
  payment: ReturnType<typeof toPaymentDto>;
}

export async function createOrder(buyerId: string, input: CreateOrderInput): Promise<CreateOrderResult> {
  const idempotencyKey = `${buyerId}:${input.idempotencyKey}`;

  // A retried checkout returns the original order instead of charging twice.
  const existing = await prisma.order.findUnique({ where: { idempotencyKey }, include: ORDER_INCLUDE });
  if (existing) {
    const payment = existing.payments[0];
    if (!payment) throw new AppError('DUPLICATE_REQUEST');
    return { order: toOrderDto(existing, buyerId), payment: toPaymentDto(payment) };
  }

  const recipient = await resolveRecipient(buyerId, input);
  const address = await resolveAddress(buyerId, input);
  const scheduledDate = parseScheduledDate(input.scheduledDate);

  const productIds = Array.from(new Set(input.items.map((item) => item.productId)));
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, deletedAt: null },
    include: { vendor: { select: { id: true, status: true } } },
  });
  const productById = new Map(products.map((product) => [product.id, product]));

  const vendorIds = new Set<string>();
  const currencies = new Set<string>();
  for (const line of input.items) {
    const product = productById.get(line.productId);
    if (!product || product.status !== 'ACTIVE' || product.vendor.status !== 'APPROVED') {
      throw new AppError('PRODUCT_UNAVAILABLE', {
        message: product ? `“${product.name}” is not available right now.` : undefined,
      });
    }
    if (product.stock != null && product.stock < line.quantity) {
      throw new AppError('PRODUCT_UNAVAILABLE', {
        message: product.stock === 0 ? `“${product.name}” is out of stock.` : `Only ${product.stock} of “${product.name}” left.`,
      });
    }
    if (line.personalization && !product.isPersonalizable) {
      throw new AppError('VALIDATION_ERROR', { message: `“${product.name}” cannot be personalised.` });
    }
    vendorIds.add(product.vendorId);
    currencies.add(product.currency);
  }
  if (vendorIds.size > 1) {
    throw new AppError('VALIDATION_ERROR', {
      message: 'Items from different shops are delivered separately. Please check out one shop at a time.',
    });
  }
  if (currencies.size > 1) throw new AppError('CURRENCY_MISMATCH');
  const currency = [...currencies][0]!;

  // Wishlist links must point at wishes the buyer could actually see and gift.
  const wishlistItemIds = input.items.map((line) => line.wishlistItemId).filter((id): id is string => Boolean(id));
  if (wishlistItemIds.length > 0) {
    const wishes = await prisma.wishlistItem.findMany({
      where: { id: { in: wishlistItemIds }, deletedAt: null },
      select: { id: true, wishlist: { select: { ownerId: true } } },
    });
    if (wishes.length !== new Set(wishlistItemIds).size) throw new AppError('WISHLIST_ITEM_NOT_FOUND');
    if (wishes.some((wish) => wish.wishlist.ownerId === buyerId)) throw new AppError('CANNOT_RESERVE_OWN_ITEM');
  }

  const lines = input.items.map((line) => {
    const product = productById.get(line.productId)!;
    return {
      productId: product.id,
      vendorId: product.vendorId,
      name: product.name,
      imageUrl: product.images[0] ?? null,
      unitPriceMinor: product.priceMinor,
      quantity: line.quantity,
      totalMinor: product.priceMinor * line.quantity,
      personalization: line.personalization ?? null,
      wishlistItemId: line.wishlistItemId ?? null,
      deliveryFeeMinor: product.deliveryFeeMinor ?? 0,
    };
  });

  const subtotalMinor = lines.reduce((sum, line) => sum + line.totalMinor, 0);
  // One shop, one trip: the delivery fee is the largest fee in the basket.
  let deliveryFeeMinor = input.deliveryTarget === 'SENDER' && !address ? 0 : Math.max(0, ...lines.map((line) => line.deliveryFeeMinor));

  let discountMinor = 0;
  let coupon: Awaited<ReturnType<typeof evaluateCoupon>> | null = null;
  if (input.couponCode) {
    coupon = await evaluateCoupon(buyerId, { code: input.couponCode, subtotalMinor, currency: currency as never });
    discountMinor = coupon.discountMinor;
    if (coupon.freeDelivery) deliveryFeeMinor = 0;
  }

  const totalMinor = subtotalMinor + deliveryFeeMinor - discountMinor;
  if (totalMinor <= 0) {
    throw new AppError('VALIDATION_ERROR', { message: 'The order total must be greater than zero.' });
  }

  const orderId = await serializableTransaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        reference: orderReference(),
        buyerId,
        recipientUserId: recipient.recipientUserId,
        trackedBirthdayId: recipient.trackedBirthdayId,
        recipientName: address?.recipientName ?? recipient.name,
        recipientPhone: address?.phone ?? recipient.phone,
        subtotalMinor,
        deliveryFeeMinor,
        discountMinor,
        totalMinor,
        currency,
        deliveryTarget: input.deliveryTarget,
        giftMessage: input.giftMessage ?? null,
        isAnonymous: input.isAnonymous,
        scheduledDate,
        scheduledWindow: input.scheduledWindow ?? null,
        couponId: coupon?.promotionId ?? null,
        couponCode: coupon?.code ?? null,
        idempotencyKey,
        items: {
          create: lines.map(({ deliveryFeeMinor: _fee, ...line }) => line),
        },
        delivery: {
          create: {
            target: input.deliveryTarget,
            recipientName: address?.recipientName ?? recipient.name,
            recipientPhone: address?.phone ?? recipient.phone,
            addressLine1: address?.addressLine1 ?? null,
            addressLine2: address?.addressLine2 ?? null,
            city: address?.city ?? null,
            area: address?.area ?? null,
            latitude: address?.latitude ?? null,
            longitude: address?.longitude ?? null,
            instructions: address?.instructions ?? null,
            scheduledDate,
            scheduledWindow: input.scheduledWindow ?? null,
            status: 'PENDING',
            events: { create: { status: 'PENDING', note: 'Order placed, awaiting payment.' } },
          },
        },
      },
      select: { id: true },
    });

    if (coupon) {
      await redeemCoupon(tx, {
        promotionId: coupon.promotionId,
        userId: buyerId,
        orderId: order.id,
        discountMinor,
        currency,
      });
    }
    return order.id;
  });

  const paymentRecord = await createPaymentRecord({
    userId: buyerId,
    provider: input.provider,
    amountMinor: totalMinor,
    currency,
    purpose: 'GIFT_ORDER',
    referenceType: 'ORDER',
    referenceId: orderId,
    orderId,
    idempotencyKey: `order:${input.idempotencyKey}`,
    description: 'Gift order',
  });

  const payment = await initiateWithProvider(paymentRecord, {
    description: 'Birthday App gift order',
    payerPhone: input.payerPhone ?? null,
  });

  const order = await loadOrder(orderId);
  return { order: toOrderDto(order, buyerId), payment };
}

async function loadOrder(orderId: string): Promise<OrderRow> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE });
  if (!order) throw new AppError('NOT_FOUND', { message: 'That order could not be found.' });
  return order;
}

/**
 * Called from payment settlement, inside its transaction, once an order is
 * paid. Links the purchase back to the wishes it fulfils so nobody else buys
 * the same thing (spec §58 rule 1).
 */
export async function onOrderPaid(tx: Tx, orderId: string): Promise<void> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      buyerId: true,
      items: { select: { wishlistItemId: true, quantity: true } },
      delivery: { select: { id: true } },
    },
  });
  if (!order) return;

  if (order.delivery) {
    await tx.deliveryEvent.create({
      data: { deliveryId: order.delivery.id, status: 'PENDING', note: 'Payment confirmed.' },
    });
  }

  for (const item of order.items) {
    if (!item.wishlistItemId) continue;
    const reservation = await tx.giftReservation.findFirst({
      where: { wishlistItemId: item.wishlistItemId, reserverId: order.buyerId, status: 'RESERVED' },
      select: { id: true },
    });
    if (reservation) {
      await tx.giftReservation.update({
        where: { id: reservation.id },
        data: { status: 'PURCHASED', purchasedAt: new Date(), orderId },
      });
      await tx.wishlistItem.update({ where: { id: item.wishlistItemId }, data: { status: 'PURCHASED' } });
      continue;
    }
    // Bought without reserving first: claim it now if there is room, so the
    // item still shows as taken to other gifters.
    const wish = await tx.wishlistItem.findUnique({
      where: { id: item.wishlistItemId },
      select: { quantity: true, reservedQuantity: true },
    });
    if (wish && wish.reservedQuantity < wish.quantity) {
      const claim = Math.min(item.quantity, wish.quantity - wish.reservedQuantity);
      await tx.giftReservation.create({
        data: {
          wishlistItemId: item.wishlistItemId,
          reserverId: order.buyerId,
          quantity: claim,
          status: 'PURCHASED',
          purchasedAt: new Date(),
          orderId,
        },
      });
      const reservedQuantity = wish.reservedQuantity + claim;
      await tx.wishlistItem.update({
        where: { id: item.wishlistItemId },
        data: { reservedQuantity, status: reservedQuantity >= wish.quantity ? 'PURCHASED' : 'AVAILABLE' },
      });
    }
  }
}

/* -------------------------------- reading -------------------------------- */

export async function getOrder(viewerId: string, orderId: string, role?: string): Promise<OrderDto> {
  const order = await loadOrder(orderId);
  const isAdmin = role === 'ADMIN' || role === 'SUPER_ADMIN';
  const isBuyer = order.buyerId === viewerId;
  // The recipient only learns about a gift once it has been handed over.
  const isRecipient = order.recipientUserId === viewerId && order.delivery?.status === 'DELIVERED';
  const vendorOwns = await isVendorForOrder(viewerId, order);
  if (!isAdmin && !isBuyer && !isRecipient && !vendorOwns) throw new AppError('NOT_FOUND');
  return toOrderDto(order, isAdmin || vendorOwns ? order.buyerId : viewerId);
}

async function isVendorForOrder(userId: string, order: { items: Array<{ vendorId: string }> }): Promise<boolean> {
  const vendor = await prisma.vendor.findUnique({ where: { ownerUserId: userId }, select: { id: true } });
  return Boolean(vendor && order.items.some((item) => item.vendorId === vendor.id));
}

export async function listOrders(userId: string, input: OrderQueryInput): Promise<Paginated<OrderDto>> {
  const cursor = decodeCursor<{ createdAt: string; id: string }>(input.cursor);
  const where: Prisma.OrderWhereInput =
    input.direction === 'RECEIVED'
      ? { recipientUserId: userId, delivery: { status: 'DELIVERED' } }
      : { buyerId: userId };
  if (input.status) where.status = input.status as Prisma.OrderWhereInput['status'];
  if (cursor) {
    where.OR = [
      { createdAt: { lt: new Date(cursor.createdAt) } },
      { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
    ];
  }

  const rows = await prisma.order.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
    include: ORDER_INCLUDE,
  });
  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const last = items[items.length - 1];
  return {
    items: items.map((row) => toOrderDto(row, userId)),
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
  };
}

export async function listVendorOrders(userId: string, input: OrderQueryInput): Promise<Paginated<OrderDto>> {
  const vendor = await prisma.vendor.findUnique({ where: { ownerUserId: userId }, select: { id: true } });
  if (!vendor) throw new AppError('NOT_FOUND', { message: 'You do not have a vendor account.' });

  const cursor = decodeCursor<{ createdAt: string; id: string }>(input.cursor);
  const where: Prisma.OrderWhereInput = {
    items: { some: { vendorId: vendor.id } },
    // Unpaid baskets are none of the shop's business yet.
    status: input.status ? (input.status as Prisma.OrderWhereInput['status']) : { notIn: ['AWAITING_PAYMENT'] },
  };
  if (cursor) {
    where.OR = [
      { createdAt: { lt: new Date(cursor.createdAt) } },
      { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
    ];
  }
  const rows = await prisma.order.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
    include: ORDER_INCLUDE,
  });
  const hasMore = rows.length > input.limit;
  const items = hasMore ? rows.slice(0, input.limit) : rows;
  const last = items[items.length - 1];
  return {
    items: items.map((row) => toOrderDto(row, row.buyerId)),
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
  };
}

/* ------------------------------ cancellation ------------------------------ */

export async function cancelOrder(userId: string, orderId: string, input: CancelOrderInput): Promise<OrderDto> {
  const order = await loadOrder(orderId);
  if (order.buyerId !== userId) throw new AppError('NOT_FOUND');

  const deliveryStatus = order.delivery?.status ?? 'PENDING';
  const cancellable =
    order.status === 'AWAITING_PAYMENT' ||
    (order.status === 'PAID' && (deliveryStatus === 'PENDING' || deliveryStatus === 'PROCESSING'));
  if (!cancellable) throw new AppError('ORDER_NOT_CANCELLABLE');

  const wasPaid = order.status === 'PAID';

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: input.reason ?? null },
    });
    if (order.delivery) {
      await tx.delivery.update({ where: { id: order.delivery.id }, data: { status: 'CANCELLED' } });
      await tx.deliveryEvent.create({
        data: { deliveryId: order.delivery.id, status: 'CANCELLED', note: 'Cancelled by the buyer.', actorId: userId },
      });
    }
    await tx.payment.updateMany({ where: { orderId, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    await releaseCoupon(tx, orderId);
    if (wasPaid) await releaseOrderSideEffects(tx, orderId);
  });

  if (wasPaid) {
    const payment = order.payments.find((row) => row.status === 'SUCCESSFUL');
    if (payment) {
      await refundPayment({ paymentId: payment.id, reason: input.reason ?? 'Order cancelled', issuedById: userId, orderId }).catch(
        (error: unknown) => logger.error({ err: error, orderId }, 'refund after cancellation failed — needs manual follow-up'),
      );
    }
  }

  emitToOrder(orderId, RealtimeEvent.ORDER_UPDATED, { orderId, status: 'CANCELLED' });
  return toOrderDto(await loadOrder(orderId), userId);
}

/** Gives a coupon use back when the order it was spent on never completes. */
async function releaseCoupon(tx: Tx, orderId: string): Promise<void> {
  const redemptions = await tx.promotionRedemption.findMany({ where: { orderId }, select: { id: true, promotionId: true } });
  for (const redemption of redemptions) {
    await tx.promotionRedemption.delete({ where: { id: redemption.id } });
    await tx.promotion.updateMany({
      where: { id: redemption.promotionId, usageCount: { gt: 0 } },
      data: { usageCount: { decrement: 1 } },
    });
  }
}

/**
 * Unpaid baskets expire after a day, so abandoned checkouts do not hold coupon
 * uses or clutter the buyer's order list forever.
 */
export async function expireUnpaidOrders(olderThanHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 3_600_000);
  const stale = await prisma.order.findMany({
    where: { status: 'AWAITING_PAYMENT', createdAt: { lt: cutoff } },
    select: { id: true },
    take: 500,
  });
  let expired = 0;
  for (const order of stale) {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: order.id, status: 'AWAITING_PAYMENT' },
        data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: 'Payment not completed in time.' },
      });
      if (claimed.count === 0) return;
      expired += 1;
      await tx.payment.updateMany({ where: { orderId: order.id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
      await tx.delivery.updateMany({ where: { orderId: order.id }, data: { status: 'CANCELLED' } });
      await releaseCoupon(tx, order.id);
    });
  }
  return expired;
}

/** Puts stock back and frees any wishes the order had claimed. */
export async function releaseOrderSideEffects(tx: Tx, orderId: string): Promise<void> {
  const items = await tx.orderItem.findMany({ where: { orderId }, select: { productId: true, quantity: true } });
  for (const item of items) {
    await tx.product.updateMany({
      where: { id: item.productId, stock: { not: null } },
      data: { stock: { increment: item.quantity }, purchaseCount: { decrement: item.quantity } },
    });
  }
  const reservations = await tx.giftReservation.findMany({
    where: { orderId, status: { in: ['RESERVED', 'PURCHASED'] } },
    select: { id: true, quantity: true, wishlistItemId: true },
  });
  for (const reservation of reservations) {
    await tx.giftReservation.update({
      where: { id: reservation.id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    const wish = await tx.wishlistItem.findUnique({
      where: { id: reservation.wishlistItemId },
      select: { reservedQuantity: true },
    });
    if (wish) {
      await tx.wishlistItem.update({
        where: { id: reservation.wishlistItemId },
        data: { reservedQuantity: Math.max(0, wish.reservedQuantity - reservation.quantity), status: 'AVAILABLE' },
      });
    }
  }
}

/* -------------------------------- delivery -------------------------------- */

/**
 * Advances a delivery (vendor or admin only). Every change appends a timeline
 * event, and reaching DELIVERED completes the gift for both people.
 */
export async function updateDeliveryStatus(
  actor: { userId: string; role: string },
  orderId: string,
  input: UpdateDeliveryStatusInput,
): Promise<OrderDto> {
  const order = await loadOrder(orderId);
  const isAdmin = actor.role === 'ADMIN' || actor.role === 'SUPER_ADMIN';
  if (!isAdmin && !(await isVendorForOrder(actor.userId, order))) throw new AppError('FORBIDDEN');
  if (!order.delivery) throw new AppError('NOT_FOUND', { message: 'This order has no delivery.' });
  if (order.status === 'AWAITING_PAYMENT') {
    throw new AppError('PAYMENT_NOT_CONFIRMED', { message: 'This order has not been paid yet.' });
  }
  if (order.status === 'CANCELLED' || order.status === 'REFUNDED') throw new AppError('INVALID_DELIVERY_TRANSITION');

  const from = order.delivery.status;
  const to = input.status as DeliveryStatus;
  const allowed = allowedDeliveryTransitions(from);
  if (!allowed.includes(to)) {
    throw new AppError('INVALID_DELIVERY_TRANSITION', {
      message: allowed.length
        ? `A delivery that is ${DELIVERY_STATUS_LABELS[from].toLowerCase()} can only move to: ${allowed.map((s) => DELIVERY_STATUS_LABELS[s].toLowerCase()).join(', ')}.`
        : 'This delivery is already complete.',
    });
  }

  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();

  await prisma.$transaction(async (tx) => {
    await tx.delivery.update({
      where: { id: order.delivery!.id },
      data: {
        status: to,
        ...(input.trackingCode !== undefined ? { trackingCode: input.trackingCode ?? null } : {}),
        ...(input.courier !== undefined ? { courier: input.courier ?? null } : {}),
        ...(to === 'DELIVERED' ? { deliveredAt: occurredAt } : {}),
      },
    });
    await tx.deliveryEvent.create({
      data: { deliveryId: order.delivery!.id, status: to, note: input.note ?? null, actorId: actor.userId, occurredAt },
    });

    if (to === 'PROCESSING' && order.status === 'PAID') {
      await tx.order.update({ where: { id: orderId }, data: { status: 'PROCESSING' } });
    }
    if (to === 'DELIVERED') {
      await tx.order.update({ where: { id: orderId }, data: { status: 'FULFILLED' } });
      await completeDeliveredOrder(tx, order);
    }
    if (to === 'CANCELLED' || to === 'RETURNED') {
      await releaseOrderSideEffects(tx, orderId);
    }
  });

  const payload = { orderId, deliveryStatus: to };
  emitToOrder(orderId, RealtimeEvent.DELIVERY_UPDATED, payload);
  emitToUser(order.buyerId, RealtimeEvent.DELIVERY_UPDATED, payload);

  await notify({
    userId: order.buyerId,
    type: 'DELIVERY_UPDATE',
    title: to === 'DELIVERED' ? '🎁 Gift delivered' : 'Delivery update',
    body:
      to === 'OUT_FOR_DELIVERY'
        ? `Your gift for ${order.recipientName ?? 'them'} is out for delivery.`
        : to === 'DELIVERED'
          ? `Your gift for ${order.recipientName ?? 'them'} has been delivered.`
          : `Your order ${order.reference} is now ${DELIVERY_STATUS_LABELS[to].toLowerCase()}.`,
    deepLink: `orders/${orderId}`,
    data: { orderId, status: to },
  }).catch(() => undefined);

  if (to === 'DELIVERED' && order.recipientUserId && order.recipientUserId !== order.buyerId) {
    const buyer = order.isAnonymous
      ? null
      : await prisma.user.findUnique({
          where: { id: order.buyerId },
          select: { username: true, profile: { select: { displayName: true } } },
        });
    await notify({
      userId: order.recipientUserId,
      type: 'GIFT_RECEIVED',
      title: '🎁 You received a birthday gift!',
      body: `${buyer?.profile?.displayName ?? buyer?.username ?? 'Someone special'} sent you a gift.`,
      deepLink: `orders/${orderId}`,
      data: { orderId },
    }).catch(() => undefined);
  }

  return toOrderDto(await loadOrder(orderId), isAdmin ? order.buyerId : order.buyerId);
}

/** Gift history for both people and delivered status on any linked wishes. */
async function completeDeliveredOrder(tx: Tx, order: OrderRow): Promise<void> {
  await tx.giftReservation.updateMany({
    where: { orderId: order.id, status: { in: ['RESERVED', 'PURCHASED'] } },
    data: { status: 'DELIVERED', deliveredAt: new Date() },
  });
  const wishIds = order.items.map((item) => item.wishlistItemId).filter((id): id is string => Boolean(id));
  if (wishIds.length > 0) {
    await tx.wishlistItem.updateMany({ where: { id: { in: wishIds } }, data: { status: 'DELIVERED' } });
  }

  const first = order.items[0];
  if (!first) return;
  const title = order.items.length === 1 ? first.name : `${first.name} + ${order.items.length - 1} more`;
  const year = new Date().getFullYear();

  const [buyer, recipient] = await Promise.all([
    tx.user.findUnique({ where: { id: order.buyerId }, select: { username: true, profile: { select: { displayName: true } } } }),
    order.recipientUserId
      ? tx.user.findUnique({ where: { id: order.recipientUserId }, select: { username: true, profile: { select: { displayName: true } } } })
      : Promise.resolve(null),
  ]);

  const entries: Prisma.GiftHistoryEntryCreateManyInput[] = [
    {
      userId: order.buyerId,
      direction: 'SENT',
      title,
      imageUrl: first.imageUrl,
      counterpartyUserId: order.recipientUserId,
      counterpartyName: recipient?.profile?.displayName ?? order.recipientName,
      celebrationYear: year,
      priceMinor: order.totalMinor,
      currency: order.currency,
      message: order.giftMessage,
      source: 'ORDER',
      sourceId: order.id,
    },
  ];
  if (order.recipientUserId && order.recipientUserId !== order.buyerId) {
    entries.push({
      userId: order.recipientUserId,
      direction: 'RECEIVED',
      title,
      imageUrl: first.imageUrl,
      counterpartyUserId: order.isAnonymous ? null : order.buyerId,
      counterpartyName: order.isAnonymous ? 'Anonymous' : buyer?.profile?.displayName ?? buyer?.username ?? null,
      celebrationYear: year,
      priceMinor: order.totalMinor,
      currency: order.currency,
      priceHidden: true,
      message: order.giftMessage,
      source: 'ORDER',
      sourceId: order.id,
    });
  }
  await tx.giftHistoryEntry.createMany({ data: entries, skipDuplicates: true });
}
