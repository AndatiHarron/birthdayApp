import { z } from 'zod';
import {
  NotificationType,
  ProductStatus,
  PromotionType,
  ReportStatus,
  UserRole,
  UserStatus,
  VendorStatus,
} from '../enums';
import {
  amountMinorSchema,
  currencySchema,
  idSchema,
  isoDateTimeSchema,
  noteSchema,
  paginationSchema,
  positiveAmountMinorSchema,
  searchQuerySchema,
} from './common';

export const adminUserQuerySchema = paginationSchema.extend({
  q: searchQuerySchema.optional(),
  role: z.nativeEnum(UserRole).optional(),
  status: z.nativeEnum(UserStatus).optional(),
  isPremium: z.coerce.boolean().optional(),
  sort: z.enum(['NEWEST', 'OLDEST', 'LAST_ACTIVE', 'NAME']).default('NEWEST'),
});
export type AdminUserQueryInput = z.infer<typeof adminUserQuerySchema>;

export const adminUpdateUserSchema = z
  .object({
    status: z.nativeEnum(UserStatus).optional(),
    role: z.nativeEnum(UserRole).optional(),
    isPremium: z.boolean().optional(),
    emailVerified: z.boolean().optional(),
    phoneVerified: z.boolean().optional(),
    /** Recorded on the audit log entry for this change. */
    reason: noteSchema(500),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type AdminUpdateUserInput = z.infer<typeof adminUpdateUserSchema>;

export const adminProductReviewSchema = z.object({
  status: z.enum([ProductStatus.ACTIVE, ProductStatus.REJECTED, ProductStatus.ARCHIVED]),
  isFeatured: z.boolean().optional(),
  reason: noteSchema(500),
});
export type AdminProductReviewInput = z.infer<typeof adminProductReviewSchema>;

export const adminVendorReviewSchema = z.object({
  status: z.nativeEnum(VendorStatus),
  commissionBps: z.number().int().min(0).max(5000).optional(),
  reason: noteSchema(500),
});
export type AdminVendorReviewInput = z.infer<typeof adminVendorReviewSchema>;

export const adminOrderQuerySchema = paginationSchema.extend({
  q: searchQuerySchema.optional(),
  status: z.string().trim().max(40).optional(),
  vendorId: idSchema.optional(),
  from: isoDateTimeSchema.optional(),
  to: isoDateTimeSchema.optional(),
});
export type AdminOrderQueryInput = z.infer<typeof adminOrderQuerySchema>;

export const adminRefundSchema = z.object({
  amountMinor: positiveAmountMinorSchema.optional(),
  reason: z.string().trim().min(3, 'Explain the refund').max(500),
});
export type AdminRefundInput = z.infer<typeof adminRefundSchema>;

export const adminCategorySchema = z.object({
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9-]+$/, 'Use lowercase letters, numbers and hyphens'),
  label: z.string().trim().min(1).max(60),
  emoji: z.string().trim().max(8).nullish(),
  parentId: idSchema.nullish(),
  position: z.number().int().min(0).max(999).default(0),
  isActive: z.boolean().default(true),
});
export type AdminCategoryInput = z.infer<typeof adminCategorySchema>;

export const adminPromotionSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .min(3)
      .max(32)
      .regex(/^[A-Z0-9_-]+$/, 'Use letters, numbers, hyphens and underscores'),
    type: z.nativeEnum(PromotionType),
    /** Percentage in basis points for PERCENTAGE_DISCOUNT. */
    valueBps: z.number().int().min(1).max(10_000).optional(),
    /** Fixed discount amount for FIXED_DISCOUNT. */
    valueMinor: amountMinorSchema.optional(),
    currency: currencySchema.optional(),
    minSubtotalMinor: amountMinorSchema.default(0),
    maxDiscountMinor: amountMinorSchema.nullish(),
    startsAt: isoDateTimeSchema.optional(),
    endsAt: isoDateTimeSchema.optional(),
    usageLimit: z.number().int().min(1).max(1_000_000).nullish(),
    perUserLimit: z.number().int().min(1).max(100).default(1),
    vendorId: idSchema.nullish(),
    description: noteSchema(500),
    isActive: z.boolean().default(true),
  })
  .refine(
    (value) =>
      value.type !== PromotionType.PERCENTAGE_DISCOUNT || value.valueBps != null,
    { message: 'Set the discount percentage', path: ['valueBps'] },
  )
  .refine(
    (value) => value.type !== PromotionType.FIXED_DISCOUNT || value.valueMinor != null,
    { message: 'Set the discount amount', path: ['valueMinor'] },
  );
export type AdminPromotionInput = z.infer<typeof adminPromotionSchema>;

export const adminBroadcastSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(500),
  type: z.nativeEnum(NotificationType).default(NotificationType.SYSTEM),
  deepLink: z.string().trim().max(240).nullish(),
  /** Empty audience means every active user. */
  audience: z
    .object({
      userIds: z.array(idSchema).max(10_000).optional(),
      role: z.nativeEnum(UserRole).optional(),
      isPremium: z.boolean().optional(),
      hasBirthdayInDays: z.number().int().min(0).max(366).optional(),
    })
    .default({}),
  sendPush: z.boolean().default(true),
  scheduledFor: isoDateTimeSchema.nullish(),
});
export type AdminBroadcastInput = z.infer<typeof adminBroadcastSchema>;

export const adminReportQuerySchema = paginationSchema.extend({
  status: z.nativeEnum(ReportStatus).optional(),
});
export type AdminReportQueryInput = z.infer<typeof adminReportQuerySchema>;

export const adminResolveReportSchema = z.object({
  status: z.enum([ReportStatus.UNDER_REVIEW, ReportStatus.RESOLVED, ReportStatus.DISMISSED]),
  resolution: noteSchema(1000),
  /** Suspend the reported user as part of resolving. */
  suspendTarget: z.boolean().default(false),
});
export type AdminResolveReportInput = z.infer<typeof adminResolveReportSchema>;

export const adminStatsQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
  currency: currencySchema.optional(),
});
export type AdminStatsQueryInput = z.infer<typeof adminStatsQuerySchema>;
