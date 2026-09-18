import cron from 'node-cron';
import { env } from '../config/env';
import { logger } from '../lib/logger';
import { acquireLock, releaseLock } from '../lib/redis';
import { releaseScheduledDigitalGifts } from '../services/digitalGift.service';
import { expireUnpaidOrders } from '../services/order.service';
import { purgeExpiredChallenges } from '../services/otp.service';
import { reconcilePendingPayments } from '../services/payment.service';
import { expirePremium, releaseScheduledWishes, runBirthdayReminders } from '../services/reminder.service';
import { purgeExpiredTokens } from '../services/session.service';

/**
 * Scheduled jobs.
 *
 * Every job takes a Redis lock (when Redis is configured) so a fleet of API
 * instances runs each tick once, and every job is idempotent in its own right
 * so a lost lock never double-sends. A job that is still running when its next
 * tick arrives is skipped rather than stacked.
 */

interface JobDefinition {
  name: string;
  schedule: string;
  /** Upper bound on a run; also the lock TTL. */
  timeoutSeconds: number;
  run: () => Promise<unknown>;
}

export const JOBS: JobDefinition[] = [
  { name: 'birthday-reminders', schedule: env.REMINDER_CRON, timeoutSeconds: 600, run: () => runBirthdayReminders() },
  {
    name: 'scheduled-deliveries',
    schedule: env.SCHEDULED_DELIVERY_CRON,
    timeoutSeconds: 240,
    run: async () => ({ gifts: await releaseScheduledDigitalGifts(), wishes: await releaseScheduledWishes() }),
  },
  { name: 'payment-reconciliation', schedule: env.PAYMENT_RECONCILE_CRON, timeoutSeconds: 540, run: () => reconcilePendingPayments() },
  { name: 'expire-unpaid-orders', schedule: '17 * * * *', timeoutSeconds: 300, run: () => expireUnpaidOrders() },
  {
    name: 'daily-cleanup',
    schedule: '30 2 * * *',
    timeoutSeconds: 900,
    run: async () => ({
      tokens: await purgeExpiredTokens(),
      otps: await purgeExpiredChallenges(),
      premiumExpired: await expirePremium(),
    }),
  },
];

const running = new Set<string>();

export async function runJob(job: JobDefinition): Promise<void> {
  if (running.has(job.name)) {
    logger.warn({ job: job.name }, 'job still running — skipping tick');
    return;
  }
  const lockKey = `job:${job.name}`;
  if (!(await acquireLock(lockKey, job.timeoutSeconds))) return;

  running.add(job.name);
  const started = Date.now();
  try {
    const result = await job.run();
    logger.info({ job: job.name, durationMs: Date.now() - started, result }, 'job finished');
  } catch (error) {
    logger.error({ err: error, job: job.name }, 'job failed');
  } finally {
    running.delete(job.name);
    await releaseLock(lockKey);
  }
}

export function startJobs(): () => void {
  const tasks = JOBS.map((job) => {
    if (!cron.validate(job.schedule)) {
      throw new Error(`Invalid cron expression for ${job.name}: ${job.schedule}`);
    }
    return cron.schedule(job.schedule, () => void runJob(job));
  });
  logger.info({ jobs: JOBS.map((job) => `${job.name} (${job.schedule})`) }, 'scheduled jobs started');
  return () => tasks.forEach((task) => task.stop());
}
