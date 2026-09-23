import type { PaymentProvider } from '@prisma/client';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';

/**
 * Paying money out of a wallet (spec §33).
 *
 * Money arriving is only half of a gifting app: what people were sent has to
 * be able to leave again. Same shape as the payment providers — the service
 * names a provider and knows nothing about how it works.
 *
 * M-Pesa pays out through Daraja B2C, which needs a separate short code, an
 * initiator name and an encrypted security credential that Safaricom issues
 * per organisation. Until those exist, payouts are queued for an administrator
 * to send manually and mark complete, which is exactly how refunds already
 * work — the money is debited and reconciled either way, never silently lost.
 */

export interface PayoutRequest {
  payoutId: string;
  amountMinor: number;
  currency: string;
  /** E.164 phone number for mobile money. */
  destination: string;
  reference: string;
}

export interface PayoutResult {
  /** SETTLED when the provider paid immediately; QUEUED when a human must finish it. */
  status: 'SETTLED' | 'QUEUED';
  providerRef: string | null;
}

export interface PayoutProvider {
  readonly name: string;
  supports(currency: string): boolean;
  send(request: PayoutRequest): Promise<PayoutResult>;
}

/** Development: settles at once so the whole flow can be exercised without credentials. */
class SandboxPayoutProvider implements PayoutProvider {
  readonly name = 'sandbox';
  supports(): boolean {
    return true;
  }
  async send(request: PayoutRequest): Promise<PayoutResult> {
    if (env.isProduction) throw new Error('The sandbox payout provider must never run in production');
    logger.info({ payoutId: request.payoutId, amountMinor: request.amountMinor }, '[payouts:sandbox] settled');
    return { status: 'SETTLED', providerRef: `sbxpo_${request.payoutId}` };
  }
}

/** Real M-Pesa payouts wait for an administrator until B2C credentials are wired up. */
class ManualMpesaPayoutProvider implements PayoutProvider {
  readonly name = 'mpesa-manual';
  supports(currency: string): boolean {
    return currency === 'KES';
  }
  async send(request: PayoutRequest): Promise<PayoutResult> {
    logger.info({ payoutId: request.payoutId, destination: request.destination.slice(-4) }, 'payout queued for manual B2C transfer');
    return { status: 'QUEUED', providerRef: null };
  }
}

export function payoutProvider(provider: PaymentProvider, currency: string): PayoutProvider {
  if (provider !== 'MPESA') {
    throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', { message: 'Withdrawals go to M-Pesa for now.' });
  }
  const chosen: PayoutProvider = env.PAYMENTS_SANDBOX ? new SandboxPayoutProvider() : new ManualMpesaPayoutProvider();
  if (!chosen.supports(currency)) throw new AppError('CURRENCY_MISMATCH');
  return chosen;
}
