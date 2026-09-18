/**
 * M-Pesa callback wiring (spec §32, §58 rule 5). Daraja cannot send custom
 * headers, so the shared secret must travel in the callback URL, and that URL
 * must point at the route the webhook router is actually mounted on.
 */
vi.hoisted(() => {
  process.env.API_BASE_URL = 'https://api.example.test';
  process.env.MPESA_CONSUMER_KEY = 'key';
  process.env.MPESA_CONSUMER_SECRET = 'secret';
  process.env.MPESA_SHORTCODE = '174379';
  process.env.MPESA_PASSKEY = 'passkey';
  process.env.MPESA_CALLBACK_SECRET = 'cb-secret-123';
});

import { redactUrl } from '../../src/lib/logger';
import { MpesaAdapter } from '../../src/providers/payments/mpesa';

const callbackBody = Buffer.from(
  JSON.stringify({
    Body: {
      stkCallback: {
        MerchantRequestID: 'm-1',
        CheckoutRequestID: 'ws_CO_1',
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: { Item: [{ Name: 'Amount', Value: 500 }, { Name: 'MpesaReceiptNumber', Value: 'QK123' }] },
      },
    },
  }),
);

describe('M-Pesa callbacks', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sends Daraja a callback URL on the mounted webhook route, carrying the secret', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'tok', expires_in: '3599' })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ResponseCode: '0', CheckoutRequestID: 'ws_CO_1' })));
    vi.stubGlobal('fetch', fetchMock);

    await new MpesaAdapter().initiate({
      paymentId: 'pay_1',
      reference: 'BDAY-REF-0001',
      amountMinor: 50_000,
      currency: 'KES',
      description: 'Birthday gift',
      payerPhone: '+254712345678',
      payerUserId: 'user_1',
    });

    const sent = JSON.parse(fetchMock.mock.calls[1]![1].body as string) as { CallBackURL: string };
    const url = new URL(sent.CallBackURL);
    expect(url.pathname).toBe('/api/v1/webhooks/payments/mpesa');
    expect(url.searchParams.get('token')).toBe('cb-secret-123');
  });

  it('accepts the secret from the query string, as Daraja delivers it', async () => {
    const event = await new MpesaAdapter().parseWebhook({ headers: {}, rawBody: callbackBody, query: { token: 'cb-secret-123' } });
    expect(event.status).toBe('SUCCESSFUL');
    expect(event.providerRef).toBe('ws_CO_1');
  });

  it('still accepts the secret as a header', async () => {
    const event = await new MpesaAdapter().parseWebhook({ headers: { 'x-callback-token': 'cb-secret-123' }, rawBody: callbackBody });
    expect(event.status).toBe('SUCCESSFUL');
  });

  it('rejects a missing or wrong secret', async () => {
    await expect(new MpesaAdapter().parseWebhook({ headers: {}, rawBody: callbackBody })).rejects.toMatchObject({ code: 'WEBHOOK_SIGNATURE_INVALID' });
    await expect(new MpesaAdapter().parseWebhook({ headers: {}, rawBody: callbackBody, query: { token: 'guess' } })).rejects.toMatchObject({
      code: 'WEBHOOK_SIGNATURE_INVALID',
    });
  });

  it('keeps the secret out of logged URLs', () => {
    expect(redactUrl('/api/v1/webhooks/payments/mpesa?token=cb-secret-123')).toBe('/api/v1/webhooks/payments/mpesa?token=[redacted]');
    expect(redactUrl('/x?a=1&token=s&b=2')).toBe('/x?a=1&token=[redacted]&b=2');
  });
});
