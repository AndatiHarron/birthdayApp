import { z } from 'zod';
import { LIMITS } from '../constants';
import {
  BirthdayMessageKind,
  CardTemplateStyle,
  PaymentProvider,
  MessageKind,
  ReportReason,
  RsvpStatus,
  Visibility,
} from '../enums';
import {
  amountMinorSchema,
  coordinateSchema,
  displayNameSchema,
  hexColorSchema,
  idSchema,
  isoDateTimeSchema,
  noteSchema,
  paginationSchema,
  phoneSchema,
  positiveAmountMinorSchema,
  currencySchema,
  urlSchema,
} from './common';

/* --------------------------- birthday cards --------------------------- */

const placementSchema = z.object({
  x: z.number().min(-1).max(2),
  y: z.number().min(-1).max(2),
  scale: z.number().min(0.05).max(8).default(1),
  rotation: z.number().min(-360).max(360).default(0),
});

export const birthdayCardSchema = z.object({
  templateId: idSchema.nullish(),
  style: z.nativeEnum(CardTemplateStyle).default(CardTemplateStyle.SIMPLE),
  backgroundUrl: urlSchema.nullish(),
  backgroundColor: hexColorSchema.nullish(),
  headline: z.string().trim().max(80).nullish(),
  body: z.string().trim().max(600).nullish(),
  fontFamily: z.string().trim().max(60).nullish(),
  stickers: z
    .array(placementSchema.extend({ id: z.string().trim().max(64), url: urlSchema }))
    .max(20)
    .default([]),
  photos: z.array(placementSchema.extend({ url: urlSchema })).max(6).default([]),
  musicUrl: urlSchema.nullish(),
  animation: z.string().trim().max(40).nullish(),
});
export type BirthdayCardInput = z.infer<typeof birthdayCardSchema>;

/* --------------------------- birthday wishes --------------------------- */

export const sendBirthdayMessageSchema = z
  .object({
    recipientUserId: idSchema.optional(),
    trackedBirthdayId: idSchema.optional(),
    kind: z.nativeEnum(BirthdayMessageKind).default(BirthdayMessageKind.TEXT),
    body: z.string().trim().max(LIMITS.maxMessageLength).nullish(),
    mediaUrl: urlSchema.nullish(),
    /** Length of a voice or video wish, used for the player UI. */
    durationSeconds: z.number().int().min(1).max(600).nullish(),
    card: birthdayCardSchema.optional(),
    /** Queue the wish to arrive on the morning of their birthday. */
    deliverAt: isoDateTimeSchema.optional(),
    isAnonymous: z.boolean().default(false),
    /**
     * Money with the wish — the heart of the product: wishing is free, and
     * anyone who wants to can add cash, which lands in the recipient's wallet.
     */
    money: z
      .object({
        amountMinor: positiveAmountMinorSchema,
        currency: currencySchema,
        provider: z.nativeEnum(PaymentProvider),
        payerPhone: phoneSchema.optional(),
        idempotencyKey: z.string().trim().min(8).max(64),
      })
      .optional(),
  })
  .refine((value) => value.recipientUserId != null || value.trackedBirthdayId != null, {
    message: 'Choose who to wish',
    path: ['recipientUserId'],
  })
  .refine(
    (value) =>
      value.kind === BirthdayMessageKind.TEXT
        ? (value.body?.trim().length ?? 0) > 0
        : value.mediaUrl != null || value.card != null || (value.body?.trim().length ?? 0) > 0,
    { message: 'Add a message', path: ['body'] },
  );
export type SendBirthdayMessageInput = z.infer<typeof sendBirthdayMessageSchema>;

export const reactToMessageSchema = z.object({
  emoji: z.string().trim().min(1).max(8),
});
export type ReactToMessageInput = z.infer<typeof reactToMessageSchema>;

export const sendThankYouSchema = z
  .object({
    giftType: z.enum(['RESERVATION', 'DIGITAL_GIFT', 'ORDER', 'GROUP_GIFT']),
    giftId: idSchema,
    kind: z.nativeEnum(BirthdayMessageKind).default(BirthdayMessageKind.TEXT),
    body: z.string().trim().max(LIMITS.maxMessageLength).nullish(),
    mediaUrl: urlSchema.nullish(),
  })
  .refine(
    (value) => (value.body?.trim().length ?? 0) > 0 || value.mediaUrl != null,
    { message: 'Add a thank-you message', path: ['body'] },
  );
export type SendThankYouInput = z.infer<typeof sendThankYouSchema>;

/* ------------------------------ memories ------------------------------ */

export const createMemorySchema = z.object({
  celebrationYear: z.number().int().min(1900).max(2200),
  title: z.string().trim().max(120).nullish(),
  note: noteSchema(2000),
  media: z
    .array(
      z.object({
        url: urlSchema,
        kind: z.enum(['IMAGE', 'VIDEO']),
        caption: z.string().trim().max(200).nullish(),
      }),
    )
    .max(50)
    .default([]),
  visibility: z.nativeEnum(Visibility).default(Visibility.FRIENDS),
});
export type CreateMemoryInput = z.infer<typeof createMemorySchema>;

export const updateMemorySchema = createMemorySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type UpdateMemoryInput = z.infer<typeof updateMemorySchema>;

/* ------------------------------- events ------------------------------- */

const eventFieldsSchema = z.object({
  name: z.string().trim().min(1, 'Name the event').max(120),
  description: noteSchema(2000),
  startsAt: isoDateTimeSchema,
  endsAt: isoDateTimeSchema.nullish(),
  venueName: z.string().trim().max(120).nullish(),
  venueAddress: z.string().trim().max(240).nullish(),
  location: coordinateSchema.partial().optional(),
  coverImageUrl: urlSchema.nullish(),
  /** Attach a gift registry (spec §30). */
  wishlistId: idSchema.nullish(),
  guestUserIds: z.array(idSchema).max(500).default([]),
  guestNames: z.array(displayNameSchema).max(500).default([]),
  allowPlusOnes: z.boolean().default(false),
  createGroupChat: z.boolean().default(true),
});

const endsAfterStart = (value: { startsAt?: string; endsAt?: string | null }): boolean =>
  value.endsAt == null || value.startsAt == null || new Date(value.endsAt) > new Date(value.startsAt);

export const createEventSchema = eventFieldsSchema.refine(endsAfterStart, {
  message: 'The end time must be after the start time',
  path: ['endsAt'],
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = eventFieldsSchema
  .omit({ guestUserIds: true, guestNames: true, createGroupChat: true })
  .partial()
  .refine(endsAfterStart, {
    message: 'The end time must be after the start time',
    path: ['endsAt'],
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const rsvpSchema = z.object({
  status: z.nativeEnum(RsvpStatus),
  plusOnes: z.number().int().min(0).max(10).default(0),
  note: noteSchema(280),
});
export type RsvpInput = z.infer<typeof rsvpSchema>;

export const inviteGuestsSchema = z.object({
  userIds: z.array(idSchema).max(500).default([]),
  names: z.array(displayNameSchema).max(500).default([]),
}).refine(
  (value) => value.userIds.length > 0 || value.names.length > 0,
  'Add at least one guest',
);
export type InviteGuestsInput = z.infer<typeof inviteGuestsSchema>;

/* -------------------------------- chat -------------------------------- */

export const sendChatMessageSchema = z
  .object({
    kind: z.nativeEnum(MessageKind).default(MessageKind.TEXT),
    body: z.string().trim().max(LIMITS.maxMessageLength).nullish(),
    mediaUrl: urlSchema.nullish(),
    durationSeconds: z.number().int().min(1).max(600).nullish(),
    /** Client-side id so optimistic messages can be reconciled. */
    clientId: z.string().trim().max(64).optional(),
  })
  .refine(
    (value) => (value.body?.trim().length ?? 0) > 0 || value.mediaUrl != null,
    { message: 'Type a message', path: ['body'] },
  );
export type SendChatMessageInput = z.infer<typeof sendChatMessageSchema>;

export const createPollSchema = z.object({
  question: z.string().trim().min(1, 'Ask a question').max(200),
  options: z
    .array(z.string().trim().min(1).max(120))
    .min(2, 'Add at least two options')
    .max(10),
  allowsMultiple: z.boolean().default(false),
  closesAt: isoDateTimeSchema.nullish(),
});
export type CreatePollInput = z.infer<typeof createPollSchema>;

export const votePollSchema = z.object({
  optionIds: z.array(idSchema).min(1).max(10),
});
export type VotePollInput = z.infer<typeof votePollSchema>;

export const createConversationSchema = z.object({
  memberIds: z.array(idSchema).min(1).max(200),
  title: z.string().trim().max(80).nullish(),
});
export type CreateConversationInput = z.infer<typeof createConversationSchema>;

/* ---------------------------- notifications ---------------------------- */

export const notificationQuerySchema = paginationSchema.extend({
  unreadOnly: z.coerce.boolean().default(false),
});
export type NotificationQueryInput = z.infer<typeof notificationQuerySchema>;

export const markNotificationsReadSchema = z.object({
  ids: z.array(idSchema).max(200).optional(),
  all: z.boolean().default(false),
});
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>;

/* ------------------------------- reports ------------------------------- */

export const createReportSchema = z.object({
  targetType: z.enum(['USER', 'PRODUCT', 'VENDOR', 'MESSAGE', 'WISHLIST_ITEM', 'ORDER']),
  targetId: idSchema,
  reason: z.nativeEnum(ReportReason),
  details: noteSchema(2000),
});
export type CreateReportInput = z.infer<typeof createReportSchema>;

/* -------------------------------- search -------------------------------- */

export const globalSearchSchema = z.object({
  q: z.string().trim().min(1, 'Enter something to search for').max(120),
  types: z
    .array(z.enum(['PEOPLE', 'PRODUCTS', 'WISHLISTS', 'EVENTS', 'VENDORS']))
    .max(5)
    .default(['PEOPLE', 'PRODUCTS', 'WISHLISTS', 'EVENTS', 'VENDORS']),
  limit: z.coerce.number().int().min(1).max(20).default(5),
  minPriceMinor: amountMinorSchema.optional(),
  maxPriceMinor: amountMinorSchema.optional(),
  city: z.string().trim().max(80).optional(),
});
export type GlobalSearchInput = z.infer<typeof globalSearchSchema>;
