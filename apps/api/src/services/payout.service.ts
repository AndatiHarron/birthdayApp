import { LIMITS, type PayoutDto, type PayoutStatus } from '@bday/shared';
import { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors';
import { prisma, type Tx } from '../lib/prisma';
import { RealtimeEvent, emitToUser } from '../realtime/emitter';
import { payoutProvider } from '../providers/payouts';
import { notify } from './notification.service';

/**
 * Withdrawals (spec §33).
 *
 * The rule that shapes this file: **the wallet is debited once, when the
 * withdrawal is requested.** Every later outcome moves that same money —
 * settled, or refunded on failure — so a balance can never be spent twice by
 * asking twice, and a failed transfer never leaves someone short.
 */

type PayoutRow = {
  id: string;
  amountMinor: number;
  currency: string;
  destination: string;
  status: PayoutStatus;
  failureReason: string | null;
  requestedAt: Date;
  completedAt: Date | null;
};

function toDto(row: PayoutRow): PayoutDto {
  return {
    id: row.id,
    amountMinor: row.amountMinor,
    currency: row.currency,
    // Only the last digits, so a screenshot of the screen gives nothing away.
    destination: row.destination.replace(/.(?=.{3})/g, '•'),
    status: row.status,
    failureReason: row.failureReason,
    requestedAt: row.requestedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

async function debitWallet(tx: Tx, userId: string, amountMinor: number, description: string, idempotencyKey: string): Promise<{ walletId: string; transactionId: string; currency: string }> {
  const [wallet] = await tx.$queryRaw<Array<{ id: string; balanceMinor: number; currency: string }>>`
    SELECT id, "balanceMinor", currency FROM wallets WHERE "userId" = ${userId} FOR UPDATE
  `;
  if (!wallet) throw new AppError('INSUFFICIENT_WALLET_BALANCE');
  if (wallet.balanceMinor < amountMinor) throw new AppError('INSUFFICIENT_WALLET_BALANCE');

  const balanceAfter = wallet.balanceMinor - amountMinor;
  await tx.wallet.update({ where: { id: wallet.id }, data: { balanceMinor: balanceAfter } });
  const transaction = await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: 'DEBIT',
      reason: 'WITHDRAWAL',
      amountMinor,
      balanceAfterMinor: balanceAfter,
      currency: wallet.currency,
      description,
      referenceType: 'WALLET',
      idempotencyKey,
    },
    select: { id: true },
  });
  return { walletId: wallet.id, transactionId: transaction.id, currency: wallet.currency };
}

/** Puts the money back after a transfer fails, once and only once. */
async function refundWallet(tx: Tx, userId: string, payoutId: string, amountMinor: number, currency: string): Promise<void> {
  const [wallet] = await tx.$queryRaw<Array<{ id: string; balanceMinor: number }>>`
    SELECT id, "balanceMinor" FROM wallets WHERE "userId" = ${userId} FOR UPDATE
  `;
  if (!wallet) return;
  const balanceAfter = wallet.balanceMinor + amountMinor;
  await tx.wallet.update({ where: { id: wallet.id }, data: { balanceMinor: balanceAfter } });
  await tx.walletTransaction.create({
    data: {
      walletId: wallet.id,
      type: 'CREDIT',
      reason: 'REFUND',
      amountMinor,
      balanceAfterMinor: balanceAfter,
      currency,
      description: 'Withdrawal returned',
      referenceType: 'WALLET',
      referenceId: payoutId,
      idempotencyKey: `payout-refund:${payoutId}`,
    },
  });
}

export async function requestPayout(userId: string, input: { amountMinor: number; destination: string; idempotencyKey: string }): Promise<PayoutDto> {
  if (input.amountMinor < LIMITS.minPayoutMinor) throw new AppError('PAYOUT_TOO_SMALL');

  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { phone: true, phoneVerified: true },
  });
  // Money may only leave to a number this account has proved it controls.
  if (!user.phoneVerified || !user.phone || user.phone !== input.destination) {
    throw new AppError('PAYOUT_DESTINATION_UNVERIFIED');
  }

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const today = await prisma.payout.aggregate({
    where: { userId, requestedAt: { gte: since }, status: { notIn: ['FAILED', 'CANCELLED'] } },
    _sum: { amountMinor: true },
  });
  if ((today._sum.amountMinor ?? 0) + input.amountMinor > LIMITS.maxPayoutPerDayMinor) {
    throw new AppError('RATE_LIMITED', { message: 'That is more than can be withdrawn in a day. Try again tomorrow.' });
  }

  const payoutId = await prisma.$transaction(async (tx) => {
    const existing = await tx.walletTransaction.findUnique({
      where: { idempotencyKey: `payout:${userId}:${input.idempotencyKey}` },
      select: { id: true },
    });
    if (existing) {
      const already = await tx.payout.findFirst({ where: { walletTransactionId: existing.id }, select: { id: true } });
      if (already) return already.id;
    }

    const debit = await debitWallet(tx, userId, input.amountMinor, 'Withdrawal to M-Pesa', `payout:${userId}:${input.idempotencyKey}`);
    const payout = await tx.payout.create({
      data: {
        userId,
        amountMinor: input.amountMinor,
        currency: debit.currency,
        destination: input.destination,
        provider: 'MPESA',
        walletTransactionId: debit.transactionId,
      },
      select: { id: true },
    });
    return payout.id;
  });

  const payout = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
  if (payout.status === 'REQUESTED') {
    // Hand it to the provider outside the transaction: a slow network call must
    // not hold a row lock on the wallet.
    try {
      const result = await payoutProvider(payout.provider, payout.currency).send({
        payoutId: payout.id,
        amountMinor: payout.amountMinor,
        currency: payout.currency,
        destination: payout.destination,
        reference: `PO-${payout.id.slice(-8).toUpperCase()}`,
      });
      const updated = await prisma.payout.update({
        where: { id: payout.id },
        data:
          result.status === 'SETTLED'
            ? { status: 'PAID', providerRef: result.providerRef, completedAt: new Date() }
            : { status: 'PROCESSING', providerRef: result.providerRef },
      });
      if (updated.status === 'PAID') await notifyPaid(userId, updated.amountMinor, updated.currency);
      return toDto(updated);
    } catch (error) {
      await failPayout(payout.id, error instanceof AppError ? error.message : 'The transfer could not be started.');
      throw error;
    }
  }
  return toDto(payout);
}

async function notifyPaid(userId: string, amountMinor: number, currency: string): Promise<void> {
  await notify({
    userId,
    type: 'PAYMENT_UPDATE',
    title: 'Money sent',
    body: `${currency} ${(amountMinor / 100).toLocaleString()} is on its way to your phone.`,
    deepLink: 'wallet',
  }).catch(() => undefined);
  emitToUser(userId, RealtimeEvent.PAYMENT_UPDATED, { kind: 'PAYOUT' });
}

export async function listMyPayouts(userId: string, limit = 20): Promise<PayoutDto[]> {
  const rows = await prisma.payout.findMany({ where: { userId }, orderBy: { requestedAt: 'desc' }, take: limit });
  return rows.map(toDto);
}

/* -------------------------------- admin -------------------------------- */

export async function listPayouts(status?: PayoutStatus, limit = 50): Promise<Array<PayoutDto & { user: { id: string; displayName: string }; destinationFull: string }>> {
  const rows = await prisma.payout.findMany({
    where: status ? { status } : {},
    orderBy: { requestedAt: 'asc' },
    take: limit,
    include: { user: { select: { id: true, username: true, profile: { select: { displayName: true } } } } },
  });
  return rows.map((row) => ({
    ...toDto(row),
    // An administrator about to send the money needs the whole number.
    destinationFull: row.destination,
    user: { id: row.user.id, displayName: row.user.profile?.displayName ?? row.user.username },
  }));
}

/** An administrator confirms they sent the transfer. */
export async function completePayout(payoutId: string, adminId: string, providerRef?: string): Promise<PayoutDto> {
  const payout = await prisma.payout.findUniqueOrThrow({ where: { id: payoutId } });
  if (payout.status === 'PAID') return toDto(payout);
  if (payout.status !== 'REQUESTED' && payout.status !== 'PROCESSING') throw new AppError('PAYOUT_NOT_PENDING');

  const updated = await prisma.payout.update({
    where: { id: payoutId },
    data: { status: 'PAID', completedAt: new Date(), processedById: adminId, providerRef: providerRef ?? payout.providerRef },
  });
  await notifyPaid(updated.userId, updated.amountMinor, updated.currency);
  return toDto(updated);
}

/** The transfer did not happen: the money goes back to the wallet. */
export async function failPayout(payoutId: string, reason: string, adminId?: string): Promise<PayoutDto> {
  const updated = await prisma.$transaction(async (tx) => {
    const payout = await tx.payout.findUniqueOrThrow({ where: { id: payoutId } });
    if (payout.status === 'FAILED' || payout.status === 'CANCELLED') return payout;
    if (payout.status === 'PAID') throw new AppError('PAYOUT_NOT_PENDING');

    await refundWallet(tx, payout.userId, payout.id, payout.amountMinor, payout.currency).catch((error: unknown) => {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
    });
    return tx.payout.update({
      where: { id: payoutId },
      data: { status: 'FAILED', failureReason: reason, completedAt: new Date(), processedById: adminId ?? null },
    });
  });

  await notify({
    userId: updated.userId,
    type: 'PAYMENT_UPDATE',
    title: 'Withdrawal returned',
    body: `${updated.currency} ${(updated.amountMinor / 100).toLocaleString()} is back in your wallet. ${reason}`,
    deepLink: 'wallet',
  }).catch(() => undefined);
  return toDto(updated);
}
