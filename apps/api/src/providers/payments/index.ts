import type { PaymentProvider as PaymentProviderName } from '@prisma/client';
import { env } from '../../config/env';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { MpesaAdapter } from './mpesa';
import { SandboxAdapter } from './sandbox';
import { StripeAdapter } from './stripe';
import type { PaymentAdapter } from './types';
import { WalletAdapter } from './wallet';

/**
 * Provider registry (spec §32 — "design the payment system so it can support
 * multiple payment providers").
 *
 * Callers name a provider; nothing outside this folder knows how any of them
 * work. Adding PayPal or another mobile-money network means one new adapter
 * and one line here.
 */
const adapters = new Map<PaymentProviderName, PaymentAdapter>();

function buildAdapter(name: PaymentProviderName): PaymentAdapter {
  // The wallet is internal, so it is always real — there is nothing to sandbox.
  if (name === 'WALLET') return new WalletAdapter();

  if (env.PAYMENTS_SANDBOX) return new SandboxAdapter(name);

  switch (name) {
    case 'MPESA':
      return new MpesaAdapter();
    case 'CARD':
    case 'STRIPE':
      return new StripeAdapter();
    case 'PAYPAL':
      throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', {
        message: 'PayPal is not available yet.',
      });
    case 'MANUAL':
      throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', {
        message: 'Manual payments are recorded by an administrator, not initiated here.',
      });
    default:
      throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE');
  }
}

export function paymentAdapter(name: PaymentProviderName): PaymentAdapter {
  let adapter = adapters.get(name);
  if (!adapter) {
    adapter = buildAdapter(name);
    adapters.set(name, adapter);
    logger.info({ provider: name, sandbox: env.PAYMENTS_SANDBOX }, 'payment adapter ready');
  }
  return adapter;
}

/** Webhook routes resolve their adapter by URL segment. */
export function adapterForWebhookSlug(slug: string): PaymentAdapter {
  switch (slug) {
    case 'mpesa':
      return paymentAdapter('MPESA');
    case 'stripe':
    case 'card':
      return paymentAdapter('CARD');
    case 'sandbox':
      if (env.isProduction) throw new AppError('NOT_FOUND');
      return paymentAdapter('MPESA');
    default:
      throw new AppError('NOT_FOUND', { message: 'Unknown payment provider.' });
  }
}

/** Which providers the client should offer, given a currency. */
export function availableProviders(currency: string): PaymentProviderName[] {
  const candidates: PaymentProviderName[] = ['MPESA', 'CARD', 'WALLET'];
  return candidates.filter((name) => {
    try {
      return paymentAdapter(name).supports(currency);
    } catch {
      return false;
    }
  });
}

export type { PaymentAdapter };
export * from './types';
