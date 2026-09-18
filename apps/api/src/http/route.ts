import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { asyncHandler } from '../lib/async';
import { created, noContent, ok } from '../lib/response';
import { optionalAuth, requireAdmin, requireAuth, requireOnboarded } from '../middleware/auth';
import { validate } from '../middleware/validate';

/**
 * Route definitions.
 *
 * Each route declares its auth level and Zod schemas once. The same
 * declaration drives validation at runtime and the generated OpenAPI document,
 * so the docs cannot drift from what the server actually enforces.
 *
 * Handlers return data; the wrapper writes the standard success envelope.
 * Handlers that need to stream a file or set their own status use `raw`.
 */

export type AuthLevel = 'public' | 'optional' | 'user' | 'onboarded' | 'admin';

export interface RouteDefinition<
  B extends ZodTypeAny | undefined = undefined,
  Q extends ZodTypeAny | undefined = undefined,
  P extends ZodTypeAny | undefined = undefined,
> {
  summary: string;
  description?: string;
  auth: AuthLevel;
  body?: B;
  query?: Q;
  params?: P;
  /** 201 for creations, 204 for handlers that return nothing. */
  status?: 200 | 201 | 202 | 204;
  /** Extra middleware (rate limiters, multer) run after auth, before validation. */
  middleware?: RequestHandler[];
  /** The handler writes the response itself. */
  raw?: boolean;
}

type Infer<T> = T extends ZodTypeAny ? z.infer<T> : undefined;

export interface HandlerContext<B, Q, P> {
  req: Request;
  res: Response;
  body: B;
  query: Q;
  params: P;
  /** Present on every route whose auth level is not public/optional. */
  userId: string;
  auth: Express.AuthContext | undefined;
}

export interface RegisteredRoute {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  path: string;
  tag: string;
  definition: RouteDefinition<ZodTypeAny | undefined, ZodTypeAny | undefined, ZodTypeAny | undefined>;
}

export const routeRegistry: RegisteredRoute[] = [];

function authMiddleware(level: AuthLevel): RequestHandler[] {
  switch (level) {
    case 'public':
      return [];
    case 'optional':
      return [optionalAuth];
    case 'user':
      return [requireAuth];
    case 'onboarded':
      return [requireAuth, requireOnboarded];
    case 'admin':
      return [requireAuth, requireAdmin];
    default:
      return [requireAuth];
  }
}

export function createModule(prefix: string, tag: string) {
  const router = Router();

  function add(method: RegisteredRoute['method']) {
    return <B extends ZodTypeAny | undefined = undefined, Q extends ZodTypeAny | undefined = undefined, P extends ZodTypeAny | undefined = undefined>(
      path: string,
      definition: RouteDefinition<B, Q, P>,
      handler: (context: HandlerContext<Infer<B>, Infer<Q>, Infer<P>>) => Promise<unknown>,
    ) => {
      routeRegistry.push({
        method,
        path: `${prefix}${path}`.replace(/\/$/, '') || '/',
        tag,
        definition: definition as RegisteredRoute['definition'],
      });

      router[method](
        path,
        ...authMiddleware(definition.auth),
        ...(definition.middleware ?? []),
        validate({ body: definition.body, query: definition.query, params: definition.params }),
        asyncHandler(async (req, res) => {
          const result = await handler({
            req,
            res,
            body: req.valid?.body as Infer<B>,
            query: req.valid?.query as Infer<Q>,
            params: req.valid?.params as Infer<P>,
            userId: req.auth?.userId as string,
            auth: req.auth,
          });
          if (definition.raw || res.headersSent) return;
          if (definition.status === 204) return noContent(res);
          if (definition.status === 201) return created(res, result ?? null);
          if (definition.status === 202) res.status(202);
          return ok(res, result ?? null);
        }),
      );
    };
  }

  return {
    router,
    prefix,
    get: add('get'),
    post: add('post'),
    put: add('put'),
    patch: add('patch'),
    delete: add('delete'),
  };
}

export type ApiModule = ReturnType<typeof createModule>;
