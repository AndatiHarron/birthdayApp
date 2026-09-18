import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentProvider as PaymentProviderName } from '@prisma/client';
import { env } from '../../config/env';
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
 * Sandbox adapter used when `PAYMENTS_SANDBOX=true`.
 *
 * It exists so the whole gifting flow — reserve, contribute, order, settle,
 * notify — is runnable end to end without provider credentials, which is what
 * the test suite exercises. It still respects spec §58 rule 5: `initiate`
 * returns PENDING and only the server-side `verify` (or a signed sandbox
 * callback) reports SUCCESSFUL. The client cannot shortcut it.
 *
 * `env` validation refuses to boot with this enabled in production.
 */
export class SandboxAdapter implements PaymentAdapter {
  readonly name: PaymentProviderName;

  constructor(name: PaymentProviderName) {
    this.name = name;
    if (env.isProduction) {
      throw new Error('SandboxAdapter must never be constructed in production');
    }
  }

  supports(): boolean {
    return true;
  }

  async initiate(request: InitiatePaymentRequest): Promise<InitiatePaymentResult> {
    logger.info(
      { provider: this.name, reference: request.reference, amountMinor: request.amountMinor },
      '[payments:sandbox] initiated',
    );

    // A distinctive amount lets tests drive the failure path deterministically:
    // any amount whose minor units end in 13 fails on verification.
    const willFail = request.amountMinor % 100 === 13;

    return {
      providerRef: `sbx_${request.paymentId}${willFail ? '_fail' : ''}`,
      status: 'PENDING',
      action:
        this.name === 'MPESA'
          ? {
              type: 'AWAIT_STK_PUSH',
              message: 'Sandbox: this payment settles automatically in a moment.',
              pollAfterSeconds: 1,
            }
          : { type: 'NONE' },
      raw: { sandbox: true },
    };
  }

  async verify(payment: {
    id: string;
    reference: string;
    providerRef: string | null;
  }): Promise<VerifyPaymentResult> {
    const failed = payment.providerRef?.endsWith('_fail') ?? false;
    return {
      status: failed ? 'FAILED' : 'SUCCESSFUL',
      amountMinor: null,
      currency: null,
      providerRef: payment.providerRef,
      failureReason: failed ? 'Sandbox: simulated decline.' : null,
      raw: { sandbox: true },
    };
  }

  /**
   * Signed sandbox callback, so the webhook code path is exercised in tests
   * rather than only in production. Signature: HMAC-SHA256 of the raw body
   * keyed on JWT_ACCESS_SECRET, sent as `x-sandbox-signature`.
   */
  async parseWebhook(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer;
  }): Promise<NormalisedWebhookEvent> {
    const header = input.headers['x-sandbox-signature'];
    const supplied = Array.isArray(header) ? header[0] : header;
    if (!supplied) throw new AppError('WEBHOOK_SIGNATURE_INVALID');

    const expected = createHmac('sha256', env.JWT_ACCESS_SECRET)
      .update(input.rawBody)
      .digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(supplied, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID');
    }

    const event = JSON.parse(input.rawBody.toString('utf8')) as {
      id?: string;
      reference?: string;
      providerRef?: string;
      status?: string;
      amountMinor?: number;
      currency?: string;
    };

    const status =
      event.status === 'SUCCESSFUL' ||
      event.status === 'FAILED' ||
      event.status === 'CANCELLED' ||
      event.status === 'REFUNDED'
        ? event.status
        : 'PENDING';

    return {
      externalId: event.id ?? `sbx_${Date.now()}`,
      paymentReference: event.reference ?? null,
      providerRef: event.providerRef ?? null,
      status,
      amountMinor: event.amountMinor ?? null,
      currency: event.currency ?? null,
      failureReason: status === 'FAILED' ? 'Sandbox: simulated decline.' : null,
      raw: event,
    };
  }

  async refund(request: RefundRequest): Promise<RefundResult> {
    logger.info({ paymentId: request.paymentId }, '[payments:sandbox] refunded');
    return { providerRef: `sbx_refund_${request.paymentId}`, status: 'REFUNDED' };
  }
}

/** Signs a sandbox webhook body — used by tests and the dev settle endpoint. */
export function signSandboxWebhook(rawBody: string): string {
  return createHmac('sha256', env.JWT_ACCESS_SECRET).update(rawBody).digest('hex');
}
