import path from 'node:path';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { env } from './config/env';
import { buildOpenApiDocument } from './docs/openapi';
import { logger, redactUrl } from './lib/logger';
import { prisma } from './lib/prisma';
import { getRedis } from './lib/redis';
import { errorHandler, notFoundHandler } from './middleware/error';
import { globalLimiter } from './middleware/rateLimit';
import { requestId } from './middleware/requestId';
import { webhookRouter } from './routes/commerce.routes';
import { publicRouter } from './routes/public.routes';
import { buildApiRouter } from './routes';

/**
 * Express application.
 *
 * Built by a function, not at import time, so tests get a fresh app without
 * opening a port and the worker process can import services without Express.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  if (env.TRUST_PROXY) app.set('trust proxy', 1);

  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).id,
      autoLogging: { ignore: (req) => req.url === '/health' || req.url === '/ready' },
      customLogLevel: (_req, res, error) => (error || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'info' : 'debug'),
      serializers: {
        req: (req: { url: string }) => {
          req.url = redactUrl(req.url);
          return req;
        },
      },
    }),
  );

  app.use(
    helmet({
      // The API serves JSON plus the Swagger UI page; the UI needs inline assets.
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(
    cors({
      origin: (origin, callback) => {
        // Native apps send no Origin header; browsers must be allow-listed.
        if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
        return callback(null, false);
      },
      credentials: true,
      maxAge: 600,
    }),
  );

  app.use(compression());

  /* health probes ------------------------------------------------------- */
  app.get('/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok', uptimeSeconds: Math.round(process.uptime()) } });
  });

  app.get('/ready', (_req, res) => {
    void (async () => {
      const checks: Record<string, 'ok' | 'error' | 'disabled'> = {};
      try {
        await prisma.$queryRaw`SELECT 1`;
        checks.database = 'ok';
      } catch {
        checks.database = 'error';
      }
      const redis = getRedis();
      if (!redis) checks.redis = 'disabled';
      else checks.redis = await redis.ping().then(() => 'ok' as const).catch(() => 'error' as const);
      const healthy = checks.database === 'ok' && checks.redis !== 'error';
      res.status(healthy ? 200 : 503).json({ success: healthy, data: { checks } });
    })();
  });

  /* webhooks need the raw body, so they are mounted before JSON parsing -- */
  app.use('/api/v1/webhooks', webhookRouter);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  app.use(cookieParser());

  /* locally stored uploads ---------------------------------------------- */
  if (env.STORAGE_DRIVER === 'local') {
    app.use(
      '/uploads',
      express.static(path.resolve(process.cwd(), env.STORAGE_LOCAL_DIR), {
        fallthrough: false,
        index: false,
        maxAge: '7d',
        setHeaders: (res) => {
          // Uploaded bytes are never executed or sniffed as HTML.
          res.setHeader('x-content-type-options', 'nosniff');
          res.setHeader('content-security-policy', "default-src 'none'; img-src 'self'; media-src 'self'; sandbox");
        },
      }),
    );
  }
  app.use('/static', express.static(path.resolve(__dirname, '../public'), { index: false, maxAge: '30d' }));

  /* public share pages (wishlist, RSVP, invite, legal) ------------------ */
  app.use(publicRouter);

  /* API docs ------------------------------------------------------------- */
  const openApi = buildOpenApiDocument();
  app.get('/openapi.json', (_req, res) => res.json(openApi));
  app.use('/docs', swaggerUi.serve, swaggerUi.setup(openApi, { customSiteTitle: 'Birthday Gifting API' }));

  /* API ------------------------------------------------------------------ */
  app.use('/api/v1', globalLimiter, buildApiRouter());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
