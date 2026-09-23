import { prisma } from '../../src/lib/prisma';
import { api, authHeader, describeDb, idempotencyKey, makeFriends, registerUser, type TestUser } from '../setup/helpers';

/**
 * Withdrawals (spec §33). Money that arrives as a birthday gift has to be able
 * to leave again, and the wallet must never be debited twice or left short
 * when a transfer fails.
 */

/** Gives `user` money the way the app does: a friend sends it with a wish. */
async function fund(user: TestUser, amountMinor: number): Promise<void> {
  const sender = await registerUser();
  await makeFriends(sender, user);
  const sent = await api()
    .post('/api/v1/birthday-messages')
    .set(authHeader(sender))
    .send({
      recipientUserId: user.id,
      kind: 'TEXT',
      body: 'Happy birthday!',
      money: { amountMinor, currency: 'KES', provider: 'MPESA', payerPhone: '+254712345678', idempotencyKey: idempotencyKey() },
    })
    .expect(201);
  await api().post(`/api/v1/payments/${sent.body.data.payment.id}/verify`).set(authHeader(sender)).expect(200);
  await api().post(`/api/v1/digital-gifts/${sent.body.data.gift.id}/open`).set(authHeader(user)).expect(200);
}

/** Withdrawals only go to a number the account has proved it controls. */
async function verifyPhone(user: TestUser, phone: string): Promise<void> {
  await prisma.user.update({ where: { id: user.id }, data: { phone, phoneVerified: true } });
}

describeDb('withdrawing money', () => {
  it('moves money out of the wallet and records it once', async () => {
    const user = await registerUser();
    await fund(user, 200_000);
    await verifyPhone(user, '+254799000001');

    const withdrawal = await api()
      .post('/api/v1/wallet/withdraw')
      .set(authHeader(user))
      .send({ amountMinor: 150_000, destination: '+254799000001', idempotencyKey: idempotencyKey() })
      .expect(201);

    // The sandbox provider settles at once; with real M-Pesa this waits for an admin.
    expect(withdrawal.body.data.status).toBe('PAID');
    // The phone number is masked in what the client is told.
    expect(withdrawal.body.data.destination).not.toContain('254799000001');

    const wallet = await api().get('/api/v1/wallet').set(authHeader(user)).expect(200);
    expect(wallet.body.data.balanceMinor).toBe(50_000);
    expect(wallet.body.data.transactions[0]).toMatchObject({ type: 'DEBIT', reason: 'WITHDRAWAL', amountMinor: 150_000 });

    const mine = await api().get('/api/v1/wallet/withdrawals').set(authHeader(user)).expect(200);
    expect(mine.body.data).toHaveLength(1);
  });

  it('refuses more than the wallet holds, amounts below the minimum, and unverified numbers', async () => {
    const user = await registerUser();
    await fund(user, 60_000);
    await verifyPhone(user, '+254799000002');

    const tooMuch = await api()
      .post('/api/v1/wallet/withdraw')
      .set(authHeader(user))
      .send({ amountMinor: 500_000, destination: '+254799000002', idempotencyKey: idempotencyKey() })
      .expect(402);
    expect(tooMuch.body.code).toBe('INSUFFICIENT_WALLET_BALANCE');

    const tooSmall = await api()
      .post('/api/v1/wallet/withdraw')
      .set(authHeader(user))
      .send({ amountMinor: 5_000, destination: '+254799000002', idempotencyKey: idempotencyKey() })
      .expect(422);
    expect(tooSmall.body.code).toBe('PAYOUT_TOO_SMALL');

    const wrongNumber = await api()
      .post('/api/v1/wallet/withdraw')
      .set(authHeader(user))
      .send({ amountMinor: 20_000, destination: '+254700999999', idempotencyKey: idempotencyKey() })
      .expect(403);
    expect(wrongNumber.body.code).toBe('PAYOUT_DESTINATION_UNVERIFIED');

    // None of the refusals touched the balance.
    const wallet = await api().get('/api/v1/wallet').set(authHeader(user)).expect(200);
    expect(wallet.body.data.balanceMinor).toBe(60_000);
  });

  it('charges one withdrawal when the same request is retried', async () => {
    const user = await registerUser();
    await fund(user, 300_000);
    await verifyPhone(user, '+254799000003');
    const key = idempotencyKey();
    const body = { amountMinor: 100_000, destination: '+254799000003', idempotencyKey: key };

    const first = await api().post('/api/v1/wallet/withdraw').set(authHeader(user)).send(body).expect(201);
    const retry = await api().post('/api/v1/wallet/withdraw').set(authHeader(user)).send(body).expect(201);
    expect(retry.body.data.id).toBe(first.body.data.id);

    const wallet = await api().get('/api/v1/wallet').set(authHeader(user)).expect(200);
    expect(wallet.body.data.balanceMinor).toBe(200_000);
  });

  it('puts the money back when a transfer fails, and an admin can work the queue', async () => {
    const admin = await registerUser();
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'SUPER_ADMIN' } });
    const user = await registerUser();
    await fund(user, 250_000);
    await verifyPhone(user, '+254799000004');

    const withdrawal = await api()
      .post('/api/v1/wallet/withdraw')
      .set(authHeader(user))
      .send({ amountMinor: 200_000, destination: '+254799000004', idempotencyKey: idempotencyKey() })
      .expect(201);

    // The sandbox settles at once. Real M-Pesa payouts sit in the queue until
    // someone sends them, which is the state this test is about.
    await prisma.payout.update({ where: { id: withdrawal.body.data.id }, data: { status: 'PROCESSING', completedAt: null } });

    const queue = await api().get('/api/v1/admin/payouts').set(authHeader(admin)).expect(200);
    const mine = queue.body.data.find((row: { id: string }) => row.id === withdrawal.body.data.id);
    // The administrator sending the transfer needs the real number.
    expect(mine.destinationFull).toBe('+254799000004');

    const failed = await api()
      .post(`/api/v1/admin/payouts/${withdrawal.body.data.id}/fail`)
      .set(authHeader(admin))
      .send({ reason: 'M-Pesa reported the number is not registered.' })
      .expect(200);
    expect(failed.body.data.status).toBe('FAILED');

    const wallet = await api().get('/api/v1/wallet').set(authHeader(user)).expect(200);
    expect(wallet.body.data.balanceMinor).toBe(250_000);
    expect(wallet.body.data.transactions[0]).toMatchObject({ type: 'CREDIT', reason: 'REFUND', amountMinor: 200_000 });

    // A failed payout cannot then be marked paid.
    await api().post(`/api/v1/admin/payouts/${withdrawal.body.data.id}/complete`).set(authHeader(admin)).send({}).expect(409);
  });

  it(`keeps withdrawals out of other people's hands`, async () => {
    const user = await registerUser();
    const stranger = await registerUser();
    await fund(user, 100_000);
    await verifyPhone(user, '+254799000005');
    const withdrawal = await api()
      .post('/api/v1/wallet/withdraw')
      .set(authHeader(user))
      .send({ amountMinor: 50_000, destination: '+254799000005', idempotencyKey: idempotencyKey() })
      .expect(201);

    await api().get('/api/v1/admin/payouts').set(authHeader(stranger)).expect(403);
    await api().post(`/api/v1/admin/payouts/${withdrawal.body.data.id}/complete`).set(authHeader(stranger)).send({}).expect(403);
  });
});
