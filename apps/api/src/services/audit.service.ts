import type { Prisma, UserRole } from '@prisma/client';
import type { Request } from 'express';
import { logger } from '../lib/logger';
import { prisma, type Db } from '../lib/prisma';

/**
 * Audit trail (spec §38).
 *
 * Written for every privileged or money-moving action. An audit write must
 * never be the reason a legitimate admin action fails, so errors are logged and
 * swallowed — but the attempt is always made inside the same request.
 */

export interface AuditInput {
  actorId: string | null;
  actorRole?: UserRole | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  db?: Db;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  const db = input.db ?? prisma;
  try {
    await db.auditLog.create({
      data: {
        actorId: input.actorId,
        actorRole: input.actorRole ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        before: input.before === undefined ? undefined : (input.before as Prisma.InputJsonValue),
        after: input.after === undefined ? undefined : (input.after as Prisma.InputJsonValue),
        reason: input.reason ?? null,
        ip: input.ip ?? null,
        userAgent: input.userAgent?.slice(0, 256) ?? null,
      },
    });
  } catch (error) {
    logger.error({ err: error, action: input.action }, 'audit log write failed');
  }
}

/** Pulls actor and client details off a request. */
export function auditContext(req: Request) {
  return {
    actorId: req.auth?.userId ?? null,
    actorRole: req.auth?.role ?? null,
    ip: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

export async function listAuditLogs(options: {
  limit: number;
  cursor?: string | null;
  action?: string;
  actorId?: string;
  targetId?: string;
}) {
  const rows = await prisma.auditLog.findMany({
    where: {
      ...(options.action ? { action: options.action } : {}),
      ...(options.actorId ? { actorId: options.actorId } : {}),
      ...(options.targetId ? { targetId: options.targetId } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    include: {
      actor: { select: { id: true, username: true, profile: { select: { displayName: true } } } },
    },
  });
  const hasMore = rows.length > options.limit;
  const items = hasMore ? rows.slice(0, options.limit) : rows;
  return {
    items: items.map((row) => ({
      id: row.id,
      action: row.action,
      actor: row.actor
        ? { id: row.actor.id, displayName: row.actor.profile?.displayName ?? row.actor.username }
        : null,
      actorRole: row.actorRole,
      targetType: row.targetType,
      targetId: row.targetId,
      reason: row.reason,
      before: row.before,
      after: row.after,
      ip: row.ip,
      createdAt: row.createdAt.toISOString(),
    })),
    nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
  };
}
