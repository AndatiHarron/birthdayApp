import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PaymentStatus } from '@prisma/client';
import { env } from '../../config/env';
import { withRetry, withTimeout } from '../../lib/async';
import { AppError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import type {
  InitiatePaymentRequest,
  InitiatePaymentResult,
  NormalisedWebhookEvent,
  PaymentAdapter,
  VerifyPaymentResult,
} from './types';

/**
 * Safaricom M-Pesa via the Daraja "Lipa na M-Pesa Online" (STK push) API.
 *
 * Flow: we ask Daraja to push a PIN prompt to the customer's handset and get
 * back a `CheckoutRequestID`. The customer's response arrives asynchronously on
 * our callback URL. Because that callback can be missed, `verify` also queries
 * Daraja directly — the reconciliation worker uses it to settle any payment
 * still PENDING after a few minutes.
 *
 * M-Pesa amounts are whole KES, so a request whose minor units are not a clean
 * multiple of 100 is rejected rather than silently rounded.
 */
export class MpesaAdapter implements PaymentAdapter {
  readonly name = 'MPESA' as const;

  private tokenCache: { token: string; expiresAt: number } | null = null;

  private get baseUrl(): string {
    return env.MPESA_ENV === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';
  }

  supports(currency: string): boolean {
    return currency === 'KES';
  }

  private assertConfigured(): void {
    if (
      !env.MPESA_CONSUMER_KEY ||
      !env.MPESA_CONSUMER_SECRET ||
      !env.MPESA_SHORTCODE ||
      !env.MPESA_PASSKEY ||
      // Without it every callback is refused and payments settle only via reconciliation.
      !env.MPESA_CALLBACK_SECRET
    ) {
      throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', {
        message: 'M-Pesa is not configured on this server.',
        context: { missing: 'MPESA_CONSUMER_KEY/SECRET/SHORTCODE/PASSKEY/CALLBACK_SECRET' },
      });
    }
  }

  /** OAuth token, cached until 60s before expiry. */
  private async accessToken(): Promise<string> {
    this.assertConfigured();
    if (this.tokenCache && this.tokenCache.expiresAt > Date.now()) {
      return this.tokenCache.token;
    }
    const credentials = Buffer.from(
      `${env.MPESA_CONSUMER_KEY}:${env.MPESA_CONSUMER_SECRET}`,
    ).toString('base64');

    const response = await withTimeout(
      (signal) =>
        fetch(`${this.baseUrl}/oauth/v1/generate?grant_type=client_credentials`, {
          headers: { Authorization: `Basic ${credentials}` },
          signal,
        }),
      10_000,
      'M-Pesa auth timed out',
    );
    if (!response.ok) {
      throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', {
        context: { stage: 'auth', status: response.status },
      });
    }
    const payload = (await response.json()) as { access_token?: string; expires_in?: string };
    if (!payload.access_token) {
      throw new AppError('PAYMENT_PROVIDER_UNAVAILABLE', { context: { stage: 'auth' } });
    }
    const ttlSeconds = Number(payload.expires_in ?? 3599);
    this.tokenCache = {
      token: payload.access_token,
      expiresAt: Date.now() + Math.max(30, ttlSeconds - 60) * 1000,
    };
    return payload.access_token;
  }

  private timestamp(): string {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(
      now.getHours(),
    )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  }

  private password(timestamp: string): string {
    return Buffer.from(`${env.MPESA_SHORTCODE}${env.MPESA_PASSKEY}${timestamp}`).toString('base64');
  }

  async initiate(request: InitiatePaymentRequest): Promise<InitiatePaymentResult> {
    this.assertConfigured();

    if (request.currency !== 'KES') {
      throw new AppError('CURRENCY_MISMATCH', { message: 'M-Pesa settles in KES only.' });
    }
    if (!request.payerPhone) {
      throw new AppError('VALIDATION_ERROR', {
        fieldErrors: { payerPhone: ['Enter the M-Pesa number to charge'] },
      });
    }
    if (request.amountMinor % 100 !== 0) {
      throw new AppError('VALIDATION_ERROR', {
        message: 'M-Pesa accepts whole shilling amounts only.',
      });
    }

    const timestamp = this.timestamp();
    const token = await this.accessToken();
    // Daraja wants a bare MSISDN: 254712345678, no plus sign.
    const msisdn = request.payerPhone.replace(/^\+/, '');

    const body = {
      BusinessShortCode: env.MPESA_SHORTCODE,
      Password: this.password(timestamp),
      Timestamp: timestamp,
      TransactionType: 'CustomerPayBillOnline',
      Amount: request.amountMinor / 100,
      PartyA: msisdn,
      PartyB: env.MPESA_SHORTCODE,
      PhoneNumber: msisdn,
      // Daraja cannot send custom headers, so the shared secret rides in the URL.
      CallBackURL: `${env.API_BASE_URL}/api/v1/webhooks/payments/mpesa?token=${encodeURIComponent(env.MPESA_CALLBACK_SECRET ?? '')}`,
      AccountReference: request.reference.slice(0, 12),
      TransactionDesc: request.description.slice(0, 13),
    };

    const response = await withRetry(
      () =>
        withTimeout(
          (signal) =>
            fetch(`${this.baseUrl}/mpesa/stkpush/v1/processrequest`, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(body),
              signal,
            }),
          15_000,
          'M-Pesa STK push timed out',
        ),
      // Only retry transport failures; a 4xx from Daraja will not improve.
      { retries: 1, shouldRetry: (error) => !(error instanceof AppError) },
    );

    const payload = (await response.json().catch(() => ({}))) as {
      CheckoutRequestID?: string;
      ResponseCode?: string;
      ResponseDescription?: string;
      errorMessage?: string;
    };

    if (!response.ok || payload.ResponseCode !== '0' || !payload.CheckoutRequestID) {
      logger.warn({ status: response.status, payload }, 'mpesa stk push rejected');
      throw new AppError('PAYMENT_FAILED', {
        message:
          payload.errorMessage ??
          payload.ResponseDescription ??
          'M-Pesa could not start this payment.',
      });
    }

    return {
      providerRef: payload.CheckoutRequestID,
      status: 'PENDING',
      action: {
        type: 'AWAIT_STK_PUSH',
        message: 'Enter your M-Pesa PIN on the prompt sent to your phone.',
        pollAfterSeconds: 5,
      },
      raw: payload,
    };
  }

  async verify(payment: {
    id: string;
    reference: string;
    providerRef: string | null;
  }): Promise<VerifyPaymentResult> {
    this.assertConfigured();
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

    const timestamp = this.timestamp();
    const token = await this.accessToken();

    const response = await withTimeout(
      (signal) =>
        fetch(`${this.baseUrl}/mpesa/stkpushquery/v1/query`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            BusinessShortCode: env.MPESA_SHORTCODE,
            Password: this.password(timestamp),
            Timestamp: timestamp,
            CheckoutRequestID: payment.providerRef,
          }),
          signal,
        }),
      15_000,
      'M-Pesa status query timed out',
    );

    const payload = (await response.json().catch(() => ({}))) as {
      ResultCode?: string | number;
      ResultDesc?: string;
      errorCode?: string;
    };

    // Daraja answers 500/"transaction is being processed" while the customer
    // still has the prompt open. That is PENDING, not a failure.
    if (!response.ok) {
      return {
        status: 'PENDING',
        amountMinor: null,
        currency: 'KES',
        providerRef: payment.providerRef,
        failureReason: null,
        raw: payload,
      };
    }

    const resultCode = String(payload.ResultCode ?? '');
    const status: PaymentStatus =
      resultCode === '0' ? 'SUCCESSFUL' : resultCode === '' ? 'PENDING' : mapResultCode(resultCode);

    return {
      status,
      amountMinor: null,
      currency: 'KES',
      providerRef: payment.providerRef,
      failureReason: status === 'SUCCESSFUL' ? null : (payload.ResultDesc ?? null),
      raw: payload,
    };
  }

  /**
   * Daraja does not sign its callbacks. The accepted mitigation is a secret in
   * the callback path plus source-IP allow-listing at the edge; we require the
   * shared secret as an `x-callback-token` header or `?token=` parameter and
   * compare it in constant time. Without MPESA_CALLBACK_SECRET set, callbacks
   * are refused outright rather than trusted.
   */
  async parseWebhook(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer;
    query?: Record<string, unknown>;
  }): Promise<NormalisedWebhookEvent> {
    if (!env.MPESA_CALLBACK_SECRET) {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', {
        message: 'M-Pesa callbacks are not configured.',
        context: { missing: 'MPESA_CALLBACK_SECRET' },
      });
    }
    const queryToken = input.query?.token;
    const supplied = firstHeader(input.headers['x-callback-token']) ?? (typeof queryToken === 'string' ? queryToken : null);
    if (!supplied || !safeEqual(supplied, env.MPESA_CALLBACK_SECRET)) {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID');
    }

    const parsed = JSON.parse(input.rawBody.toString('utf8')) as {
      Body?: {
        stkCallback?: {
          MerchantRequestID?: string;
          CheckoutRequestID?: string;
          ResultCode?: number | string;
          ResultDesc?: string;
          CallbackMetadata?: { Item?: Array<{ Name?: string; Value?: string | number }> };
        };
      };
    };

    const callback = parsed.Body?.stkCallback;
    if (!callback?.CheckoutRequestID) {
      throw new AppError('VALIDATION_ERROR', { message: 'Unrecognised M-Pesa callback shape.' });
    }

    const items = callback.CallbackMetadata?.Item ?? [];
    const amount = items.find((item) => item.Name === 'Amount')?.Value;
    const receipt = items.find((item) => item.Name === 'MpesaReceiptNumber')?.Value;

    const resultCode = String(callback.ResultCode ?? '');
    const status: PaymentStatus = resultCode === '0' ? 'SUCCESSFUL' : mapResultCode(resultCode);

    return {
      // Both ids together: a retried callback for the same attempt dedupes,
      // while a genuinely new attempt does not collide.
      externalId: `${callback.CheckoutRequestID}:${resultCode}`,
      paymentReference: null,
      providerRef: callback.CheckoutRequestID,
      status,
      amountMinor: typeof amount === 'number' ? Math.round(amount * 100) : null,
      currency: 'KES',
      failureReason: status === 'SUCCESSFUL' ? null : (callback.ResultDesc ?? null),
      raw: { ...parsed, receipt },
    };
  }
}

/** Daraja result codes worth distinguishing; anything else is a plain failure. */
function mapResultCode(code: string): PaymentStatus {
  switch (code) {
    case '1032': // customer cancelled the prompt
      return 'CANCELLED';
    case '1037': // no response from the handset — timed out
    case '1025':
    case '1':
    case '2001':
    default:
      return 'FAILED';
  }
}

function firstHeader(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a);
  const bufferB = Buffer.from(b);
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/** Exported for the callback-URL builder and tests. */
export function mpesaCallbackToken(): string | undefined {
  return env.MPESA_CALLBACK_SECRET;
}

export function signMpesaProbe(payload: string): string {
  return createHmac('sha256', env.MPESA_CALLBACK_SECRET ?? '').update(payload).digest('hex');
}
