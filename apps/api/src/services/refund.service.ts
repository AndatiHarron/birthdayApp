import type { Refund } from '@prisma/client';
import { AppError } from '../lib/errors';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { paymentAdapter } from '../providers/payments';
import { RealtimeEvent, emitToUser } from '../realtime/emitter';
import { notify } from './notification.service';

/**
 * Refunds (spec §32, §40).
 *
 * A refund is recorded before the provider is called, so a crash between the
 * two leaves a PENDING row an administrator can see and finish rather than
 * money that moved with no trace. Providers without a refund API (M-Pesa
 * reversals need a manual B2C step) leave the row PENDING on purpose.
 */

export async function refundPayment(input: {
  paymentId: string;
  amountMinor?: number;
  reason: string;
  issuedById: string | null;
  orderId?: string | null;
}): Promise<Refund> {
  const payment = await prisma.payment.findUnique({
    where: { id: input.paymentId },
    include: { refunds: { where: { status: { in: ['PENDING', 'REFUNDED'] } } } },
  });
  if (!payment) throw new AppError('NOT_FOUND', { message: 'That payment could not be found.' });
  if (payment.status !== 'SUCCESSFUL') {
    throw new AppError('CONFLICT', { message: 'Only successful payments can be refunded.' });
  }

  const alreadyRefunded = payment.refunds.reduce((sum, refund) => sum + refund.amountMinor, 0);
  const remaining = payment.amountMinor - alreadyRefunded;
  const amountMinor = input.amountMinor ?? remaining;
  if (amountMinor <= 0 || amountMinor > remaining) {
    throw new AppError('VALIDATION_ERROR', {
      message: `You can refund at most ${remaining} minor units on this payment.`,
    });
  }

  const refund = await prisma.refund.create({
    data: {
      paymentId: payment.id,
      orderId: input.orderId ?? payment.orderId ?? null,
      amountMinor,
      currency: payment.currency,
      reason: input.reason,
      issuedById: input.issuedById,
      status: 'PENDING',
    },
  });

  const adapter = paymentAdapter(payment.provider);
  if (!adapter.refund) {
    logger.warn({ paymentId: payment.id, provider: payment.provider }, 'provider has no refund API — manual refund required');
    return refund;
  }

  try {
    const result = await adapter.refund({
      paymentId: payment.id,
      providerRef: payment.providerRef,
      amountMinor,
      currency: payment.currency,
      reason: input.reason,
    });

    const completed = await prisma.$transaction(async (tx) => {
      const updated = await tx.refund.update({
        where: { id: refund.id },
        data: {
          status: result.status,
          providerRef: result.providerRef,
          completedAt: result.status === 'REFUNDED' ? new Date() : null,
        },
      });
      if (result.status === 'REFUNDED' && alreadyRefunded + amountMinor >= payment.amountMinor) {
        await tx.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED' } });
      }
      return updated;
    });

    if (completed.status === 'REFUNDED') {
      emitToUser(payment.userId, RealtimeEvent.PAYMENT_UPDATED, { paymentId: payment.id, status: 'REFUNDED' });
      await notify({
        userId: payment.userId,
        type: 'PAYMENT_UPDATE',
        title: 'Refund issued',
        body: 'Your refund has been processed.',
        deepLink: 'payments',
        data: { paymentId: payment.id, refundId: completed.id },
      }).catch(() => undefined);
    }
    return completed;
  } catch (error) {
    await prisma.refund.update({ where: { id: refund.id }, data: { status: 'FAILED' } });
    throw error instanceof AppError ? error : new AppError('PAYMENT_FAILED', { message: 'The refund could not be processed.', cause: error });
  }
}
