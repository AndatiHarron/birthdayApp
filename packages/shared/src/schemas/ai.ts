import { z } from 'zod';
import { RelationshipType } from '../enums';
import { amountMinorSchema, currencySchema, idSchema } from './common';
import { interestSlugsSchema } from './user';

export const giftRefinementSchema = z.enum([
  'CHEAPER',
  'PREMIUM',
  'ROMANTIC',
  'FUNNY',
  'UNEXPECTED',
  'MORE_LIKE_THIS',
  'SURPRISE_ME',
]);
export type GiftRefinementInput = z.infer<typeof giftRefinementSchema>;

/**
 * Either identify the recipient (so the server can pull their interests and
 * wishlist) or describe them in prose — the assistant handles both (spec §47).
 */
export const giftSuggestionSchema = z
  .object({
    recipientUserId: idSchema.optional(),
    trackedBirthdayId: idSchema.optional(),
    prompt: z.string().trim().min(3).max(1000).optional(),
    budgetMinMinor: amountMinorSchema.optional(),
    budgetMaxMinor: amountMinorSchema.optional(),
    currency: currencySchema.optional(),
    relationship: z.nativeEnum(RelationshipType).optional(),
    occasion: z.string().trim().max(60).default('Birthday'),
    interests: interestSlugsSchema.optional(),
    recipientAge: z.number().int().min(0).max(120).optional(),
    refinement: giftRefinementSchema.optional(),
    /** Continue a prior assistant thread so refinements keep context. */
    conversationId: idSchema.optional(),
    limit: z.number().int().min(1).max(10).default(5),
  })
  .refine(
    (value) =>
      value.recipientUserId != null || value.trackedBirthdayId != null || value.prompt != null,
    { message: 'Tell us who the gift is for', path: ['prompt'] },
  )
  .refine(
    (value) =>
      value.budgetMinMinor == null ||
      value.budgetMaxMinor == null ||
      value.budgetMinMinor <= value.budgetMaxMinor,
    { message: 'The minimum budget cannot exceed the maximum', path: ['budgetMinMinor'] },
  );
export type GiftSuggestionInput = z.infer<typeof giftSuggestionSchema>;

/**
 * Shape the model is asked to return. Validated before anything reaches a
 * client — a model response is untrusted input like any other.
 */
export const aiSuggestionPayloadSchema = z.object({
  intro: z.string().max(400),
  suggestions: z
    .array(
      z.object({
        name: z.string().min(1).max(140),
        description: z.string().min(1).max(600),
        estimatedPriceMajor: z.number().nonnegative().max(100_000_000).nullable(),
        reason: z.string().min(1).max(600),
        categorySlug: z.string().max(60).nullable(),
        searchQuery: z.string().min(1).max(120),
      }),
    )
    .min(1)
    .max(10),
});
export type AiSuggestionPayload = z.infer<typeof aiSuggestionPayloadSchema>;

export const giftMatchSchema = z.object({
  recipientUserId: idSchema.optional(),
  trackedBirthdayId: idSchema.optional(),
  budgetMinMinor: amountMinorSchema.optional(),
  budgetMaxMinor: amountMinorSchema.optional(),
  currency: currencySchema.optional(),
  limit: z.coerce.number().int().min(1).max(20).default(10),
});
export type GiftMatchInput = z.infer<typeof giftMatchSchema>;
