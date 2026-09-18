import { createServer } from 'node:http';
import { createApp } from './app';
import { env } from './config/env';
import { logger } from './lib/logger';
import { disconnectPrisma } from './lib/prisma';
import { closeRedis } from './lib/redis';
import { installProcessGuards } from './middleware/error';
import { attachRealtime } from './realtime/socket';
import { setRealtimeServer } from './realtime/emitter';
import { startJobs } from './workers/jobs';

installProcessGuards();

const app = createApp();
const httpServer = createServer(app);
const io = attachRealtime(httpServer);
const stopJobs = env.RUN_WORKERS_IN_PROCESS ? startJobs() : null;

httpServer.listen(env.PORT, env.HOST, () => {
  logger.info({ port: env.PORT, env: env.NODE_ENV, docs: `${env.API_BASE_URL}/docs` }, 'api listening');
});

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  stopJobs?.();

  // Stop accepting new work, let in-flight requests finish, then close pools.
  const force = setTimeout(() => {
    logger.warn('forced shutdown after timeout');
    process.exit(1);
  }, 15_000);
  force.unref();

  void io.close(() => {
    setRealtimeServer(null);
    httpServer.close(() => {
      void Promise.allSettled([disconnectPrisma(), closeRedis()]).then(() => process.exit(0));
    });
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
