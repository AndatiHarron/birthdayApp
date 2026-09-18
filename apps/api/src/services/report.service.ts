import type { CreateReportInput } from '@bday/shared';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';

/** User reports for moderation (spec §39 "block/report"). */
export async function createReport(reporterId: string, input: CreateReportInput) {
  if (input.targetType === 'USER' && input.targetId === reporterId) {
    throw new AppError('VALIDATION_ERROR', { message: 'You cannot report yourself.' });
  }

  // One open report per reporter per target — repeated taps must not flood
  // the moderation queue.
  const existing = await prisma.report.findFirst({
    where: {
      reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      status: { in: ['OPEN', 'UNDER_REVIEW'] },
    },
    select: { id: true, createdAt: true },
  });
  if (existing) return { id: existing.id, status: 'OPEN' as const, duplicate: true };

  const report = await prisma.report.create({
    data: {
      reporterId,
      targetType: input.targetType,
      targetId: input.targetId,
      reason: input.reason,
      details: input.details ?? null,
    },
    select: { id: true, status: true },
  });
  return { ...report, duplicate: false };
}
