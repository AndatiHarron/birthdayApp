import { z } from 'zod';
import { LIMITS } from '../constants';
import { NotificationType, Visibility } from '../enums';
import {
  birthdayInputSchema,
  displayNameSchema,
  idSchema,
  noteSchema,
  reminderOffsetsSchema,
  searchQuerySchema,
  timezoneSchema,
  urlSchema,
  usernameSchema,
} from './common';

export const interestSlugsSchema = z
  .array(z.string().trim().toLowerCase().min(2).max(40))
  .max(30, 'Choose at most 30 interests')
  .transform((values) => Array.from(new Set(values)));

export const giftPreferencesSchema = z.object({
  /** Free-form size map, e.g. { shirt: "L", shoe: "42", ring: "7" }. */
  sizes: z.record(z.string().trim().max(24), z.string().trim().max(24)).default({}),
  favoriteColors: z.array(z.string().trim().max(24)).max(10).default([]),
  favoriteBrands: z.array(z.string().trim().max(48)).max(20).default([]),
  dislikes: z.array(z.string().trim().max(48)).max(20).default([]),
  allergies: z.array(z.string().trim().max(48)).max(20).default([]),
  notes: noteSchema(500),
});
export type GiftPreferencesInput = z.infer<typeof giftPreferencesSchema>;

export const updateProfileSchema = z
  .object({
    displayName: displayNameSchema.optional(),
    username: usernameSchema.optional(),
    bio: noteSchema(LIMITS.maxBioLength),
    avatarUrl: urlSchema.nullish(),
    birthday: birthdayInputSchema.optional(),
    interests: interestSlugsSchema.optional(),
    giftPreferences: giftPreferencesSchema.partial().optional(),
    timezone: timezoneSchema.optional(),
    /** ISO-3166-1 alpha-2, drives currency and local vendor discovery. */
    countryCode: z.string().trim().toUpperCase().length(2).optional(),
    city: z.string().trim().max(80).nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

export const privacySettingsSchema = z.object({
  profileVisibility: z.nativeEnum(Visibility).optional(),
  birthdayVisibility: z.nativeEnum(Visibility).optional(),
  wishlistVisibility: z.nativeEnum(Visibility).optional(),
  giftHistoryVisibility: z.nativeEnum(Visibility).optional(),
  showAge: z.boolean().optional(),
  showBirthYear: z.boolean().optional(),
  discoverableByPhone: z.boolean().optional(),
  discoverableByEmail: z.boolean().optional(),
  discoverableByUsername: z.boolean().optional(),
});
export type PrivacySettingsInput = z.infer<typeof privacySettingsSchema>;

export const notificationPreferencesSchema = z.object({
  reminderOffsetsDays: reminderOffsetsSchema.optional(),
  channels: z
    .object({
      push: z.boolean().optional(),
      email: z.boolean().optional(),
      sms: z.boolean().optional(),
    })
    .optional(),
  mutedTypes: z.array(z.nativeEnum(NotificationType)).max(40).optional(),
  quietHoursStart: z.number().int().min(0).max(23).nullish(),
  quietHoursEnd: z.number().int().min(0).max(23).nullish(),
  timezone: timezoneSchema.optional(),
});
export type NotificationPreferencesInput = z.infer<typeof notificationPreferencesSchema>;

export const completeOnboardingSchema = z.object({
  birthday: birthdayInputSchema,
  showBirthYear: z.boolean().default(true),
  interests: interestSlugsSchema,
  username: usernameSchema.optional(),
  permissionsGranted: z
    .object({
      notifications: z.boolean().default(false),
      contacts: z.boolean().default(false),
      calendar: z.boolean().default(false),
    })
    .default({ notifications: false, contacts: false, calendar: false }),
  timezone: timezoneSchema.optional(),
});
export type CompleteOnboardingInput = z.infer<typeof completeOnboardingSchema>;

export const registerPushTokenSchema = z.object({
  token: z.string().trim().min(8).max(256),
  platform: z.enum(['ios', 'android', 'web']),
  deviceId: z.string().trim().min(4).max(128).optional(),
});
export type RegisterPushTokenInput = z.infer<typeof registerPushTokenSchema>;

export const userSearchSchema = z.object({
  q: searchQuerySchema,
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type UserSearchInput = z.infer<typeof userSearchSchema>;

export const blockUserSchema = z.object({
  userId: idSchema,
  reason: noteSchema(280),
});
export type BlockUserInput = z.infer<typeof blockUserSchema>;

export const deleteAccountSchema = z.object({
  /** Password or OTP code, whichever the account uses. */
  confirmation: z.string().min(1, 'Confirm to continue'),
  reason: noteSchema(500),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
