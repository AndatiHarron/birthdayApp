import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const SAFE_ID = /^[A-Za-z0-9._-]{8,128}$/;

/**
 * Assigns a correlation id to every request.
 *
 * An inbound `x-request-id` is honoured so a trace can span the mobile client,
 * this API and a payment provider callback — but only after validation, since
 * the value ends up in log lines and a response header.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header('x-request-id');
  req.id = inbound && SAFE_ID.test(inbound) ? inbound : randomUUID();
  res.setHeader('x-request-id', req.id);
  next();
}
