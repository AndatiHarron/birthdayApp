import type { PaymentAction } from '@bday/shared';
import type { PaymentProvider as PaymentProviderName, PaymentStatus } from '@prisma/client';

export interface InitiatePaymentRequest {
  paymentId: string;
  reference: string;
  amountMinor: number;
  currency: string;
  description: string;
  /** E.164 phone for mobile-money prompts. */
  payerPhone?: string | null;
  payerEmail?: string | null;
  payerUserId: string;
  returnUrl?: string | null;
  metadata?: Record<string, string>;
}

export interface InitiatePaymentResult {
  /** Provider's own id for this attempt, stored for later reconciliation. */
  providerRef: string | null;
  /** What the client must do next: nothing, wait for a prompt, redirect… */
  action: PaymentAction;
  /** Providers that settle instantly (wallet) return SUCCESSFUL here. */
  status: PaymentStatus;
  raw?: unknown;
}

export interface VerifyPaymentResult {
  status: PaymentStatus;
  amountMinor: number | null;
  currency: string | null;
  providerRef: string | null;
  failureReason: string | null;
  raw: unknown;
}

/** Normalised form of an inbound provider callback. */
export interface NormalisedWebhookEvent {
  /** Provider-side event id, used to make replays a no-op. */
  externalId: string;
  /** Our payment reference or the provider ref, whichever the payload carries. */
  paymentReference: string | null;
  providerRef: string | null;
  status: PaymentStatus;
  amountMinor: number | null;
  currency: string | null;
  failureReason: string | null;
  raw: unknown;
}

export interface RefundRequest {
  paymentId: string;
  providerRef: string | null;
  amountMinor: number;
  currency: string;
  reason: string;
}

export interface RefundResult {
  providerRef: string | null;
  status: PaymentStatus;
  raw?: unknown;
}

/**
 * Payment provider contract (spec §32).
 *
 * Two rules shape this interface. First, spec §58 rule 5: a client can never
 * declare a payment successful, so the only paths to SUCCESSFUL are `verify`
 * (a provider-side status query) and `parseWebhook` (a signature-checked
 * callback). Second, every method is expected to be safe to call twice —
 * initiation is keyed by our `paymentId`, and webhook handling is deduplicated
 * on `externalId`.
 */
export interface PaymentAdapter {
  readonly name: PaymentProviderName;
  /** False when the provider cannot settle in the requested currency. */
  supports(currency: string): boolean;
  initiate(request: InitiatePaymentRequest): Promise<InitiatePaymentResult>;
  verify(payment: { id: string; reference: string; providerRef: string | null }): Promise<VerifyPaymentResult>;
  /**
   * Verifies the signature and normalises the payload. Throws
   * WEBHOOK_SIGNATURE_INVALID when authentication fails — callers must not
   * fall back to trusting the body.
   */
  parseWebhook(input: {
    headers: Record<string, string | string[] | undefined>;
    rawBody: Buffer;
  }): Promise<NormalisedWebhookEvent>;
  refund?(request: RefundRequest): Promise<RefundResult>;
}
