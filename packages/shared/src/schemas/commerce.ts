import { z } from 'zod';
import { DeliveryStatus, DeliveryTarget, PaymentProvider, ProductStatus } from '../enums';
import {
  amountMinorSchema,
  civilDateSchema,
  coordinateSchema,
  currencySchema,
  displayNameSchema,
  idSchema,
  isoDateTimeSchema,
  noteSchema,
  paginationSchema,
  phoneSchema,
  positiveAmountMinorSchema,
  searchQuerySchema,
  urlSchema,
} from './common';

/* ------------------------------ catalogue ------------------------------ */

export const productQuerySchema = paginationSchema.extend({
  q: searchQuerySchema.optional(),
  categorySlug: z.string().trim().max(60).optional(),
  shelf: z.string().trim().max(40).optional(),
  vendorId: idSchema.optional(),
  minPriceMinor: amountMinorSchema.optional(),
  maxPriceMinor: amountMinorSchema.optional(),
  currency: currencySchema.optional(),
  city: z.string().trim().max(80).optional(),
  area: z.string().trim().max(80).optional(),
  /** Location-based discovery (spec §35). */
  near: coordinateSchema.partial().optional(),
  radiusKm: z.coerce.number().min(1).max(200).optional(),
  minRating: z.coerce.number().min(1).max(5).optional(),
  inStockOnly: z.coerce.boolean().default(false),
  sort: z.enum(['RELEVANCE', 'PRICE_ASC', 'PRICE_DESC', 'RATING', 'NEWEST']).default('RELEVANCE'),
});
export type ProductQueryInput = z.infer<typeof productQuerySchema>;

export const createProductSchema = z.object({
  name: z.string().trim().min(2, 'Name the product').max(140),
  description: z.string().trim().min(10, 'Describe the product').max(4000),
  images: z.array(urlSchema).min(1, 'Add at least one image').max(10),
  priceMinor: positiveAmountMinorSchema,
  compareAtPriceMinor: amountMinorSchema.nullish(),
  currency: currencySchema,
  categoryIds: z.array(idSchema).min(1, 'Choose a category').max(5),
  tags: z.array(z.string().trim().max(30)).max(20).default([]),
  stock: z.number().int().min(0).max(1_000_000).nullish(),
  deliveryEstimate: z.string().trim().max(80).nullish(),
  deliveryFeeMinor: amountMinorSchema.nullish(),
  isPersonalizable: z.boolean().default(false),
  city: z.string().trim().max(80).nullish(),
  area: z.string().trim().max(80).nullish(),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
});
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema
  .partial()
  .extend({ status: z.nativeEnum(ProductStatus).optional() })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const createReviewSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).nullish(),
  body: noteSchema(2000),
});
export type CreateReviewInput = z.infer<typeof createReviewSchema>;

export const vendorApplicationSchema = z.object({
  name: z.string().trim().min(2, 'Enter your business name').max(120),
  description: z.string().trim().min(20, 'Tell us about your business').max(2000),
  logoUrl: urlSchema.nullish(),
  contactEmail: z.string().trim().email().max(254),
  contactPhone: phoneSchema,
  city: z.string().trim().max(80),
  area: z.string().trim().max(80).nullish(),
  /** Business registration / tax identifier, verified by an admin. */
  registrationNumber: z.string().trim().max(64).nullish(),
});
export type VendorApplicationInput = z.infer<typeof vendorApplicationSchema>;

/* ------------------------------ addresses ------------------------------ */

export const requestPayoutSchema = z.object({
  amountMinor: positiveAmountMinorSchema,
  /** The phone this account has verified; money never leaves to an unproven number. */
  destination: phoneSchema,
  idempotencyKey: z.string().trim().min(8).max(64),
});
export type RequestPayoutInput = z.infer<typeof requestPayoutSchema>;

export const completePayoutSchema = z.object({ providerRef: z.string().trim().max(64).optional() });
export type CompletePayoutInput = z.infer<typeof completePayoutSchema>;

export const failPayoutSchema = z.object({ reason: z.string().trim().min(3).max(240) });
export type FailPayoutInput = z.infer<typeof failPayoutSchema>;

export const deliveryAddressSchema = z.object({
  label: z.string().trim().min(1).max(40).default('Home'),
  recipientName: displayNameSchema,
  phone: phoneSchema.nullish(),
  addressLine1: z.string().trim().min(3, 'Enter the address').max(160),
  addressLine2: z.string().trim().max(160).nullish(),
  city: z.string().trim().min(1, 'Enter the city').max(80),
  area: z.string().trim().max(80).nullish(),
  countryCode: z.string().trim().toUpperCase().length(2).default('KE'),
  latitude: z.number().min(-90).max(90).nullish(),
  longitude: z.number().min(-180).max(180).nullish(),
  instructions: noteSchema(500),
  isDefault: z.boolean().default(false),
});
export type DeliveryAddressInput = z.infer<typeof deliveryAddressSchema>;

/* -------------------------------- orders -------------------------------- */

const orderLineSchema = z.object({
  productId: idSchema,
  quantity: z.number().int().min(1).max(20).default(1),
  personalization: noteSchema(280),
  /** Ties the purchase back to a wish so the item is marked as fulfilled. */
  wishlistItemId: idSchema.nullish(),
});

export const createOrderSchema = z
  .object({
    items: z.array(orderLineSchema).min(1, 'Add something to your order').max(20),
    /** Who receives it (spec §18). */
    deliveryTarget: z.nativeEnum(DeliveryTarget).default(DeliveryTarget.RECIPIENT),
    recipientUserId: idSchema.optional(),
    trackedBirthdayId: idSchema.optional(),
    /** Saved address, or a one-off address supplied inline. */
    deliveryAddressId: idSchema.optional(),
    /** Public-page gifting: ship to the recipient's saved address, never shown to the buyer. */
    useRecipientAddress: z.boolean().default(false),
    deliveryAddress: deliveryAddressSchema.omit({ isDefault: true, label: true }).optional(),
    scheduledDate: civilDateSchema.optional(),
    scheduledWindow: z.enum(['MORNING', 'AFTERNOON', 'EVENING']).optional(),
    giftMessage: noteSchema(500),
    isAnonymous: z.boolean().default(false),
    couponCode: z.string().trim().toUpperCase().max(32).optional(),
    provider: z.nativeEnum(PaymentProvider),
    payerPhone: phoneSchema.optional(),
    idempotencyKey: z.string().trim().min(8).max(64),
  })
  .refine(
    (value) =>
      value.deliveryTarget === DeliveryTarget.SENDER ||
      value.useRecipientAddress ||
      value.deliveryAddressId != null ||
      value.deliveryAddress != null,
    { message: 'Add a delivery address', path: ['deliveryAddress'] },
  );
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const orderQuerySchema = paginationSchema.extend({
  status: z.string().trim().max(40).optional(),
  direction: z.enum(['SENT', 'RECEIVED']).default('SENT'),
});
export type OrderQueryInput = z.infer<typeof orderQuerySchema>;

export const cancelOrderSchema = z.object({
  reason: noteSchema(500),
});
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

/* ------------------------------- payments ------------------------------- */

export const initiatePaymentSchema = z.object({
  provider: z.nativeEnum(PaymentProvider),
  amountMinor: positiveAmountMinorSchema,
  currency: currencySchema,
  purpose: z.enum([
    'GIFT_ORDER',
    'GROUP_CONTRIBUTION',
    'DIGITAL_GIFT',
    'WALLET_TOPUP',
    'PREMIUM_SUBSCRIPTION',
  ]),
  /** Order / group gift / digital gift the payment settles. */
  referenceType: z.enum(['ORDER', 'GROUP_GIFT', 'DIGITAL_GIFT', 'WALLET', 'SUBSCRIPTION']),
  referenceId: idSchema.optional(),
  payerPhone: phoneSchema.optional(),
  returnUrl: urlSchema.optional(),
  idempotencyKey: z.string().trim().min(8).max(64),
});
export type InitiatePaymentInput = z.infer<typeof initiatePaymentSchema>;

export const walletTopupSchema = z.object({
  amountMinor: positiveAmountMinorSchema,
  currency: currencySchema,
  provider: z.nativeEnum(PaymentProvider),
  payerPhone: phoneSchema.optional(),
  idempotencyKey: z.string().trim().min(8).max(64),
});
export type WalletTopupInput = z.infer<typeof walletTopupSchema>;

/* ------------------------------- delivery ------------------------------- */

export const updateDeliveryStatusSchema = z.object({
  status: z.nativeEnum(DeliveryStatus),
  note: noteSchema(500),
  trackingCode: z.string().trim().max(64).nullish(),
  courier: z.string().trim().max(80).nullish(),
  occurredAt: isoDateTimeSchema.optional(),
});
export type UpdateDeliveryStatusInput = z.infer<typeof updateDeliveryStatusSchema>;

/* -------------------------------- coupons -------------------------------- */

export const validateCouponSchema = z.object({
  code: z.string().trim().toUpperCase().min(3).max(32),
  subtotalMinor: positiveAmountMinorSchema,
  currency: currencySchema,
});
export type ValidateCouponInput = z.infer<typeof validateCouponSchema>;
