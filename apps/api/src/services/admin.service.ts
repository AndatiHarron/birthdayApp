import type {
  AdminBroadcastInput,
  AdminCategoryInput,
  AdminDashboardStats,
  AdminOrderQueryInput,
  AdminProductReviewInput,
  AdminPromotionInput,
  AdminRefundInput,
  AdminReportQueryInput,
  AdminResolveReportInput,
  AdminStatsQueryInput,
  AdminUpdateUserInput,
  AdminUserQueryInput,
  AdminUserRow,
  AdminVendorReviewInput,
  Paginated,
} from '@bday/shared';
import type { Prisma, UserRole } from '@prisma/client';
import { env } from '../config/env';
import { addCivilDays, zonedNow } from '../lib/dates';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { decodeCursor, encodeCursor } from '../lib/response';
import { writeAudit, type AuditInput } from './audit.service';
import { toProductDto } from './catalog.service';
import { notify } from './notification.service';
import { releaseOrderSideEffects, toOrderDto } from './order.service';
import { toPaymentDto } from './payment.service';
import { refundPayment } from './refund.service';
import { revokeAllSessions } from './session.service';

/**
 * Admin dashboard back end (spec §40).
 *
 * Every mutation writes an audit entry with the before/after state, and role
 * changes are guarded so an ADMIN cannot mint SUPER_ADMINs or lock themselves
 * out.
 */

type Actor = Pick<AuditInput, 'actorId' | 'actorRole' | 'ip' | 'userAgent'>;

const DAY_MS = 86_400_000;

function page<T extends { id: string; createdAt: Date }>(rows: T[], limit: number) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
  };
}

function cursorWhere(cursor: string | undefined) {
  const decoded = decodeCursor<{ createdAt: string; id: string }>(cursor);
  if (!decoded) return {};
  return {
    OR: [
      { createdAt: { lt: new Date(decoded.createdAt) } },
      { createdAt: new Date(decoded.createdAt), id: { lt: decoded.id } },
    ],
  };
}

/* ------------------------------- dashboard ------------------------------- */

export async function getDashboardStats(input: AdminStatsQueryInput): Promise<AdminDashboardStats> {
  const currency = input.currency ?? env.PAYMENTS_DEFAULT_CURRENCY;
  const now = new Date();
  const today = zonedNow('Africa/Nairobi');
  const next7 = Array.from({ length: 7 }, (_, index) => addCivilDays(today, index + 1));

  const [
    totalUsers,
    activeUsers30d,
    newUsers7d,
    birthdaysToday,
    birthdaysNext7Days,
    giftsSent,
    digitalGiftsSent,
    reservations,
    ordersTotal,
    awaitingPayment,
    processing,
    revenue,
    vendorsTotal,
    vendorsPending,
    vendorsApproved,
    failedPayments7d,
    pendingDeliveries,
    openReports,
  ] = await Promise.all([
    prisma.user.count({ where: { deletedAt: null } }),
    prisma.user.count({ where: { deletedAt: null, lastActiveAt: { gte: new Date(now.getTime() - 30 * DAY_MS) } } }),
    prisma.user.count({ where: { deletedAt: null, createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } } }),
    prisma.profile.count({ where: { birthMonth: today.month, birthDay: today.day, user: { deletedAt: null } } }),
    prisma.profile.count({
      where: { user: { deletedAt: null }, OR: next7.map((date) => ({ birthMonth: date.month, birthDay: date.day })) },
    }),
    prisma.giftHistoryEntry.count({ where: { direction: 'SENT', source: { not: 'MANUAL' } } }),
    prisma.digitalGift.count({ where: { deliveredAt: { not: null } } }),
    prisma.giftReservation.count({ where: { status: { not: 'CANCELLED' } } }),
    prisma.order.count(),
    prisma.order.count({ where: { status: 'AWAITING_PAYMENT' } }),
    prisma.order.count({ where: { status: { in: ['PAID', 'PROCESSING'] } } }),
    prisma.payment.aggregate({ where: { status: 'SUCCESSFUL', currency }, _sum: { amountMinor: true } }),
    prisma.vendor.count(),
    prisma.vendor.count({ where: { status: 'PENDING' } }),
    prisma.vendor.count({ where: { status: 'APPROVED' } }),
    prisma.payment.count({ where: { status: 'FAILED', createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } } }),
    prisma.delivery.count({ where: { status: { in: ['PENDING', 'PROCESSING', 'DISPATCHED', 'OUT_FOR_DELIVERY'] }, order: { status: { notIn: ['AWAITING_PAYMENT', 'CANCELLED'] } } } }),
    prisma.report.count({ where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } } }),
  ]);

  const series = await dailySeries(input.days, currency);

  return {
    totalUsers,
    activeUsers30d,
    newUsers7d,
    birthdaysToday,
    birthdaysNext7Days,
    giftsSent,
    digitalGiftsSent,
    reservations,
    orders: { total: ordersTotal, awaitingPayment, processing },
    revenueMinor: revenue._sum.amountMinor ?? 0,
    currency,
    vendors: { total: vendorsTotal, pending: vendorsPending, approved: vendorsApproved },
    failedPayments7d,
    pendingDeliveries,
    openReports,
    series,
  };
}

async function dailySeries(days: number, currency: string) {
  const start = new Date(Date.now() - (days - 1) * DAY_MS);
  start.setUTCHours(0, 0, 0, 0);

  const [users, orders, revenue] = await Promise.all([
    prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
        FROM users WHERE "createdAt" >= ${start} AND "deletedAt" IS NULL GROUP BY 1`,
    prisma.$queryRaw<Array<{ day: Date; count: bigint }>>`
      SELECT date_trunc('day', "createdAt") AS day, COUNT(*)::bigint AS count
        FROM gift_orders WHERE "createdAt" >= ${start} AND status <> 'AWAITING_PAYMENT' GROUP BY 1`,
    prisma.$queryRaw<Array<{ day: Date; total: bigint | null }>>`
      SELECT date_trunc('day', "settledAt") AS day, SUM("amountMinor")::bigint AS total
        FROM payments WHERE status = 'SUCCESSFUL' AND currency = ${currency} AND "settledAt" >= ${start} GROUP BY 1`,
  ]);

  const key = (date: Date) => date.toISOString().slice(0, 10);
  const userMap = new Map(users.map((row) => [key(row.day), Number(row.count)]));
  const orderMap = new Map(orders.map((row) => [key(row.day), Number(row.count)]));
  const revenueMap = new Map(revenue.map((row) => [key(row.day), Number(row.total ?? 0)]));

  return Array.from({ length: days }, (_, index) => {
    const date = key(new Date(start.getTime() + index * DAY_MS));
    return {
      date,
      users: userMap.get(date) ?? 0,
      orders: orderMap.get(date) ?? 0,
      revenueMinor: revenueMap.get(date) ?? 0,
    };
  });
}

/** Engagement and gifting metrics for the reports page (spec §40, §53). */
export async function getEngagementReport(days: number) {
  const since = new Date(Date.now() - days * DAY_MS);
  const [events, categories, orderStats, dau, mau] = await Promise.all([
    prisma.analyticsEvent.groupBy({
      by: ['name'],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { name: 'desc' } },
    }),
    prisma.$queryRaw<Array<{ label: string; count: bigint }>>`
      SELECT c.label, SUM(oi.quantity)::bigint AS count
        FROM order_items oi
        JOIN gift_orders o ON o.id = oi."orderId"
        JOIN product_categories pc ON pc."productId" = oi."productId"
        JOIN gift_categories c ON c.id = pc."categoryId"
       WHERE o.status IN ('PAID','PROCESSING','FULFILLED') AND o."createdAt" >= ${since}
       GROUP BY c.label ORDER BY 2 DESC LIMIT 12`,
    prisma.order.aggregate({
      where: { status: { in: ['PAID', 'PROCESSING', 'FULFILLED'] }, createdAt: { gte: since } },
      _avg: { totalMinor: true },
      _count: { _all: true },
    }),
    prisma.user.count({ where: { lastActiveAt: { gte: new Date(Date.now() - DAY_MS) } } }),
    prisma.user.count({ where: { lastActiveAt: { gte: new Date(Date.now() - 30 * DAY_MS) } } }),
  ]);

  const checkouts = events.find((row) => row.name === 'checkout_started')?._count._all ?? 0;
  return {
    dailyActiveUsers: dau,
    monthlyActiveUsers: mau,
    stickiness: mau > 0 ? Math.round((dau / mau) * 100) : 0,
    events: events.map((row) => ({ name: row.name, count: row._count._all })),
    topCategories: categories.map((row) => ({ label: row.label, count: Number(row.count) })),
    paidOrders: orderStats._count._all,
    averageOrderValueMinor: Math.round(orderStats._avg.totalMinor ?? 0),
    checkoutConversionPercent: checkouts > 0 ? Math.round((orderStats._count._all / checkouts) * 100) : null,
  };
}

/* --------------------------------- users --------------------------------- */

export async function listUsers(input: AdminUserQueryInput): Promise<Paginated<AdminUserRow>> {
  const and: Prisma.UserWhereInput[] = [];
  if (input.q) {
    and.push({
      OR: [
        { username: { contains: input.q.toLowerCase() } },
        { email: { contains: input.q.toLowerCase() } },
        { phone: { contains: input.q } },
        { profile: { displayName: { contains: input.q, mode: 'insensitive' } } },
      ],
    });
  }
  if (input.sort === 'NEWEST') and.push(cursorWhere(input.cursor));

  const rows = await prisma.user.findMany({
    where: {
      deletedAt: null,
      ...(input.role ? { role: input.role } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.isPremium !== undefined ? { isPremium: input.isPremium } : {}),
      ...(and.length ? { AND: and } : {}),
    },
    orderBy:
      input.sort === 'OLDEST'
        ? [{ createdAt: 'asc' }, { id: 'asc' }]
        : input.sort === 'LAST_ACTIVE'
          ? [{ lastActiveAt: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }]
          : input.sort === 'NAME'
            ? [{ username: 'asc' }]
            : [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
    include: {
      profile: { select: { displayName: true } },
      _count: { select: { sentFriendRequests: { where: { status: 'ACCEPTED' } }, receivedFriendRequests: { where: { status: 'ACCEPTED' } }, orders: true } },
    },
  });

  const { items, nextCursor } = page(rows, input.limit);
  return {
    items: items.map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.profile?.displayName ?? user.username,
      email: user.email,
      phone: user.phone,
      role: user.role,
      status: user.status,
      emailVerified: user.emailVerified,
      phoneVerified: user.phoneVerified,
      isPremium: user.isPremium,
      friendCount: user._count.sentFriendRequests + user._count.receivedFriendRequests,
      orderCount: user._count.orders,
      lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    })),
    nextCursor: input.sort === 'NEWEST' ? nextCursor : null,
  };
}

export async function getUserDetail(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: true,
      vendor: { select: { id: true, name: true, status: true } },
      identities: { select: { provider: true, createdAt: true } },
      devices: { select: { platform: true, model: true, appVersion: true, lastSeenAt: true } },
      _count: { select: { orders: true, reservations: true, contributions: true, wishesSent: true, reportsFiled: true } },
    },
  });
  if (!user) throw new AppError('NOT_FOUND');
  const [reportsAgainst, payments] = await Promise.all([
    prisma.report.count({ where: { targetType: 'USER', targetId: userId } }),
    prisma.payment.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 10 }),
  ]);
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
    isPremium: user.isPremium,
    premiumUntil: user.premiumUntil?.toISOString() ?? null,
    suspendedAt: user.suspendedAt?.toISOString() ?? null,
    suspensionReason: user.suspensionReason,
    displayName: user.profile?.displayName ?? user.username,
    avatarUrl: user.profile?.avatarUrl ?? null,
    city: user.profile?.city ?? null,
    countryCode: user.profile?.countryCode ?? null,
    vendor: user.vendor,
    identities: user.identities.map((identity) => ({ provider: identity.provider, createdAt: identity.createdAt.toISOString() })),
    devices: user.devices.map((device) => ({ ...device, lastSeenAt: device.lastSeenAt.toISOString() })),
    counts: { ...user._count, reportsAgainst },
    recentPayments: payments.map((payment) => toPaymentDto(payment)),
    lastActiveAt: user.lastActiveAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

const PRIVILEGED: UserRole[] = ['ADMIN', 'SUPER_ADMIN'];

export async function updateUser(actor: Actor, userId: string, input: AdminUpdateUserInput) {
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target || target.deletedAt) throw new AppError('NOT_FOUND');

  const actorIsSuper = actor.actorRole === 'SUPER_ADMIN';
  if (userId === actor.actorId && (input.role || input.status)) {
    throw new AppError('FORBIDDEN', { message: 'You cannot change your own role or status.' });
  }
  if (PRIVILEGED.includes(target.role) && !actorIsSuper) {
    throw new AppError('FORBIDDEN', { message: 'Only a super admin can modify another administrator.' });
  }
  if (input.role && PRIVILEGED.includes(input.role) && !actorIsSuper) {
    throw new AppError('FORBIDDEN', { message: 'Only a super admin can grant admin access.' });
  }

  const suspending = input.status === 'SUSPENDED' && target.status !== 'SUSPENDED';

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.user.update({
      where: { id: userId },
      data: {
        ...(input.status ? { status: input.status } : {}),
        ...(input.role ? { role: input.role } : {}),
        ...(input.isPremium !== undefined ? { isPremium: input.isPremium, premiumUntil: input.isPremium ? target.premiumUntil : null } : {}),
        ...(input.emailVerified !== undefined ? { emailVerified: input.emailVerified, emailVerifiedAt: input.emailVerified ? new Date() : null } : {}),
        ...(input.phoneVerified !== undefined ? { phoneVerified: input.phoneVerified, phoneVerifiedAt: input.phoneVerified ? new Date() : null } : {}),
        ...(suspending ? { suspendedAt: new Date(), suspensionReason: input.reason ?? null } : {}),
        ...(input.status && input.status !== 'SUSPENDED' ? { suspendedAt: null, suspensionReason: null } : {}),
      },
    });
    if (suspending || input.role) await revokeAllSessions(userId, tx);
    return row;
  });

  await writeAudit({
    ...actor,
    action: 'user.update',
    targetType: 'USER',
    targetId: userId,
    before: { status: target.status, role: target.role, isPremium: target.isPremium, emailVerified: target.emailVerified, phoneVerified: target.phoneVerified },
    after: { status: updated.status, role: updated.role, isPremium: updated.isPremium, emailVerified: updated.emailVerified, phoneVerified: updated.phoneVerified },
    reason: input.reason ?? null,
  });

  return getUserDetail(userId);
}

export async function deleteUser(actor: Actor, userId: string, reason: string | null) {
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, deletedAt: true, username: true } });
  if (!target || target.deletedAt) throw new AppError('NOT_FOUND');
  if (userId === actor.actorId) throw new AppError('FORBIDDEN', { message: 'You cannot delete your own account here.' });
  if (PRIVILEGED.includes(target.role) && actor.actorRole !== 'SUPER_ADMIN') throw new AppError('FORBIDDEN');

  await prisma.$transaction(async (tx) => {
    // Soft delete that frees the unique identifiers, so the person can sign
    // up again later, while orders and ledgers keep their foreign keys.
    await tx.user.update({
      where: { id: userId },
      data: {
        deletedAt: new Date(),
        status: 'DEACTIVATED',
        email: null,
        phone: null,
        username: `deleted_${userId.slice(-10)}`,
        passwordHash: null,
      },
    });
    await tx.authIdentity.deleteMany({ where: { userId } });
    await tx.device.deleteMany({ where: { userId } });
    await revokeAllSessions(userId, tx);
  });

  await writeAudit({ ...actor, action: 'user.delete', targetType: 'USER', targetId: userId, before: { username: target.username }, reason });
}

/* -------------------------------- products -------------------------------- */

export async function listProductsForReview(input: { q?: string; status?: string; limit: number; cursor?: string }) {
  const rows = await prisma.product.findMany({
    where: {
      deletedAt: null,
      ...(input.status ? { status: input.status as Prisma.ProductWhereInput['status'] } : {}),
      ...(input.q ? { name: { contains: input.q, mode: 'insensitive' } } : {}),
      ...cursorWhere(input.cursor),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
    include: {
      vendor: { select: { id: true, name: true, logoUrl: true, rating: true, status: true } },
      categories: { include: { category: { select: { id: true, slug: true, label: true } } } },
    },
  });
  const { items, nextCursor } = page(rows, input.limit);
  return {
    items: items.map((row) => ({
      ...toProductDto(row),
      vendorStatus: row.vendor.status,
      isFeatured: row.isFeatured,
      statusReason: row.statusReason,
      purchaseCount: row.purchaseCount,
    })),
    nextCursor,
  };
}

export async function reviewProduct(actor: Actor, productId: string, input: AdminProductReviewInput) {
  const product = await prisma.product.findFirst({ where: { id: productId, deletedAt: null } });
  if (!product) throw new AppError('NOT_FOUND');

  const updated = await prisma.product.update({
    where: { id: productId },
    data: {
      status: input.status,
      statusReason: input.reason ?? null,
      ...(input.isFeatured !== undefined ? { isFeatured: input.isFeatured } : {}),
      ...(input.status !== 'ACTIVE' ? { isFeatured: false } : {}),
    },
  });

  await writeAudit({
    ...actor,
    action: 'product.review',
    targetType: 'PRODUCT',
    targetId: productId,
    before: { status: product.status, isFeatured: product.isFeatured },
    after: { status: updated.status, isFeatured: updated.isFeatured },
    reason: input.reason ?? null,
  });

  const vendor = await prisma.vendor.findUnique({ where: { id: product.vendorId }, select: { ownerUserId: true } });
  if (vendor && product.status !== updated.status) {
    await notify({
      userId: vendor.ownerUserId,
      type: 'SYSTEM',
      title: updated.status === 'ACTIVE' ? 'Product approved' : 'Product update',
      body:
        updated.status === 'ACTIVE'
          ? `“${product.name}” is now live in the marketplace.`
          : `“${product.name}” was ${updated.status.toLowerCase().replace('_', ' ')}${input.reason ? `: ${input.reason}` : '.'}`,
      deepLink: `vendor/products/${productId}`,
      data: { productId },
    }).catch(() => undefined);
  }
  return { id: updated.id, status: updated.status, isFeatured: updated.isFeatured };
}

/* -------------------------------- vendors -------------------------------- */

export async function listVendorsForReview(input: { status?: string; q?: string; limit: number; cursor?: string }) {
  const rows = await prisma.vendor.findMany({
    where: {
      ...(input.status ? { status: input.status as Prisma.VendorWhereInput['status'] } : {}),
      ...(input.q ? { name: { contains: input.q, mode: 'insensitive' } } : {}),
      ...cursorWhere(input.cursor),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
    include: {
      owner: { select: { id: true, username: true, email: true, phone: true } },
      _count: { select: { products: { where: { deletedAt: null } }, orderItems: true } },
    },
  });
  const { items, nextCursor } = page(rows, input.limit);

  const vendorIds = items.map((row) => row.id);
  const sales = vendorIds.length
    ? await prisma.orderItem.groupBy({
        by: ['vendorId'],
        where: { vendorId: { in: vendorIds }, order: { status: { in: ['PAID', 'PROCESSING', 'FULFILLED'] } } },
        _sum: { totalMinor: true },
        _count: { _all: true },
      })
    : [];
  const salesByVendor = new Map(sales.map((row) => [row.vendorId, row]));

  return {
    items: items.map((row) => {
      const stat = salesByVendor.get(row.id);
      return {
        id: row.id,
        name: row.name,
        slug: row.slug,
        description: row.description,
        logoUrl: row.logoUrl,
        status: row.status,
        statusReason: row.statusReason,
        contactEmail: row.contactEmail,
        contactPhone: row.contactPhone,
        city: row.city,
        area: row.area,
        registrationNumber: row.registrationNumber,
        commissionBps: row.commissionBps,
        rating: row.rating,
        owner: row.owner,
        productCount: row._count.products,
        salesCount: stat?._count._all ?? 0,
        grossSalesMinor: stat?._sum.totalMinor ?? 0,
        approvedAt: row.approvedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
      };
    }),
    nextCursor,
  };
}

export async function reviewVendor(actor: Actor, vendorId: string, input: AdminVendorReviewInput) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) throw new AppError('NOT_FOUND');

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.vendor.update({
      where: { id: vendorId },
      data: {
        status: input.status,
        statusReason: input.reason ?? null,
        ...(input.commissionBps !== undefined ? { commissionBps: input.commissionBps } : {}),
        ...(input.status === 'APPROVED' && !vendor.approvedAt ? { approvedAt: new Date() } : {}),
        ...(input.status === 'SUSPENDED' ? { suspendedAt: new Date() } : {}),
      },
    });
    const owner = await tx.user.findUnique({ where: { id: vendor.ownerUserId }, select: { role: true } });
    if (input.status === 'APPROVED' && owner?.role === 'USER') {
      await tx.user.update({ where: { id: vendor.ownerUserId }, data: { role: 'VENDOR' } });
    }
    if ((input.status === 'SUSPENDED' || input.status === 'REJECTED') && owner?.role === 'VENDOR') {
      await tx.user.update({ where: { id: vendor.ownerUserId }, data: { role: 'USER' } });
    }
    return row;
  });

  await writeAudit({
    ...actor,
    action: 'vendor.review',
    targetType: 'VENDOR',
    targetId: vendorId,
    before: { status: vendor.status, commissionBps: vendor.commissionBps },
    after: { status: updated.status, commissionBps: updated.commissionBps },
    reason: input.reason ?? null,
  });

  if (vendor.status !== updated.status) {
    await notify({
      userId: vendor.ownerUserId,
      type: 'SYSTEM',
      title: updated.status === 'APPROVED' ? '🎉 Your shop is approved' : 'Vendor account update',
      body:
        updated.status === 'APPROVED'
          ? `${vendor.name} can now list gifts in the marketplace.`
          : `${vendor.name} is now ${updated.status.toLowerCase()}${input.reason ? `: ${input.reason}` : '.'}`,
      deepLink: 'vendor',
      data: { vendorId },
    }).catch(() => undefined);
  }
  return { id: updated.id, status: updated.status, commissionBps: updated.commissionBps };
}

/* --------------------------------- orders --------------------------------- */

const ADMIN_ORDER_INCLUDE = {
  items: true,
  delivery: { include: { events: { orderBy: { occurredAt: 'asc' } } } },
  payments: { orderBy: { createdAt: 'desc' }, take: 1 },
  buyer: { select: { id: true, username: true, profile: { select: { displayName: true } } } },
} satisfies Prisma.OrderInclude;

export async function listOrders(input: AdminOrderQueryInput) {
  const rows = await prisma.order.findMany({
    where: {
      ...(input.status ? { status: input.status as Prisma.OrderWhereInput['status'] } : {}),
      ...(input.vendorId ? { items: { some: { vendorId: input.vendorId } } } : {}),
      ...(input.from || input.to
        ? { createdAt: { ...(input.from ? { gte: new Date(input.from) } : {}), ...(input.to ? { lte: new Date(input.to) } : {}) } }
        : {}),
      AND: [
        input.q
          ? { OR: [{ reference: { contains: input.q.toUpperCase() } }, { recipientName: { contains: input.q, mode: 'insensitive' } }] }
          : {},
        cursorWhere(input.cursor),
      ],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
    include: ADMIN_ORDER_INCLUDE,
  });
  const { items, nextCursor } = page(rows, input.limit);
  return {
    items: items.map((row) => ({
      ...toOrderDto(row, row.buyerId),
      buyer: { id: row.buyer.id, displayName: row.buyer.profile?.displayName ?? row.buyer.username },
    })),
    nextCursor,
  };
}

export async function refundOrder(actor: Actor, orderId: string, input: AdminRefundInput) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: ADMIN_ORDER_INCLUDE });
  if (!order) throw new AppError('NOT_FOUND');
  const payment = await prisma.payment.findFirst({ where: { orderId, status: 'SUCCESSFUL' }, orderBy: { createdAt: 'desc' } });
  if (!payment) throw new AppError('CONFLICT', { message: 'This order has no successful payment to refund.' });

  const refund = await refundPayment({
    paymentId: payment.id,
    amountMinor: input.amountMinor,
    reason: input.reason,
    issuedById: actor.actorId,
    orderId,
  });

  const fullRefund = (input.amountMinor ?? payment.amountMinor) >= payment.amountMinor;
  if (fullRefund) {
    await prisma.$transaction(async (tx) => {
      await tx.order.update({ where: { id: orderId }, data: { status: 'REFUNDED', cancelReason: input.reason } });
      if (order.delivery && !['DELIVERED', 'CANCELLED', 'RETURNED'].includes(order.delivery.status)) {
        await tx.delivery.update({ where: { id: order.delivery.id }, data: { status: 'CANCELLED' } });
        await tx.deliveryEvent.create({
          data: { deliveryId: order.delivery.id, status: 'CANCELLED', note: 'Refunded by support.', actorId: actor.actorId },
        });
        await releaseOrderSideEffects(tx, orderId);
      }
    });
  }

  await writeAudit({
    ...actor,
    action: 'order.refund',
    targetType: 'ORDER',
    targetId: orderId,
    before: { status: order.status },
    after: { refundId: refund.id, refundStatus: refund.status, amountMinor: refund.amountMinor },
    reason: input.reason,
  });

  return {
    refund: { id: refund.id, status: refund.status, amountMinor: refund.amountMinor, currency: refund.currency, providerRef: refund.providerRef },
    manualActionRequired: refund.status === 'PENDING',
  };
}

export async function updateOrderStatus(actor: Actor, orderId: string, status: 'PROCESSING' | 'CANCELLED', reason: string | null) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { status: true } });
  if (!order) throw new AppError('NOT_FOUND');
  if (status === 'PROCESSING' && order.status !== 'PAID') {
    throw new AppError('CONFLICT', { message: 'Only paid orders can be moved to processing.' });
  }
  if (status === 'CANCELLED' && order.status !== 'AWAITING_PAYMENT') {
    throw new AppError('CONFLICT', { message: 'Paid orders are cancelled by issuing a refund.' });
  }
  await prisma.order.update({
    where: { id: orderId },
    data: { status, ...(status === 'CANCELLED' ? { cancelledAt: new Date(), cancelReason: reason } : {}) },
  });
  await writeAudit({ ...actor, action: 'order.status', targetType: 'ORDER', targetId: orderId, before: { status: order.status }, after: { status }, reason });
  return { id: orderId, status };
}

/* -------------------------------- payments -------------------------------- */

export async function listPayments(input: { status?: string; provider?: string; q?: string; limit: number; cursor?: string }) {
  const rows = await prisma.payment.findMany({
    where: {
      ...(input.status ? { status: input.status as Prisma.PaymentWhereInput['status'] } : {}),
      ...(input.provider ? { provider: input.provider as Prisma.PaymentWhereInput['provider'] } : {}),
      AND: [
        input.q ? { OR: [{ reference: { contains: input.q.toUpperCase() } }, { providerRef: { contains: input.q } }] } : {},
        cursorWhere(input.cursor),
      ],
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
    include: {
      user: { select: { id: true, username: true } },
      refunds: { select: { id: true, amountMinor: true, status: true, createdAt: true } },
    },
  });
  const { items, nextCursor } = page(rows, input.limit);
  return {
    items: items.map((row) => ({
      ...toPaymentDto(row),
      providerRef: row.providerRef,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      user: row.user,
      refunds: row.refunds.map((refund) => ({ ...refund, createdAt: refund.createdAt.toISOString() })),
    })),
    nextCursor,
  };
}

/** Reconciliation overview: stuck payments, unprocessed webhooks, pending refunds. */
export async function paymentReconciliation() {
  const stuckCutoff = new Date(Date.now() - 30 * 60_000);
  const [byStatus, stuck, failedWebhooks, pendingRefunds] = await Promise.all([
    prisma.payment.groupBy({ by: ['status', 'currency'], _count: { _all: true }, _sum: { amountMinor: true } }),
    prisma.payment.findMany({ where: { status: 'PENDING', createdAt: { lt: stuckCutoff } }, orderBy: { createdAt: 'asc' }, take: 50 }),
    prisma.paymentWebhookEvent.findMany({ where: { error: { not: null } }, orderBy: { receivedAt: 'desc' }, take: 50, select: { id: true, provider: true, externalId: true, error: true, receivedAt: true, processedAt: true } }),
    prisma.refund.findMany({ where: { status: 'PENDING' }, orderBy: { createdAt: 'asc' }, take: 50 }),
  ]);
  return {
    totals: byStatus.map((row) => ({ status: row.status, currency: row.currency, count: row._count._all, amountMinor: row._sum.amountMinor ?? 0 })),
    stuckPayments: stuck.map((payment) => toPaymentDto(payment)),
    failedWebhooks: failedWebhooks.map((row) => ({ ...row, receivedAt: row.receivedAt.toISOString(), processedAt: row.processedAt?.toISOString() ?? null })),
    pendingRefunds: pendingRefunds.map((refund) => ({ ...refund, createdAt: refund.createdAt.toISOString(), completedAt: refund.completedAt?.toISOString() ?? null })),
  };
}

/** Marks a manual refund (e.g. an M-Pesa reversal done in the portal) complete. */
export async function completeManualRefund(actor: Actor, refundId: string, providerRef: string | null) {
  const refund = await prisma.refund.findUnique({ where: { id: refundId }, include: { payment: true } });
  if (!refund) throw new AppError('NOT_FOUND');
  if (refund.status !== 'PENDING') throw new AppError('CONFLICT', { message: 'This refund is not pending.' });
  await prisma.$transaction(async (tx) => {
    await tx.refund.update({ where: { id: refundId }, data: { status: 'REFUNDED', completedAt: new Date(), providerRef } });
    const refunded = await tx.refund.aggregate({ where: { paymentId: refund.paymentId, status: 'REFUNDED' }, _sum: { amountMinor: true } });
    if ((refunded._sum.amountMinor ?? 0) >= refund.payment.amountMinor) {
      await tx.payment.update({ where: { id: refund.paymentId }, data: { status: 'REFUNDED' } });
    }
  });
  await writeAudit({ ...actor, action: 'refund.complete_manual', targetType: 'REFUND', targetId: refundId, after: { providerRef } });
  return { id: refundId, status: 'REFUNDED' as const };
}

/* ------------------------------- categories ------------------------------- */

export async function listCategoriesAdmin() {
  const rows = await prisma.giftCategory.findMany({
    orderBy: [{ position: 'asc' }, { label: 'asc' }],
    include: { _count: { select: { products: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    label: row.label,
    emoji: row.emoji,
    parentId: row.parentId,
    position: row.position,
    isActive: row.isActive,
    productCount: row._count.products,
  }));
}

export async function upsertCategory(actor: Actor, categoryId: string | null, input: AdminCategoryInput) {
  if (input.parentId && input.parentId === categoryId) {
    throw new AppError('VALIDATION_ERROR', { message: 'A category cannot be its own parent.' });
  }
  const data = {
    slug: input.slug,
    label: input.label,
    emoji: input.emoji ?? null,
    parentId: input.parentId ?? null,
    position: input.position,
    isActive: input.isActive,
  };
  const row = categoryId
    ? await prisma.giftCategory.update({ where: { id: categoryId }, data })
    : await prisma.giftCategory.create({ data });
  await writeAudit({ ...actor, action: categoryId ? 'category.update' : 'category.create', targetType: 'CATEGORY', targetId: row.id, after: data });
  return row;
}

export async function deleteCategory(actor: Actor, categoryId: string) {
  const inUse = await prisma.productCategoryLink.count({ where: { categoryId } });
  if (inUse > 0) {
    throw new AppError('CONFLICT', { message: `${inUse} products use this category. Deactivate it instead.` });
  }
  await prisma.giftCategory.delete({ where: { id: categoryId } });
  await writeAudit({ ...actor, action: 'category.delete', targetType: 'CATEGORY', targetId: categoryId });
}

/* ------------------------------- promotions ------------------------------- */

export async function listPromotions() {
  const rows = await prisma.promotion.findMany({
    orderBy: { createdAt: 'desc' },
    include: { vendor: { select: { id: true, name: true } } },
  });
  return rows.map((row) => ({
    ...row,
    startsAt: row.startsAt?.toISOString() ?? null,
    endsAt: row.endsAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }));
}

export async function upsertPromotion(actor: Actor, promotionId: string | null, input: AdminPromotionInput) {
  if (input.startsAt && input.endsAt && new Date(input.endsAt) <= new Date(input.startsAt)) {
    throw new AppError('VALIDATION_ERROR', { fieldErrors: { 'body.endsAt': ['The end must be after the start'] } });
  }
  const data = {
    code: input.code,
    type: input.type,
    valueBps: input.valueBps ?? null,
    valueMinor: input.valueMinor ?? null,
    currency: input.currency ?? null,
    minSubtotalMinor: input.minSubtotalMinor,
    maxDiscountMinor: input.maxDiscountMinor ?? null,
    startsAt: input.startsAt ? new Date(input.startsAt) : null,
    endsAt: input.endsAt ? new Date(input.endsAt) : null,
    usageLimit: input.usageLimit ?? null,
    perUserLimit: input.perUserLimit,
    vendorId: input.vendorId ?? null,
    description: input.description ?? null,
    isActive: input.isActive,
  };
  const row = promotionId
    ? await prisma.promotion.update({ where: { id: promotionId }, data })
    : await prisma.promotion.create({ data });
  await writeAudit({ ...actor, action: promotionId ? 'promotion.update' : 'promotion.create', targetType: 'PROMOTION', targetId: row.id, after: { ...data, startsAt: input.startsAt ?? null, endsAt: input.endsAt ?? null } });
  return row;
}

export async function deactivatePromotion(actor: Actor, promotionId: string) {
  await prisma.promotion.update({ where: { id: promotionId }, data: { isActive: false } });
  await writeAudit({ ...actor, action: 'promotion.deactivate', targetType: 'PROMOTION', targetId: promotionId });
}

/* ------------------------------- broadcasts ------------------------------- */

const BROADCAST_CAP = 50_000;

export async function broadcast(actor: Actor, input: AdminBroadcastInput) {
  if (input.scheduledFor && new Date(input.scheduledFor).getTime() > Date.now() + 60_000) {
    throw new AppError('VALIDATION_ERROR', {
      message: 'Scheduled broadcasts are not supported yet. Send it when you are ready.',
    });
  }

  const where: Prisma.UserWhereInput = {
    deletedAt: null,
    status: 'ACTIVE',
    ...(input.audience.userIds?.length ? { id: { in: input.audience.userIds } } : {}),
    ...(input.audience.role ? { role: input.audience.role } : {}),
    ...(input.audience.isPremium !== undefined ? { isPremium: input.audience.isPremium } : {}),
  };
  if (input.audience.hasBirthdayInDays !== undefined) {
    const today = zonedNow('Africa/Nairobi');
    const dates = Array.from({ length: input.audience.hasBirthdayInDays + 1 }, (_, index) => addCivilDays(today, index));
    where.profile = { OR: dates.map((date) => ({ birthMonth: date.month, birthDay: date.day })) };
  }

  const recipients = await prisma.user.findMany({ where, select: { id: true }, take: BROADCAST_CAP });

  // Sent in the background: a large audience would otherwise hold the admin's
  // request open for minutes.
  void (async () => {
    for (const recipient of recipients) {
      await notify({
        userId: recipient.id,
        type: input.type,
        title: input.title,
        body: input.body,
        deepLink: input.deepLink ?? null,
        data: { broadcast: true },
        silent: !input.sendPush,
      }).catch(() => undefined);
    }
  })();

  await writeAudit({ ...actor, action: 'notification.broadcast', targetType: 'NOTIFICATION', after: { title: input.title, audience: input.audience, recipients: recipients.length } });
  return { queued: recipients.length, capped: recipients.length === BROADCAST_CAP };
}

/* -------------------------------- reports -------------------------------- */

export async function listReports(input: AdminReportQueryInput) {
  const rows = await prisma.report.findMany({
    where: { ...(input.status ? { status: input.status } : {}), ...cursorWhere(input.cursor) },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1,
    include: {
      reporter: { select: { id: true, username: true } },
      resolvedBy: { select: { id: true, username: true } },
    },
  });
  const { items, nextCursor } = page(rows, input.limit);

  // Resolve a readable label for each target so moderators need not look it up.
  const userIds = items.filter((row) => row.targetType === 'USER').map((row) => row.targetId);
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true, status: true } })
    : [];
  const userById = new Map(users.map((user) => [user.id, user]));

  return {
    items: items.map((row) => ({
      id: row.id,
      targetType: row.targetType,
      targetId: row.targetId,
      targetLabel: row.targetType === 'USER' ? userById.get(row.targetId)?.username ?? null : null,
      targetStatus: row.targetType === 'USER' ? userById.get(row.targetId)?.status ?? null : null,
      reason: row.reason,
      details: row.details,
      status: row.status,
      resolution: row.resolution,
      reporter: row.reporter,
      resolvedBy: row.resolvedBy,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor,
  };
}

export async function resolveReport(actor: Actor, reportId: string, input: AdminResolveReportInput) {
  const report = await prisma.report.findUnique({ where: { id: reportId } });
  if (!report) throw new AppError('NOT_FOUND');

  await prisma.report.update({
    where: { id: reportId },
    data: {
      status: input.status,
      resolution: input.resolution ?? null,
      ...(input.status !== 'UNDER_REVIEW' ? { resolvedById: actor.actorId, resolvedAt: new Date() } : {}),
    },
  });

  if (input.suspendTarget) {
    if (report.targetType === 'USER') {
      await updateUser(actor, report.targetId, { status: 'SUSPENDED', reason: input.resolution ?? `Report ${reportId}` });
    } else if (report.targetType === 'VENDOR') {
      await reviewVendor(actor, report.targetId, { status: 'SUSPENDED', reason: input.resolution ?? `Report ${reportId}` });
    } else if (report.targetType === 'PRODUCT') {
      await reviewProduct(actor, report.targetId, { status: 'REJECTED', reason: input.resolution ?? `Report ${reportId}` });
    } else if (report.targetType === 'MESSAGE') {
      await prisma.message.updateMany({ where: { id: report.targetId }, data: { deletedAt: new Date(), body: null, mediaUrl: null } });
    }
  }

  await writeAudit({ ...actor, action: 'report.resolve', targetType: 'REPORT', targetId: reportId, before: { status: report.status }, after: { status: input.status, suspendTarget: input.suspendTarget }, reason: input.resolution ?? null });
  return { id: reportId, status: input.status };
}
