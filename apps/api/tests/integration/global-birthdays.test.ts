import { zonedNow } from '../../src/lib/dates';
import { prisma } from '../../src/lib/prisma';
import { api, authHeader, describeDb, idempotencyKey, makeFriends, registerUser, type TestUser } from '../setup/helpers';

/**
 * Global birthdays: strangers may celebrate opted-in adults with wishes,
 * cheers and digital gifts (money included) — never physical gifts — and the
 * feed puts the least-celebrated people first.
 */

// Test users live in Africa/Nairobi (the profile default).
const today = zonedNow('Africa/Nairobi');
const birthdayToday = (year = 1994) => ({ month: today.month, day: today.day, year });
// A date that is never today (the day before today, or the 28th for 1 March).
const notToday = today.day > 1 ? { month: today.month, day: today.day - 1, year: 1990 } : { month: today.month === 1 ? 12 : today.month - 1, day: 28, year: 1990 };

async function optIn(user: TestUser, extra: Record<string, unknown> = {}): Promise<void> {
  await api().put('/api/v1/global/me').set(authHeader(user)).send({ celebrateGlobally: true, ...extra }).expect(200);
}

describeDb('global birthdays', () => {
  it('lets only verified adults with a full birth date opt in', async () => {
    const minor = await registerUser({ birthday: { month: 1, day: 1, year: today.year - 15 } });
    const tooYoung = await api().put('/api/v1/global/me').set(authHeader(minor)).send({ celebrateGlobally: true }).expect(403);
    expect(tooYoung.body.code).toBe('GLOBAL_CELEBRATION_NOT_ELIGIBLE');

    const noYear = await registerUser({ birthday: { month: 1, day: 1 } });
    await api().put('/api/v1/global/me').set(authHeader(noYear)).send({ celebrateGlobally: true }).expect(403);
    const status = await api().get('/api/v1/global/me').set(authHeader(noYear)).expect(200);
    expect(status.body.data).toMatchObject({ eligible: false, ineligibleReason: 'NO_BIRTH_YEAR', celebrateGlobally: false });

    const adult = await registerUser();
    await optIn(adult, { celebrationNote: 'Turning 32 in Kisumu!', firstCelebration: true });
    const mine = await api().get('/api/v1/global/me').set(authHeader(adult)).expect(200);
    expect(mine.body.data).toMatchObject({ eligible: true, celebrateGlobally: true, celebrationNote: 'Turning 32 in Kisumu!', firstCelebration: true });
  });

  it('keeps strangers out until the person opts in', async () => {
    const stranger = await registerUser();
    const sarah = await registerUser({ birthday: birthdayToday() });
    const wish = { recipientUserId: sarah.id, kind: 'TEXT', body: 'Happy birthday from Mombasa!' };

    const refused = await api().post('/api/v1/birthday-messages').set(authHeader(stranger)).send(wish).expect(403);
    expect(refused.body.code).toBe('RECIPIENT_NOT_ACCEPTING');
    await api()
      .post('/api/v1/digital-gifts')
      .set(authHeader(stranger))
      .send({ type: 'FLOWERS', recipientUserId: sarah.id, idempotencyKey: idempotencyKey() })
      .expect(403);

    await optIn(sarah);
    const sent = await api().post('/api/v1/birthday-messages').set(authHeader(stranger)).send(wish).expect(201);
    expect(sent.body.data.fromStranger).toBe(true);

    // Friends are never "strangers", opted in or not.
    const friend = await registerUser();
    await makeFriends(friend, sarah);
    const fromFriend = await api().post('/api/v1/birthday-messages').set(authHeader(friend)).send(wish).expect(201);
    expect(fromFriend.body.data.fromStranger).toBe(false);
  });

  it('lets strangers send money, within a cap, but never physical gifts', async () => {
    const stranger = await registerUser();
    const sarah = await registerUser({ birthday: birthdayToday() });
    await optIn(sarah);

    const money = await api()
      .post('/api/v1/digital-gifts')
      .set(authHeader(stranger))
      .send({ type: 'WALLET_CREDIT', recipientUserId: sarah.id, valueMinor: 50_000, currency: 'KES', provider: 'MPESA', payerPhone: '+254712345678', idempotencyKey: idempotencyKey() })
      .expect(201);
    expect(money.body.data.gift.fromStranger).toBe(true);

    await api()
      .post('/api/v1/digital-gifts')
      .set(authHeader(stranger))
      .send({ type: 'WALLET_CREDIT', recipientUserId: sarah.id, valueMinor: 5_000_000, currency: 'KES', provider: 'MPESA', payerPhone: '+254712345678', idempotencyKey: idempotencyKey() })
      .expect(422);

    // Physical: an order delivered to her, a wishlist reservation, a group gift.
    const order = await api()
      .post('/api/v1/orders')
      .set(authHeader(stranger))
      .send({
        items: [{ productId: 'prod_does_not_matter', quantity: 1 }],
        recipientUserId: sarah.id,
        deliveryAddress: { recipientName: 'Sarah', phone: '+254722222222', addressLine1: 'Kilimani Road 12', city: 'Nairobi' },
        provider: 'MPESA',
        payerPhone: '+254712345678',
        idempotencyKey: idempotencyKey(),
      })
      .expect(403);
    expect(order.body.code).toBe('PHYSICAL_GIFT_REQUIRES_CONNECTION');

    const item = await api()
      .post('/api/v1/wishlist/items')
      .set(authHeader(sarah))
      .send({ name: 'Instax camera', priceMinor: 1_150_000, currency: 'KES', priority: 'MUST_HAVE' })
      .expect(201);
    await prisma.wishlist.update({ where: { id: item.body.data.wishlistId }, data: { visibility: 'PUBLIC' } });
    await prisma.privacySetting.update({ where: { userId: sarah.id }, data: { wishlistVisibility: 'PUBLIC' } });
    const reserve = await api().post(`/api/v1/gifts/${item.body.data.id}/reserve`).set(authHeader(stranger)).send({}).expect(403);
    expect(reserve.body.code).toBe('PHYSICAL_GIFT_REQUIRES_CONNECTION');

    const group = await api()
      .post('/api/v1/gifts/group')
      .set(authHeader(stranger))
      .send({ title: 'Camera', targetMinor: 1_000_000, currency: 'KES', beneficiaryUserId: sarah.id })
      .expect(403);
    expect(group.body.code).toBe('PHYSICAL_GIFT_REQUIRES_CONNECTION');

    // Once connected, physical gifting opens up.
    await makeFriends(stranger, sarah);
    await api().post(`/api/v1/gifts/${item.body.data.id}/reserve`).set(authHeader(stranger)).send({}).expect(201);
  });

  it('lists opted-in adults celebrating today, first celebrations and least celebrated first', async () => {
    const viewer = await registerUser();
    const popular = await registerUser({ birthday: birthdayToday() });
    const quiet = await registerUser({ birthday: birthdayToday() });
    const firstTimer = await registerUser({ birthday: birthdayToday() });
    const notOptedIn = await registerUser({ birthday: birthdayToday() });
    const minor = await registerUser({ birthday: birthdayToday(today.year - 16) });
    const otherDay = await registerUser({ birthday: notToday });
    for (const user of [popular, quiet, otherDay]) await optIn(user);
    await optIn(firstTimer, { firstCelebration: true, celebrationNote: 'My first real birthday party!' });
    // A minor can never opt in; force the flag to prove the feed still hides them.
    await prisma.privacySetting.update({ where: { userId: minor.id }, data: { celebrateGlobally: true } });

    for (const fan of [await registerUser(), await registerUser()]) {
      await api().post(`/api/v1/global/${popular.id}/cheer`).set(authHeader(fan)).send({}).expect(200);
    }

    const feed = await api().get('/api/v1/global/today?limit=50').set(authHeader(viewer)).expect(200);
    const ids: string[] = feed.body.data.items.map((item: { userId: string }) => item.userId);
    expect(ids).toEqual(expect.arrayContaining([popular.id, quiet.id, firstTimer.id]));
    for (const hidden of [notOptedIn.id, minor.id, otherDay.id, viewer.id]) expect(ids).not.toContain(hidden);

    const ours = ids.filter((id) => [popular.id, quiet.id, firstTimer.id].includes(id));
    expect(ours).toEqual([firstTimer.id, quiet.id, popular.id]);

    const first = feed.body.data.items.find((item: { userId: string }) => item.userId === firstTimer.id);
    expect(first).toMatchObject({ firstCelebration: true, note: 'My first real birthday party!', isToday: true, turningAge: today.year - 1994 });
    expect(first).not.toHaveProperty('email');
    expect(first).not.toHaveProperty('birthYear');
  });

  it('counts each cheer once per person per year, only on the day', async () => {
    const fan = await registerUser();
    const sarah = await registerUser({ birthday: birthdayToday() });
    const later = await registerUser({ birthday: notToday });
    await optIn(sarah);
    await optIn(later);

    const first = await api().post(`/api/v1/global/${sarah.id}/cheer`).set(authHeader(fan)).send({ emoji: '🎂' }).expect(200);
    expect(first.body.data).toEqual({ cheerCount: 1, cheeredByMe: true });
    const again = await api().post(`/api/v1/global/${sarah.id}/cheer`).set(authHeader(fan)).send({}).expect(200);
    expect(again.body.data.cheerCount).toBe(1);

    const notice = await prisma.notification.findFirst({ where: { userId: sarah.id, type: 'BIRTHDAY_CHEER' } });
    expect(notice?.title).toMatch(/celebrated your birthday/);

    const early = await api().post(`/api/v1/global/${later.id}/cheer`).set(authHeader(fan)).send({}).expect(409);
    expect(early.body.code).toBe('NOT_BIRTHDAY_TODAY');

    const status = await api().get('/api/v1/global/me').set(authHeader(sarah)).expect(200);
    expect(status.body.data).toMatchObject({ isMyBirthdayToday: true, cheersReceived: 1 });
  });

  it('respects blocks and keeps minors out of browsing', async () => {
    const viewer = await registerUser();
    const sarah = await registerUser({ birthday: birthdayToday() });
    await optIn(sarah);
    await api().post('/api/v1/users/block').set(authHeader(sarah)).send({ userId: viewer.id }).expect((res) => expect([200, 201, 204]).toContain(res.status));

    const feed = await api().get('/api/v1/global/today?limit=50').set(authHeader(viewer)).expect(200);
    expect(feed.body.data.items.map((item: { userId: string }) => item.userId)).not.toContain(sarah.id);
    await api().post(`/api/v1/global/${sarah.id}/cheer`).set(authHeader(viewer)).send({}).expect(404);

    const minor = await registerUser({ birthday: { month: 5, day: 5, year: today.year - 14 } });
    const browse = await api().get('/api/v1/global/today').set(authHeader(minor)).expect(403);
    expect(browse.body.code).toBe('GLOBAL_CELEBRATION_NOT_ELIGIBLE');
  });

  it('finds birthday twins who opted in', async () => {
    const twinDate = { month: 11, day: 7 };
    const me = await registerUser({ birthday: { ...twinDate, year: 1991 } });
    const twin = await registerUser({ birthday: { ...twinDate, year: 1985 } });
    const shy = await registerUser({ birthday: { ...twinDate, year: 1988 } });
    await optIn(twin);

    const twins = await api().get('/api/v1/global/twins').set(authHeader(me)).expect(200);
    const ids = twins.body.data.items.map((item: { userId: string }) => item.userId);
    expect(twins.body.data).toMatchObject(twinDate);
    expect(ids).toContain(twin.id);
    expect(ids).not.toContain(shy.id);
  });
});
