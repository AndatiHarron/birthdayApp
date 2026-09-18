import { z } from 'zod';
import { LIMITS } from '../constants';
import { DigitalGiftType, PaymentProvider } from '../enums';
import {
  amountMinorSchema,
  currencySchema,
  displayNameSchema,
  idSchema,
  isoDateTimeSchema,
  noteSchema,
  phoneSchema,
  positiveAmountMinorSchema,
  urlSchema,
} from './common';

/* --------------------------- group gifting --------------------------- */

export const createGroupGiftSchema = z
  .object({
    title: z.string().trim().min(1, 'Name the gift').max(120),
    description: noteSchema(1000),
    imageUrl: urlSchema.nullish(),
    targetMinor: positiveAmountMinorSchema,
    currency: currencySchema,
    /** Exactly one of these three identifies who the gift is for. */
    beneficiaryUserId: idSchema.optional(),
    trackedBirthdayId: idSchema.optional(),
    beneficiaryName: displayNameSchema.optional(),
    wishlistItemId: idSchema.optional(),
    productId: idSchema.optional(),
    deadline: isoDateTimeSchema.optional(),
    minContributionMinor: amountMinorSchema.default(LIMITS.minContributionMinor),
    /** Invite these friends into the (private) planning group immediately. */
    inviteUserIds: z.array(idSchema).max(LIMITS.groupGiftMembers.premium).default([]),
    /** Spin up a surprise chat group alongside the gift. */
    createSurpriseGroup: z.boolean().default(true),
  })
  .refine(
    (value) =>
      value.beneficiaryUserId != null ||
      value.trackedBirthdayId != null ||
      value.beneficiaryName != null,
    { message: 'Choose who this gift is for', path: ['beneficiaryUserId'] },
  );
export type CreateGroupGiftInput = z.infer<typeof createGroupGiftSchema>;

export const updateGroupGiftSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    description: noteSchema(1000),
    imageUrl: urlSchema.nullish(),
    targetMinor: positiveAmountMinorSchema.optional(),
    deadline: isoDateTimeSchema.nullish(),
    minContributionMinor: amountMinorSchema.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type UpdateGroupGiftInput = z.infer<typeof updateGroupGiftSchema>;

export const contributeSchema = z.object({
  amountMinor: positiveAmountMinorSchema,
  currency: currencySchema,
  isAnonymous: z.boolean().default(false),
  message: noteSchema(280),
  provider: z.nativeEnum(PaymentProvider),
  /** Phone number for the M-Pesa STK push, when it differs from the profile. */
  payerPhone: phoneSchema.optional(),
  /** Client-generated key so a retried request cannot double-charge. */
  idempotencyKey: z.string().trim().min(8).max(64),
});
export type ContributeInput = z.infer<typeof contributeSchema>;

export const inviteToGroupGiftSchema = z.object({
  userIds: z.array(idSchema).min(1).max(LIMITS.groupGiftMembers.premium),
});
export type InviteToGroupGiftInput = z.infer<typeof inviteToGroupGiftSchema>;

export const revealGroupGiftSchema = z.object({
  /** Message shown to the birthday person when the surprise is revealed. */
  message: noteSchema(500),
  /** Also make the contributor list visible to them. */
  revealContributors: z.boolean().default(true),
});
export type RevealGroupGiftInput = z.infer<typeof revealGroupGiftSchema>;

/* ----------------------------- surprises ----------------------------- */

export const createSurpriseSchema = z
  .object({
    title: z.string().trim().min(1, 'Name the surprise').max(120),
    beneficiaryUserId: idSchema.optional(),
    trackedBirthdayId: idSchema.optional(),
    beneficiaryName: displayNameSchema.optional(),
    memberIds: z.array(idSchema).max(LIMITS.groupGiftMembers.premium).default([]),
    budgetMinor: amountMinorSchema.nullish(),
    currency: currencySchema,
  })
  .refine(
    (value) =>
      value.beneficiaryUserId != null ||
      value.trackedBirthdayId != null ||
      value.beneficiaryName != null,
    { message: 'Choose who the surprise is for', path: ['beneficiaryUserId'] },
  );
export type CreateSurpriseInput = z.infer<typeof createSurpriseSchema>;

/* --------------------------- digital gifts --------------------------- */

export const sendDigitalGiftSchema = z
  .object({
    type: z.nativeEnum(DigitalGiftType),
    recipientUserId: idSchema.optional(),
    recipientPhone: phoneSchema.optional(),
    title: z.string().trim().max(120).optional(),
    message: noteSchema(LIMITS.maxMessageLength),
    /** Monetary face value, required for voucher/airtime/credit types. */
    valueMinor: positiveAmountMinorSchema.optional(),
    currency: currencySchema.optional(),
    cardId: idSchema.optional(),
    animation: z.string().trim().max(40).optional(),
    isAnonymous: z.boolean().default(false),
    /** Schedule ahead — the gift stays hidden until this moment (spec §18). */
    deliverAt: isoDateTimeSchema.optional(),
    provider: z.nativeEnum(PaymentProvider).optional(),
    payerPhone: phoneSchema.optional(),
    idempotencyKey: z.string().trim().min(8).max(64),
  })
  .refine((value) => value.recipientUserId != null || value.recipientPhone != null, {
    message: 'Choose who to send this to',
    path: ['recipientUserId'],
  });
export type SendDigitalGiftInput = z.infer<typeof sendDigitalGiftSchema>;

export const openDigitalGiftSchema = z.object({
  giftId: idSchema,
});
export type OpenDigitalGiftInput = z.infer<typeof openDigitalGiftSchema>;

/* ------------------------ manual gift history ------------------------ */

export const createGiftHistoryEntrySchema = z.object({
  direction: z.enum(['RECEIVED', 'SENT']),
  title: z.string().trim().min(1).max(140),
  imageUrl: urlSchema.nullish(),
  counterpartyUserId: idSchema.nullish(),
  counterpartyName: displayNameSchema.nullish(),
  occasion: z.string().trim().max(60).default('Birthday'),
  celebrationYear: z.number().int().min(1900).max(2200).nullish(),
  priceMinor: amountMinorSchema.nullish(),
  currency: currencySchema.optional(),
  message: noteSchema(1000),
  occurredAt: isoDateTimeSchema.optional(),
});
export type CreateGiftHistoryEntryInput = z.infer<typeof createGiftHistoryEntrySchema>;
