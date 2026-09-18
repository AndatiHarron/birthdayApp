# Payments

## Design

All payment code lives behind one interface, `PaymentAdapter` ([`apps/api/src/providers/payments/types.ts`](../apps/api/src/providers/payments/types.ts)). Nothing outside that folder knows how any provider works. Adding a provider (for example PayPal or Airtel Money) means writing one adapter file and adding one line to [`providers/payments/index.ts`](../apps/api/src/providers/payments/index.ts).

| Provider | Adapter | Status |
|---|---|---|
| M-Pesa (STK push) | `mpesa.ts` | Implemented (Daraja API) |
| Card | `stripe.ts` | Implemented (Stripe PaymentIntents, no card data touches our servers) |
| Wallet | `wallet.ts` | Implemented (internal ledger) |
| Sandbox | `sandbox.ts` | Development and tests only |
| PayPal | | Planned. Returns `PAYMENT_PROVIDER_UNAVAILABLE` |

### The rule: only the provider can mark a payment paid

A payment becomes `SUCCESSFUL` in exactly two ways, and both go through the same idempotent settlement step:

1. **A signature-checked webhook** from the provider.
2. **A server-side `verify`** that asks the provider directly. The app calls `POST /payments/:id/verify` after the customer finishes, and the `payment-reconciliation` job does the same for anything still pending.

Nothing the client sends can change a payment's status. A payment that is already settled can't be settled again, and webhook replays are ignored by provider event ID.

**Statuses:** `PENDING` → `SUCCESSFUL` | `FAILED` | `CANCELLED`, then `REFUNDED` through the refund flow.

**What gets paid for:** orders, group-gift contributions, digital gifts, wallet top-ups and premium subscriptions. Each payment is linked to what it pays for, so every contribution has a transaction record.

## Sandbox mode (development)

With `PAYMENTS_SANDBOX=true`, every provider except the wallet uses the sandbox adapter:

- `initiate` returns `PENDING`, like a real provider. M-Pesa shows the "check your phone" step.
- `verify` settles the payment as `SUCCESSFUL`.
- **To test a failure,** use an amount whose minor units end in `13` (for example 100013 = KES 1,000.13). It fails on verify.
- `POST /api/v1/webhooks/payments/sandbox` accepts callbacks signed with HMAC-SHA256 of the raw body, keyed on `JWT_ACCESS_SECRET` and sent as `x-sandbox-signature`, so the webhook path is tested too.

The API **refuses to start** in production with sandbox mode on.

## M-Pesa (Daraja)

1. Create an app at https://developer.safaricom.co.ke and enable **Lipa Na M-Pesa Online**.
2. Set these values:
   ```env
   PAYMENTS_SANDBOX=false
   MPESA_ENV=sandbox            # production once Safaricom approves go-live
   MPESA_CONSUMER_KEY=...
   MPESA_CONSUMER_SECRET=...
   MPESA_SHORTCODE=174379       # sandbox test shortcode; your paybill or till in production
   MPESA_PASSKEY=...
   MPESA_CALLBACK_SECRET=<long random string>
   API_BASE_URL=https://api.yourdomain.com
   ```
3. Daraja calls `{API_BASE_URL}/api/v1/webhooks/payments/mpesa?token={MPESA_CALLBACK_SECRET}`. Daraja doesn't sign its callbacks, so this secret in the URL is what authenticates them. The server compares it in constant time and masks it in logs. **`API_BASE_URL` must be public HTTPS.** For local testing, expose the API with a tunnel such as ngrok or cloudflared.
4. For extra protection, allow only [Safaricom's callback IP ranges](https://developer.safaricom.co.ke) at your load balancer.

Notes:
- M-Pesa charges whole shillings only, so amounts with cents are rejected, not rounded.
- Payer phone numbers are E.164 (`+2547…`).
- If a callback is missed, the reconciliation job asks Daraja for the status and settles the payment anyway.

## Stripe (cards)

1. Get keys from https://dashboard.stripe.com/apikeys.
2. Add a webhook endpoint at `https://api.yourdomain.com/api/v1/webhooks/payments/stripe` for the `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled` and `charge.refunded` events.
3. Set these values:
   ```env
   PAYMENTS_SANDBOX=false
   STRIPE_SECRET_KEY=sk_live_...
   STRIPE_PUBLISHABLE_KEY=pk_live_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```
4. Local testing: `stripe listen --forward-to localhost:4000/api/v1/webhooks/payments/stripe`.

The server creates a PaymentIntent and returns its `client_secret`, and the client confirms it with Stripe's own SDK. Card numbers never reach this server (spec §32). Signatures are checked against `Stripe-Signature`, and old timestamps are rejected.

## Refunds

Admins start refunds from **Orders → Refund** in the dashboard. Providers that support automatic refunds (Stripe, wallet) are refunded directly. M-Pesa refunds need a manual B2C transfer: the refund stays `PENDING` until an admin marks it complete (**Payments → Reconciliation**).

## Reconciliation

Under **Payments → Reconciliation**, the admin dashboard lists payments stuck in pending, failed webhooks and pending refunds.

## Commission

Each vendor has a commission rate (`Vendor.commissionBps`, default 1000 = 10%) that admins can change under **Vendors**. Commission is **not yet deducted from orders or paid out to vendors**, and there's no vendor payout flow yet. The `PLATFORM_COMMISSION_BPS` environment variable is read at startup but isn't used anywhere yet.
