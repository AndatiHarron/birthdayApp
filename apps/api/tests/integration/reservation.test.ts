import { api, authHeader, describeDb, makeFriends, registerUser, type TestUser } from '../setup/helpers';

async function addItem(owner: TestUser, overrides: Record<string, unknown> = {}) {
  const response = await api()
    .post('/api/v1/wishlist/items')
    .set(authHeader(owner))
    .send({ name: 'Portable photo printer', priceMinor: 850_000, currency: 'KES', priority: 'MUST_HAVE', ...overrides })
    .expect(201);
  return response.body.data as { id: string; wishlistId: string };
}

describeDb('gift reservations (spec §13, §58 rules 1–3)', () => {
  let sarah: TestUser;
  let john: TestUser;
  let mary: TestUser;
  let stranger: TestUser;

  beforeAll(async () => {
    [sarah, john, mary, stranger] = await Promise.all([
      registerUser({ displayName: 'Sarah' }),
      registerUser({ displayName: 'John' }),
      registerUser({ displayName: 'Mary' }),
      registerUser({ displayName: 'Stranger' }),
    ]);
    await makeFriends(sarah, john);
    await makeFriends(sarah, mary);
  });

  it('lets a friend reserve and shows others that someone is getting it', async () => {
    const item = await addItem(sarah);

    const reserved = await api().post(`/api/v1/gifts/${item.id}/reserve`).set(authHeader(john)).send({}).expect(201);
    expect(reserved.body.data.view.isMine).toBe(true);

    const marysView = await api().get(`/api/v1/wishlist/items/${item.id}`).set(authHeader(mary)).expect(200);
    expect(marysView.body.data.status).toBe('RESERVED');
    expect(marysView.body.data.reservation.reservedByMe).toBe(false);

    const second = await api().post(`/api/v1/gifts/${item.id}/reserve`).set(authHeader(mary)).send({}).expect(409);
    expect(second.body.code).toBe('GIFT_ALREADY_RESERVED');
  });

  it('never reveals a reservation to the birthday person — not even via status', async () => {
    const item = await addItem(sarah, { name: 'Headphones' });
    await api().post(`/api/v1/gifts/${item.id}/reserve`).set(authHeader(john)).send({}).expect(201);

    const ownerItem = await api().get(`/api/v1/wishlist/items/${item.id}`).set(authHeader(sarah)).expect(200);
    expect(ownerItem.body.data.reservation).toBeNull();
    expect(ownerItem.body.data.status).toBe('AVAILABLE');

    const ownerList = await api().get(`/api/v1/wishlists/${item.wishlistId}`).set(authHeader(sarah)).expect(200);
    const listed = (ownerList.body.data.items as Array<{ id: string; status: string; reservation: unknown }>).find((entry) => entry.id === item.id);
    expect(listed?.status).toBe('AVAILABLE');
    expect(listed?.reservation).toBeNull();

    const peek = await api().get(`/api/v1/wishlist/items/${item.id}/reservations`).set(authHeader(sarah)).expect(403);
    expect(peek.body.code).toBe('OWNER_CANNOT_VIEW_RESERVATIONS');
  });

  it('allows exactly one winner when two friends reserve at the same moment', async () => {
    const item = await addItem(sarah, { name: 'Smart watch' });
    const results = await Promise.all([
      api().post(`/api/v1/gifts/${item.id}/reserve`).set(authHeader(john)).send({}),
      api().post(`/api/v1/gifts/${item.id}/reserve`).set(authHeader(mary)).send({}),
    ]);
    const statuses = results.map((result) => result.status).sort();
    expect(statuses, JSON.stringify(results.map((result) => result.body))).toEqual([201, 409]);
  });

  it('splits multi-quantity items without over-claiming', async () => {
    const item = await addItem(sarah, { name: 'Novels', quantity: 2 });
    await api().post(`/api/v1/gifts/${item.id}/reserve`).set(authHeader(john)).send({ quantity: 1 }).expect(201);
    const tooMany = await api().post(`/api/v1/gifts/${item.id}/reserve`).set(authHeader(mary)).send({ quantity: 2 }).expect(409);
    expect(tooMany.body.code).toBe('ITEM_QUANTITY_EXHAUSTED');
    await api().post(`/api/v1/gifts/${item.id}/reserve`).set(authHeader(mary)).send({ quantity: 1 }).expect(201);
  });

  it('frees the item when the reserver cancels', async () => {
    const item = await addItem(sarah, { name: 'Candle set' });
    const reserved = await api().post(`/api/v1/gifts/${item.id}/reserve`).set(authHeader(john)).send({}).expect(201);
    await api().delete(`/api/v1/gifts/reservations/${reserved.body.data.reservationId}`).set(authHeader(john)).expect(204);
    await api().post(`/api/v1/gifts/${item.id}/reserve`).set(authHeader(mary)).send({}).expect(201);
  });

  it('refuses reserving your own wish', async () => {
    const item = await addItem(sarah, { name: 'Own wish' });
    const response = await api().post(`/api/v1/gifts/${item.id}/reserve`).set(authHeader(sarah)).send({}).expect(400);
    expect(response.body.code).toBe('CANNOT_RESERVE_OWN_ITEM');
  });

  it('enforces wishlist visibility for non-friends (rule 3)', async () => {
    const item = await addItem(sarah, { name: 'Private-ish wish' });
    const response = await api().get(`/api/v1/wishlist/items/${item.id}`).set(authHeader(stranger));
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('WISHLIST_PRIVATE');
  });

  it('writes gift history for both people when the gift is delivered', async () => {
    const item = await addItem(sarah, { name: 'Coffee grinder' });
    const reserved = await api().post(`/api/v1/gifts/${item.id}/reserve`).set(authHeader(john)).send({}).expect(201);
    const reservationId = reserved.body.data.reservationId as string;
    await api().patch(`/api/v1/gifts/reservations/${reservationId}`).set(authHeader(john)).send({ status: 'PURCHASED' }).expect(204);
    await api().patch(`/api/v1/gifts/reservations/${reservationId}`).set(authHeader(john)).send({ status: 'DELIVERED' }).expect(204);

    const sarahHistory = await api().get('/api/v1/gift-history?direction=RECEIVED').set(authHeader(sarah)).expect(200);
    expect((sarahHistory.body.data as Array<{ title: string }>).some((entry) => entry.title === 'Coffee grinder')).toBe(true);

    const thanks = await api()
      .post('/api/v1/thank-yous')
      .set(authHeader(sarah))
      .send({ giftType: 'RESERVATION', giftId: reservationId, body: 'Thank you so much ❤️' });
    expect(thanks.status, JSON.stringify(thanks.body)).toBe(201);
    expect(thanks.body.data.body).toContain('Thank you');
  });
});
