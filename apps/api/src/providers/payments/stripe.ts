import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentStatus } from '@prisma/client';
import { env } from '../../config/env';
import { withTimeout } from '../../lib/async';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
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
 * Card payments via Stripe PaymentIntents.
 *
 * Called over the REST API directly rather than through the `stripe` SDK to
 * keep the dependency surface small — the three endpoints used here are stable
 * and the webhook signature scheme is documented and simple to implement.
 *
 * No card data ever reaches this server (spec §32): the client confirms the
 * intent with the returned `client_secret` using Stripe's own SDK, and we only
 * ever see the intent's status.
 */
export class StripeAdapter implements PaymentAdapter {
  readonly name = 'CARD' as const;
  private readonly base = 'https://api.stripe.com/v1';

  supports(): boolean {
    return true;
  }

  private assertConfigured(): void {
    if (!env.STRIPE_SECRET_KEY) {
      throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', {
        message: 'Card payments are not configured on this server.',
        context: { missing: 'STRIPE_SECRET_KEY' },
      });
    }
  }

  private async call<T>(
    path: string,
    init: { method: 'GET' | 'POST'; form?: Record<string, string>; idempotencyKey?: string },
  ): Promise<T> {
    this.assertConfigured();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey;

    const response = await withTimeout(
      (signal) =>
        fetch(`${this.base}${path}`, {
          method: init.method,
          headers,
          body: init.form ? new URLSearchParams(init.form).toString() : undefined,
          signal,
        }),
      15_000,
      'Stripe request timed out',
    );

    const payload = (await response.json().catch(() => ({}))) as {
      error?: { message?: string; code?: string };
    };

    if (!response.ok) {
      logger.warn({ status: response.status, error: payload.error, path }, 'stripe call failed');
      throw new AppError('PAYMENT_FAILED', {
        message: payload.error?.message ?? 'The card payment could not be started.',
      });
    }
    return payload as T;
  }

  async initiate(request: InitiatePaymentRequest): Promise<InitiatePaymentResult> {
    const intent = await this.call<{ id: string; client_secret: string; status: string }>(
      '/payment_intents',
      {
        method: 'POST',
        // Our payment id as the key: a retried initiate reuses the same intent
        // rather than creating a second one the customer could also pay.
        idempotencyKey: request.paymentId,
        form: {
          amount: String(request.amountMinor),
          currency: request.currency.toLowerCase(),
          description: request.description,
          'automatic_payment_methods[enabled]': 'true',
          'metadata[paymentId]': request.paymentId,
          'metadata[reference]': request.reference,
          'metadata[userId]': request.payerUserId,
          ...(request.payerEmail ? { receipt_email: request.payerEmail } : {}),
        },
      },
    );

    return {
      providerRef: intent.id,
      status: 'PENDING',
      action: {
        type: 'CLIENT_SECRET',
        clientSecret: intent.client_secret,
        publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? '',
      },
      raw: { id: intent.id, status: intent.status },
    };
  }

  async verify(payment: {
    id: string;
    reference: string;
    providerRef: string | null;
  }): Promise<VerifyPaymentResult> {
    if (!payment.providerRef) {
      return {
        status: 'PENDING',
        amountMinor: null,
        currency: null,
        providerRef: null,
        failureReason: null,
        raw: null,
      };
    }
    const intent = await this.call<{
      id: string;
      status: string;
      amount: number;
      currency: string;
      last_payment_error?: { message?: string };
    }>(`/payment_intents/${encodeURIComponent(payment.providerRef)}`, { method: 'GET' });

    return {
      status: mapIntentStatus(intent.status),
      amountMinor: intent.amount ?? null,
      currency: intent.currency?.toUpperCase() ?? null,
      providerRef: intent.id,
      failureReason: intent.last_payment_error?.message ?? null,
      raw: intent,
    };
  }

  /**
   * Verifies the `Stripe-Signature` header: `t=<timestamp>,v1=<hmac>` where the
   * HMAC covers `<timestamp>.<raw body>`. The timestamp check is what prevents
   * a captured-and-replayed callback from being accepted indefinitely, so the
   * raw body must be preserved by the route (see `rawBodySaver`).
   */
  async parseWebhook(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer;
  }): Promise<NormalisedWebhookEvent> {
    if (!env.STRIPE_WEBHOOK_SECRET) {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', {
        message: 'Stripe webhooks are not configured.',
        context: { missing: 'STRIPE_WEBHOOK_SECRET' },
      });
    }
    const header = Array.isArray(input.headers['stripe-signature'])
      ? input.headers['stripe-signature'][0]
      : input.headers['stripe-signature'];
    if (!header) throw new AppError('WEBHOOK_SIGNATURE_INVALID');

    const parts = new Map(
      header.split(',').map((piece) => {
        const [key = '', value = ''] = piece.split('=');
        return [key.trim(), value.trim()] as const;
      }),
    );
    const timestamp = parts.get('t');
    const signature = parts.get('v1');
    if (!timestamp || !signature) throw new AppError('WEBHOOK_SIGNATURE_INVALID');

    const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(ageSeconds) || ageSeconds > 300) {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', { message: 'That callback has expired.' });
    }

    const expected = createHmac('sha256', env.STRIPE_WEBHOOK_SECRET)
      .update(`${timestamp}.${input.rawBody.toString('utf8')}`)
      .digest('hex');

    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(signature, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID');
    }

    const event = JSON.parse(input.rawBody.toString('utf8')) as {
      id: string;
      type: string;
      data?: {
        object?: {
          id?: string;
          amount?: number;
          currency?: string;
          status?: string;
          metadata?: Record<string, string>;
          last_payment_error?: { message?: string };
        };
      };
    };

    const object = event.data?.object ?? {};
    const status = mapEventType(event.type, object.status);

    return {
      externalId: event.id,
      paymentReference: object.metadata?.reference ?? null,
      providerRef: object.id ?? null,
      status,
      amountMinor: object.amount ?? null,
      currency: object.currency?.toUpperCase() ?? null,
      failureReason: object.last_payment_error?.message ?? null,
      raw: event,
    };
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    if (!request.providerRef) {
      throw new AppError('PAYMENT_FAILED', { message: 'That payment cannot be refunded.' });
    }
    const refund = await this.call<{ id: string; status: string }>('/refunds', {
      method: 'POST',
      idempotencyKey: `refund:${request.paymentId}:${request.amountMinor}`,
      form: {
        payment_intent: request.providerRef,
        amount: String(request.amountMinor),
        'metadata[reason]': request.reason.slice(0, 200),
      },
    });
    return {
      providerRef: refund.id,
      status: refund.status === 'succeeded' ? 'REFUNDED' : 'PENDING',
      raw: refund,
    };
  }
}

function mapIntentStatus(status: string): PaymentStatus {
  switch (status) {
    case 'succeeded':
      return 'SUCCESSFUL';
    case 'canceled':
      return 'CANCELLED';
    case 'requires_payment_method':
    case 'requires_action':
    case 'requires_confirmation':
    case 'processing':
      return 'PENDING';
    default:
      return 'FAILED';
  }
}

function mapEventType(type: string, objectStatus?: string): PaymentStatus {
  switch (type) {
    case 'payment_intent.succeeded':
      return 'SUCCESSFUL';
    case 'payment_intent.payment_failed':
      return 'FAILED';
    case 'payment_intent.canceled':
      return 'CANCELLED';
    case 'charge.refunded':
      return 'REFUNDED';
    default:
      return objectStatus ? mapIntentStatus(objectStatus) : 'PENDING';
  }
}
