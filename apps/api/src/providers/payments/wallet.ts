import { Prisma } from '@prisma/client';
import { AppError } from '../../lib/errors';
import { prisma } from '../../lib/prisma';
import type {
  InitiatePaymentRequest,
  InitiatePaymentResult,
  NormalisedWebhookEvent,
  PaymentAdapter,
  RefundRequest,
  RefundResult,
  VerifyPaymentResult,
} from './types';

/**
 * Internal wallet (spec §33).
 *
 * Settles synchronously by debiting the payer's balance. The debit and its
 * ledger row are written in one serializable transaction with the balance read
 * locked, so two concurrent spends cannot both pass the sufficient-funds check
 * and overdraw the wallet.
 *
 * `idempotencyKey` on the ledger row is the payment id, which makes a retried
 * initiate a no-op rather than a second debit.
 */
export class WalletAdapter implements PaymentAdapter {
  readonly name = 'WALLET' as const;

  supports(): boolean {
    return true;
  }

  async initiate(request: InitiatePaymentRequest): Promise<InitiatePaymentResult> {
    const result = await prisma.$transaction(
      async (tx) => {
        const existing = await tx.walletTransaction.findUnique({
          where: { idempotencyKey: `payment:${request.paymentId}` },
        });
        if (existing) return { alreadyApplied: true as const };

        const [wallet] = await tx.$queryRaw<Array<{ id: string; balanceMinor: number; currency: string }>>`
          SELECT id, "balanceMinor", currency
          FROM wallets
          WHERE "userId" = ${request.payerUserId}
          FOR UPDATE
        `;

        if (!wallet) {
          throw new AppError('INSUFFICIENT_WALLET_BALANCE', {
            message: 'You do not have a wallet yet.',
          });
        }
        if (wallet.currency !== request.currency) {
          throw new AppError('CURRENCY_MISMATCH', {
            message: `Your wallet holds ${wallet.currency}.`,
          });
        }
        if (wallet.balanceMinor < request.amountMinor) {
          throw new AppError('INSUFFICIENT_WALLET_BALANCE');
        }

        const balanceAfter = wallet.balanceMinor - request.amountMinor;

        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balanceMinor: balanceAfter },
        });

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: 'DEBIT',
            reason: 'GIFT_SENT',
            amountMinor: request.amountMinor,
            balanceAfterMinor: balanceAfter,
            currency: request.currency,
            description: request.description,
            referenceType: 'PAYMENT',
            referenceId: request.paymentId,
            paymentId: request.paymentId,
            idempotencyKey: `payment:${request.paymentId}`,
          },
        });

        return { alreadyApplied: false as const, balanceAfter };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return {
      providerRef: `wallet:${request.paymentId}`,
      status: 'SUCCESSFUL',
      action: { type: 'NONE' },
      raw: result,
    };
  }

  async verify(payment: { id: string; providerRef: string | null }): Promise<VerifyPaymentResult> {
    // The ledger is the source of truth: a matching debit row means settled.
    const txn = await prisma.walletTransaction.findUnique({
      where: { idempotencyKey: `payment:${payment.id}` },
    });
    return {
      status: txn ? 'SUCCESSFUL' : 'FAILED',
      amountMinor: txn?.amountMinor ?? null,
      currency: txn?.currency ?? null,
      providerRef: payment.providerRef,
      failureReason: txn ? null : 'No wallet debit was recorded for this payment.',
      raw: txn,
    };
  }

  async parseWebhook(): Promise<NormalisedWebhookEvent> {
    // Nothing external ever calls back for a wallet payment.
    throw new AppError('NOT_FOUND', { message: 'The wallet provider has no webhook.' });
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    await prisma.$transaction(
      async (tx) => {
        const existing = await tx.walletTransaction.findUnique({
          where: { idempotencyKey: `refund:${request.paymentId}` },
        });
        if (existing) return;

        const payment = await tx.payment.findUnique({
          where: { id: request.paymentId },
          select: { userId: true },
        });
        if (!payment) throw new AppError('NOT_FOUND', { message: 'That payment no longer exists.' });

        const [wallet] = await tx.$queryRaw<Array<{ id: string; balanceMinor: number }>>`
          SELECT id, "balanceMinor" FROM wallets WHERE "userId" = ${payment.userId} FOR UPDATE
        `;
        if (!wallet) throw new AppError('NOT_FOUND', { message: 'That wallet no longer exists.' });

        const balanceAfter = wallet.balanceMinor + request.amountMinor;
        await tx.wallet.update({ where: { id: wallet.id }, data: { balanceMinor: balanceAfter } });
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: 'CREDIT',
            reason: 'REFUND',
            amountMinor: request.amountMinor,
            balanceAfterMinor: balanceAfter,
            currency: request.currency,
            description: request.reason,
            referenceType: 'PAYMENT',
            referenceId: request.paymentId,
            idempotencyKey: `refund:${request.paymentId}`,
          },
        });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return { providerRef: `wallet-refund:${request.paymentId}`, status: 'REFUNDED' };
  }
}
