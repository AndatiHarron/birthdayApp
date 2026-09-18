import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * Express 4 does not catch rejected promises from handlers, so an unhandled
 * async throw would hang the request instead of reaching the error middleware.
 * Every route handler is wrapped in this.
 */
export function asyncHandler<
  Req extends Request = Request,
  Res extends Response = Response,
>(handler: (req: Req, res: Res, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(handler(req as Req, res as Res, next)).catch(next);
  };
}

/** Fire-and-forget work that must never fail a request (push sends, analytics). */
export function fireAndForget(
  promise: Promise<unknown>,
  onError: (error: unknown) => void,
): void {
  void promise.catch(onError);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retry with exponential backoff and jitter, for outbound provider calls. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  {
    retries = 2,
    baseDelayMs = 200,
    shouldRetry = () => true,
  }: { retries?: number; baseDelayMs?: number; shouldRetry?: (error: unknown) => boolean } = {},
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === retries || !shouldRetry(error)) break;
      const jitter = Math.random() * baseDelayMs;
      await sleep(baseDelayMs * 2 ** attempt + jitter);
    }
  }
  throw lastError;
}

/** Abort an outbound call that hangs, so one slow provider cannot pin a worker. */
export async function withTimeout<T>(
  promise: (signal: AbortSignal) => Promise<T>,
  ms: number,
  message = 'Operation timed out',
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(message)), ms);
  try {
    return await promise(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
