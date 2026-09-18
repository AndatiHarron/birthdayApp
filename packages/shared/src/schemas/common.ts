import { z } from 'zod';
import {
  ALLOWED_REMINDER_OFFSETS_DAYS,
  LIMITS,
  RESERVED_USERNAMES,
  SUPPORTED_CURRENCIES,
} from '../constants';
import { isValidBirthday } from '../utils/birthday';

/** CUID2-ish / UUID tolerant id. Prisma generates cuid() values by default. */
export const idSchema = z
  .string()
  .trim()
  .min(8, 'Invalid identifier')
  .max(64, 'Invalid identifier')
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid identifier');

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email('Enter a valid email address');

/**
 * E.164 phone number. We require the leading `+` so a Kenyan 07xx number and a
 * US number cannot collide, and so SMS providers get an unambiguous value.
 */
export const phoneSchema = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s()-]/g, ''))
  .pipe(
    z
      .string()
      .regex(/^\+[1-9]\d{7,14}$/, 'Enter a phone number in international format, e.g. +254712345678'),
  );

export const passwordSchema = z
  .string()
  .min(8, 'Use at least 8 characters')
  .max(128, 'That password is too long')
  .refine((value) => /[a-z]/.test(value), 'Include a lowercase letter')
  .refine((value) => /[A-Z]/.test(value), 'Include an uppercase letter')
  .refine((value) => /\d/.test(value), 'Include a number');

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Usernames are at least 3 characters')
  .max(24, 'Usernames are at most 24 characters')
  .regex(/^[a-z0-9._]+$/, 'Use letters, numbers, dots and underscores only')
  .refine((value) => !value.startsWith('.') && !value.endsWith('.'), 'Cannot start or end with a dot')
  .refine((value) => !value.includes('..'), 'Cannot contain consecutive dots')
  .refine(
    (value) => !(RESERVED_USERNAMES as readonly string[]).includes(value),
    'That username is reserved',
  );

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name')
  .max(60, 'That name is too long');

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Enter the 6-digit code');

export const currencySchema = z.enum(SUPPORTED_CURRENCIES);

/** Money on the wire is always an integer count of minor units. */
export const amountMinorSchema = z
  .number()
  .int('Amount must be a whole number of cents')
  .nonnegative('Amount cannot be negative')
  .max(1_000_000_000_000, 'Amount is too large');

export const positiveAmountMinorSchema = amountMinorSchema.refine(
  (value) => value > 0,
  'Amount must be greater than zero',
);

export const urlSchema = z
  .string()
  .trim()
  .max(2048)
  .url('Enter a valid link')
  .refine(
    (value) => /^https?:\/\//i.test(value),
    'Links must start with http:// or https://',
  );

export const isoDateTimeSchema = z
  .string()
  .datetime({ offset: true, message: 'Enter a valid ISO-8601 timestamp' });

export const civilDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD');

export const birthdayPartsSchema = z
  .object({
    month: z.number().int().min(1).max(12),
    day: z.number().int().min(1).max(31),
    year: z.number().int().min(1900).max(new Date().getUTCFullYear()).nullish(),
  })
  .refine((value) => isValidBirthday(value), {
    message: 'That date does not exist',
    path: ['day'],
  });

/**
 * Accepts either `{ month, day, year? }` or an ISO date string, so clients can
 * post whatever their date picker produces.
 */
export const birthdayInputSchema = z.union([
  birthdayPartsSchema,
  civilDateSchema.transform((value, ctx) => {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const parts = { year, month, day };
    if (!isValidBirthday(parts)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'That date does not exist' });
      return z.NEVER;
    }
    return parts;
  }),
]);

export const reminderOffsetsSchema = z
  .array(z.number().int())
  .max(10, 'Choose at most 10 reminders')
  .refine(
    (values) => values.every((v) => (ALLOWED_REMINDER_OFFSETS_DAYS as readonly number[]).includes(v)),
    `Reminders must be one of: ${ALLOWED_REMINDER_OFFSETS_DAYS.join(', ')} days before`,
  )
  .transform((values) => Array.from(new Set(values)).sort((a, b) => b - a));

export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone');

export const paginationSchema = z.object({
  cursor: z.string().trim().max(256).optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITS.maxPageSize)
    .default(LIMITS.defaultPageSize),
});
export type PaginationInput = z.infer<typeof paginationSchema>;

export const searchQuerySchema = z.string().trim().min(1, 'Enter something to search for').max(120);

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Enter a hex colour like #FF5A5F');

export const coordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

/** Free-text note fields; trimmed, length-capped, empty string becomes null. */
export function noteSchema(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .transform((value) => (value.length === 0 ? null : value))
    .nullish();
}
