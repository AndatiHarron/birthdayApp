import { z } from 'zod';
import { GLOBAL_BIRTHDAYS } from '../constants';
import { noteSchema } from './common';

/** Opt in or out of global birthdays and set what strangers see. */
export const updateGlobalSettingsSchema = z
  .object({
    celebrateGlobally: z.boolean().optional(),
    celebrationNote: noteSchema(GLOBAL_BIRTHDAYS.maxNoteLength),
    firstCelebration: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type UpdateGlobalSettingsInput = z.infer<typeof updateGlobalSettingsSchema>;

export const globalTodayQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(30),
  /** ISO-3166-1 alpha-2, to celebrate people in one country. */
  country: z.string().trim().toUpperCase().length(2).optional(),
});
export type GlobalTodayQuery = z.infer<typeof globalTodayQuerySchema>;

export const cheerSchema = z.object({
  emoji: z.enum(['🎉', '🎂', '🎈', '❤️', '🌍', '✨']).default('🎉'),
});
export type CheerInput = z.infer<typeof cheerSchema>;
