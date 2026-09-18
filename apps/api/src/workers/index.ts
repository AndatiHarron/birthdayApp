import { env } from '../config/env';
import { installProcessGuards } from '../middleware/error';
import { logger } from '../lib/logger';
import { disconnectPrisma } from '../lib/prisma';
import { closeRedis } from '../lib/redis';
import { JOBS, runJob, startJobs } from './jobs';

/**
 * Standalone worker process (`npm run worker`).
 *
 * Deploy this alongside the API with `RUN_WORKERS_IN_PROCESS=false` on the API
 * instances. `node dist/workers/index.js --once <job>` runs a single job and
 * exits, which is handy for a platform scheduler or a manual backfill.
 */
installProcessGuards();

async function main(): Promise<void> {
  const onceIndex = process.argv.indexOf('--once');
  if (onceIndex >= 0) {
    const name = process.argv[onceIndex + 1];
    const job = JOBS.find((entry) => entry.name === name);
    if (!job) {
      logger.error({ available: JOBS.map((entry) => entry.name) }, `unknown job: ${name}`);
      process.exitCode = 1;
      return;
    }
    await runJob(job);
    await shutdown();
    return;
  }

  logger.info({ env: env.NODE_ENV }, 'worker starting');
  const stop = startJobs();

  const onSignal = (signal: string) => {
    logger.info({ signal }, 'worker shutting down');
    stop();
    void shutdown().then(() => process.exit(0));
  };
  process.on('SIGTERM', () => onSignal('SIGTERM'));
  process.on('SIGINT', () => onSignal('SIGINT'));
}

async function shutdown(): Promise<void> {
  await Promise.allSettled([disconnectPrisma(), closeRedis()]);
}

void main();
