import { prisma } from '../../src/lib/prisma';
import { signSandboxWebhook } from '../../src/providers/payments/sandbox';
import { api, authHeader, describeDb, idempotencyKey, makeFriends, registerUser, type TestUser } from '../setup/helpers';

describeDb('group gifting and payments (spec §15, §58 rules 4–5)', () => {
  let sarah: TestUser;
  let john: TestUser;
  let mary: TestUser;
  let giftId: string;

  beforeAll(async () => {
    [sarah, john, mary] = await Promise.all([
      registerUser({ displayName: 'Sarah' }),
      registerUser({ displayName: 'John' }),
      registerUser({ displayName: 'Mary' }),
    ]);
    await makeFriends(sarah, john);
    await makeFriends(sarah, mary);
    await makeFriends(john, mary);

    const created = await api()
      .post('/api/v1/gifts/group')
      .set(authHeader(john))
      .send({
        title: 'MacBook Pro',
        targetMinor: 25_000_000,
        currency: 'KES',
        beneficiaryUserId: sarah.id,
        inviteUserIds: [mary.id],
        createSurpriseGroup: true,
      })
      .expect(201);
    giftId = created.body.data.id;
  });

  it('refuses to invite the birthday person into their own surprise', async () => {
    const response = await api().post(`/api/v1/gifts/group/${giftId}/invite`).set(authHeader(john)).send({ userIds: [sarah.id] });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('BIRTHDAY_PERSON_EXCLUDED');
  });

  it('keeps the contribution pending until the provider confirms', async () => {
    const contribution = await api()
      .post(`/api/v1/gifts/group/${giftId}/contribute`)
      .set(authHeader(mary))
      .send({ amountMinor: 2_500_000, currency: 'KES', provider: 'MPESA', payerPhone: '+254712345678', idempotencyKey: idempotencyKey() })
      .expect(201);

    expect(contribution.body.data.payment.status).toBe('PENDING');
    const before = await api().get(`/api/v1/gifts/group/${giftId}`).set(authHeader(john)).expect(200);
    expect(before.body.data.raisedMinor).toBe(0);

    // The server asks the (sandbox) provider; only that can settle it.
    const verified = await api().post(`/api/v1/payments/${contribution.body.data.payment.id}/verify`).set(authHeader(mary)).expect(200);
    expect(verified.body.data.status).toBe('SUCCESSFUL');

    const after = await api().get(`/api/v1/gifts/group/${giftId}`).set(authHeader(john)).expect(200);
    expect(after.body.data.raisedMinor).toBe(2_500_000);
    expect(after.body.data.percentFunded).toBe(10);
  });

  it('does not double-charge a retried request with the same idempotency key', async () => {
    const key = idempotencyKey();
    const body = { amountMinor: 1_000_000, currency: 'KES', provider: 'MPESA', payerPhone: '+254712345678', idempotencyKey: key };
    const first = await api().post(`/api/v1/gifts/group/${giftId}/contribute`).set(authHeader(john)).send(body).expect(201);
    const retry = await api().post(`/api/v1/gifts/group/${giftId}/contribute`).set(authHeader(john)).send(body);
    expect([200, 201]).toContain(retry.status);
    expect(retry.body.data.payment.id).toBe(first.body.data.payment.id);
  });

  it('never trusts a client claim of success — only a signed webhook or verify', async () => {
    const contribution = await api()
      .post(`/api/v1/gifts/group/${giftId}/contribute`)
      .set(authHeader(mary))
      .send({ amountMinor: 1_500_000, currency: 'KES', provider: 'MPESA', payerPhone: '+254712345678', idempotencyKey: idempotencyKey() })
      .expect(201);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: contribution.body.data.payment.id } });

    const forged = JSON.stringify({ id: `evt_${payment.id}`, reference: payment.reference, status: 'SUCCESSFUL' });
    await api()
      .post('/api/v1/webhooks/payments/sandbox')
      .set('content-type', 'application/json')
      .set('x-sandbox-signature', 'deadbeef')
      .send(forged)
      .expect(401);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).status).toBe('PENDING');

    // A correctly signed callback settles it, exactly once even if replayed.
    const signed = signSandboxWebhook(forged);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await api()
        .post('/api/v1/webhooks/payments/sandbox')
        .set('content-type', 'application/json')
        .set('x-sandbox-signature', signed)
        .send(forged)
        .expect(200);
    }
    const settled = await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(settled.status).toBe('SUCCESSFUL');

    const gift = await prisma.groupGift.findUniqueOrThrow({ where: { id: giftId } });
    const sum = await prisma.giftContribution.aggregate({ where: { groupGiftId: giftId, status: 'SUCCESSFUL' }, _sum: { amountMinor: true } });
    expect(gift.raisedMinor).toBe(sum._sum.amountMinor);
  });

  it('hides contributors from the birthday person until the reveal', async () => {
    const hidden = await api().get(`/api/v1/gifts/group/${giftId}/contributions`).set(authHeader(sarah));
    expect(hidden.status).toBeGreaterThanOrEqual(403);

    await api().post(`/api/v1/gifts/group/${giftId}/reveal`).set(authHeader(john)).send({ message: 'Surprise!', revealContributors: true }).expect(200);

    const revealed = await api().get(`/api/v1/gifts/group/${giftId}/contributions`).set(authHeader(sarah)).expect(200);
    expect((revealed.body.data as unknown[]).length).toBeGreaterThan(0);
  });

  it('records a failed payment without moving the total', async () => {
    const other = await api()
      .post('/api/v1/gifts/group')
      .set(authHeader(john))
      .send({ title: 'Spa day', targetMinor: 1_000_000, currency: 'KES', beneficiaryUserId: sarah.id, createSurpriseGroup: false })
      .expect(201);
    // Sandbox amounts ending in 13 minor units are declined.
    const contribution = await api()
      .post(`/api/v1/gifts/group/${other.body.data.id}/contribute`)
      .set(authHeader(mary))
      .send({ amountMinor: 500_013, currency: 'KES', provider: 'CARD', idempotencyKey: idempotencyKey() })
      .expect(201);
    const verified = await api().post(`/api/v1/payments/${contribution.body.data.payment.id}/verify`).set(authHeader(mary)).expect(200);
    expect(verified.body.data.status).toBe('FAILED');
    const gift = await api().get(`/api/v1/gifts/group/${other.body.data.id}`).set(authHeader(john)).expect(200);
    expect(gift.body.data.raisedMinor).toBe(0);
  });
});
