import pino from 'pino';
import { env } from '../config/env';

/**
 * Structured logger.
 *
 * The redaction list is not decoration: tokens, OTP codes, card data and
 * payment payloads pass through this process, and a log aggregator is not a
 * safe place for any of them.
 */
export const logger = pino({
  // TEST_LOGS=1 surfaces logs while debugging a failing test.
  level: env.isTest && !process.env.TEST_LOGS ? 'silent' : env.LOG_LEVEL,
  base: { service: 'bday-api', env: env.NODE_ENV },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'res.headers["set-cookie"]',
      '*.password',
      '*.passwordHash',
      '*.newPassword',
      '*.currentPassword',
      '*.code',
      '*.codeHash',
      '*.otp',
      '*.accessToken',
      '*.refreshToken',
      '*.idToken',
      '*.tokenHash',
      '*.pushToken',
      '*.clientSecret',
      '*.redemptionCode',
      '*.consumerSecret',
      '*.passkey',
      'body.password',
      'body.newPassword',
      'body.currentPassword',
      'body.code',
      'body.idToken',
      'body.refreshToken',
      'providerPayload',
    ],
    censor: '[redacted]',
  },
  transport: env.isProduction
    ? undefined
    : {
        target: 'pino/file',
        options: { destination: 1 },
      },
});

export type Logger = typeof logger;

export function childLogger(bindings: Record<string, unknown>) {
  return logger.child(bindings);
}
