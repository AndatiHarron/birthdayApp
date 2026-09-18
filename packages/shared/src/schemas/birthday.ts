import { z } from 'zod';
import { RelationshipType } from '../enums';
import {
  birthdayInputSchema,
  displayNameSchema,
  emailSchema,
  hexColorSchema,
  idSchema,
  noteSchema,
  phoneSchema,
  reminderOffsetsSchema,
  urlSchema,
} from './common';
import { interestSlugsSchema } from './user';

export const createTrackedBirthdaySchema = z.object({
  name: displayNameSchema,
  birthday: birthdayInputSchema,
  phone: phoneSchema.nullish(),
  email: emailSchema.nullish(),
  relationship: z.nativeEnum(RelationshipType).default(RelationshipType.FRIEND),
  avatarUrl: urlSchema.nullish(),
  interests: interestSlugsSchema.optional(),
  notes: noteSchema(1000),
  groupIds: z.array(idSchema).max(20).default([]),
  isFavorite: z.boolean().default(false),
  reminderOffsetsDays: reminderOffsetsSchema.optional(),
  /** Link this entry to an existing platform user. */
  linkedUserId: idSchema.nullish(),
});
export type CreateTrackedBirthdayInput = z.infer<typeof createTrackedBirthdaySchema>;

export const updateTrackedBirthdaySchema = createTrackedBirthdaySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type UpdateTrackedBirthdayInput = z.infer<typeof updateTrackedBirthdaySchema>;

export const upcomingBirthdaysSchema = z.object({
  /** How far ahead to look. */
  withinDays: z.coerce.number().int().min(1).max(366).default(60),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  groupId: idSchema.optional(),
  relationship: z.nativeEnum(RelationshipType).optional(),
  favoritesOnly: z.coerce.boolean().default(false),
});
export type UpcomingBirthdaysInput = z.infer<typeof upcomingBirthdaysSchema>;

export const calendarQuerySchema = z.object({
  year: z.coerce.number().int().min(1970).max(2200),
  month: z.coerce.number().int().min(1).max(12),
  groupId: idSchema.optional(),
  relationship: z.nativeEnum(RelationshipType).optional(),
});
export type CalendarQueryInput = z.infer<typeof calendarQuerySchema>;

/**
 * Contacts arrive from the device address book. We only ever accept the fields
 * below — never the whole contact card — and the client is expected to ask for
 * permission first (spec §4 screen 4).
 */
export const contactImportSchema = z.object({
  contacts: z
    .array(
      z.object({
        externalId: z.string().trim().min(1).max(128),
        name: displayNameSchema,
        phone: phoneSchema.nullish(),
        email: emailSchema.nullish(),
        birthday: birthdayInputSchema.nullish(),
      }),
    )
    .min(1, 'No contacts to import')
    .max(1000, 'Import at most 1000 contacts at a time'),
});
export type ContactImportInput = z.infer<typeof contactImportSchema>;

export const confirmContactImportSchema = z.object({
  selections: z
    .array(
      z.object({
        externalId: z.string().trim().min(1).max(128),
        name: displayNameSchema,
        birthday: birthdayInputSchema,
        phone: phoneSchema.nullish(),
        email: emailSchema.nullish(),
        relationship: z.nativeEnum(RelationshipType).default(RelationshipType.FRIEND),
      }),
    )
    .min(1)
    .max(500),
});
export type ConfirmContactImportInput = z.infer<typeof confirmContactImportSchema>;

export const createFriendGroupSchema = z.object({
  name: z.string().trim().min(1, 'Name the group').max(40),
  color: hexColorSchema.nullish(),
  memberIds: z.array(idSchema).max(500).default([]),
});
export type CreateFriendGroupInput = z.infer<typeof createFriendGroupSchema>;

export const updateFriendGroupSchema = createFriendGroupSchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type UpdateFriendGroupInput = z.infer<typeof updateFriendGroupSchema>;

export const friendRequestSchema = z
  .object({
    userId: idSchema.optional(),
    username: z.string().trim().toLowerCase().min(3).max(24).optional(),
    relationship: z.nativeEnum(RelationshipType).optional(),
    message: noteSchema(280),
  })
  .refine((value) => value.userId != null || value.username != null, {
    message: 'Choose someone to add',
    path: ['userId'],
  });
export type FriendRequestInput = z.infer<typeof friendRequestSchema>;

export const respondToFriendRequestSchema = z.object({
  requestId: idSchema,
  action: z.enum(['ACCEPT', 'DECLINE']),
  relationship: z.nativeEnum(RelationshipType).optional(),
  groupIds: z.array(idSchema).max(20).default([]),
});
export type RespondToFriendRequestInput = z.infer<typeof respondToFriendRequestSchema>;

export const updateFriendshipSchema = z
  .object({
    relationship: z.nativeEnum(RelationshipType).optional(),
    isFavorite: z.boolean().optional(),
    groupIds: z.array(idSchema).max(20).optional(),
    reminderOffsetsDays: reminderOffsetsSchema.nullish(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type UpdateFriendshipInput = z.infer<typeof updateFriendshipSchema>;

export const createInviteSchema = z.object({
  /** Attach the invite to a manual birthday entry so accepting links them. */
  trackedBirthdayId: idSchema.optional(),
  expiresInDays: z.coerce.number().int().min(1).max(90).default(30),
});
export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export const acceptInviteSchema = z.object({
  code: z.string().trim().min(6).max(32),
});
export type AcceptInviteInput = z.infer<typeof acceptInviteSchema>;
