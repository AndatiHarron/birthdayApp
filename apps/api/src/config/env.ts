import 'dotenv/config';
import { z } from 'zod';

/**
 * Environment contract.
 *
 * The process refuses to boot if anything required is missing or malformed —
 * a misconfigured secret should fail loudly at startup, not silently at the
 * first request that needs it. Optional integrations degrade to a safe local
 * driver instead of throwing (see `providers/`).
 */

const booleanish = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === 'boolean' ? value : ['1', 'true', 'yes', 'on'].includes(value.toLowerCase()),
  );

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    HOST: z.string().default('0.0.0.0'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    /** Public base URL of this API, used in webhook callbacks and share links. */
    API_BASE_URL: z.string().url().default('http://localhost:4000'),
    /**
     * Public web base URL for share links (wishlists, invites, RSVPs). The API
     * serves these pages itself, so by default it is the API's own origin.
     */
    WEB_BASE_URL: z.string().url().default('http://localhost:4000'),
    /** Mobile deep-link scheme. */
    APP_DEEP_LINK_SCHEME: z.string().default('bday'),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().optional(),

    /* ---------------------------- auth ---------------------------- */
    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
    JWT_REFRESH_TTL_DAYS: z.coerce.number().int().min(1).default(60),
    JWT_ISSUER: z.string().default('bday-api'),
    BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).default(600),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(15).default(60),
    /** Echo OTP codes in the response. Development convenience only. */
    OTP_DEBUG_ECHO: booleanish.default(false),

    GOOGLE_CLIENT_IDS: z.string().optional(),
    APPLE_CLIENT_IDS: z.string().optional(),

    /* --------------------------- security -------------------------- */
    CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:19006'),
    TRUST_PROXY: booleanish.default(false),
    RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().min(1).default(60),
    RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(120),

    /* --------------------------- storage --------------------------- */
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    STORAGE_LOCAL_DIR: z.string().default('./storage'),
    STORAGE_PUBLIC_BASE_URL: z.string().url().optional(),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: booleanish.default(false),

    /* ----------------------------- ai ----------------------------- */
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-opus-5'),
    AI_MAX_OUTPUT_TOKENS: z.coerce.number().int().min(1024).max(16000).default(16000),

    /* --------------------------- payments -------------------------- */
    PAYMENTS_DEFAULT_CURRENCY: z.string().length(3).default('KES'),
    /** Simulates provider callbacks locally; refuses to run in production. */
    PAYMENTS_SANDBOX: booleanish.default(true),

    MPESA_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
    MPESA_CONSUMER_KEY: z.string().optional(),
    MPESA_CONSUMER_SECRET: z.string().optional(),
    MPESA_SHORTCODE: z.string().optional(),
    MPESA_PASSKEY: z.string().optional(),
    MPESA_CALLBACK_SECRET: z.string().optional(),

    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_PUBLISHABLE_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),

    PLATFORM_COMMISSION_BPS: z.coerce.number().int().min(0).max(5000).default(1000),

    /* ------------------------ notifications ------------------------ */
    EXPO_ACCESS_TOKEN: z.string().optional(),
    SMS_DRIVER: z.enum(['console', 'africastalking', 'twilio']).default('console'),
    AT_API_KEY: z.string().optional(),
    AT_USERNAME: z.string().optional(),
    AT_SENDER_ID: z.string().optional(),
    TWILIO_ACCOUNT_SID: z.string().optional(),
    TWILIO_AUTH_TOKEN: z.string().optional(),
    TWILIO_FROM: z.string().optional(),

    EMAIL_DRIVER: z.enum(['console', 'smtp', 'resend']).default('console'),
    EMAIL_FROM: z.string().default('Birthday App <hello@localhost>'),
    SMTP_URL: z.string().optional(),
    RESEND_API_KEY: z.string().optional(),

    /* --------------------------- workers -------------------------- */
    /** Run cron workers inside the API process. Set false when deploying a
     *  separate worker dyno so reminders are not sent twice. */
    RUN_WORKERS_IN_PROCESS: booleanish.default(true),
    REMINDER_CRON: z.string().default('*/15 * * * *'),
    SCHEDULED_DELIVERY_CRON: z.string().default('*/5 * * * *'),
    PAYMENT_RECONCILE_CRON: z.string().default('*/10 * * * *'),
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV === 'production') {
      if (value.PAYMENTS_SANDBOX) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PAYMENTS_SANDBOX'],
          message: 'PAYMENTS_SANDBOX must be false in production',
        });
      }
      if (value.OTP_DEBUG_ECHO) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['OTP_DEBUG_ECHO'],
          message: 'OTP_DEBUG_ECHO must be false in production',
        });
      }
      if (value.STORAGE_DRIVER === 's3' && !value.S3_BUCKET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['S3_BUCKET'],
          message: 'S3_BUCKET is required when STORAGE_DRIVER=s3',
        });
      }
      if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['JWT_REFRESH_SECRET'],
          message: 'Access and refresh secrets must differ',
        });
      }
    }
    if (value.STORAGE_DRIVER === 's3' && !value.S3_BUCKET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['S3_BUCKET'],
        message: 'S3_BUCKET is required when STORAGE_DRIVER=s3',
      });
    }
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  // Written directly to stderr: the logger itself depends on this config.
  process.stderr.write(`\nInvalid environment configuration:\n${issues}\n\n`);
  process.exit(1);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  isTest: raw.NODE_ENV === 'test',
  isDevelopment: raw.NODE_ENV === 'development',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  googleClientIds: (raw.GOOGLE_CLIENT_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
  appleClientIds: (raw.APPLE_CLIENT_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
} as const;

export type Env = typeof env;
