import { api, authHeader, describeDb, idempotencyKey, makeFriends, registerUser } from '../setup/helpers';

/**
 * Wishes carrying media: the wish wall plays photos, GIFs, video and voice one
 * per screen, so uploads have to accept those types and the wish has to come
 * back with the kind it was sent as.
 */

/** Smallest valid PNG: the upload checks the bytes, not the declared type. */
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfabd4', 'hex');
/** An MP4 header ("ftyp" box) — enough for the magic-byte check. */
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftypmp42'), Buffer.alloc(32)]);
const GIF = Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(24)]);

describeDb('wishes with media', () => {
  it('accepts photos, GIFs and video for a wish', async () => {
    const sender = await registerUser();
    for (const [name, bytes, type] of [
      ['wish.png', PNG, 'image/png'],
      ['wish.gif', GIF, 'image/gif'],
      ['wish.mp4', MP4, 'video/mp4'],
    ] as const) {
      const uploaded = await api().post('/api/v1/uploads/wish').set(authHeader(sender)).attach('file', Buffer.from(bytes), { filename: name, contentType: type });
      expect(uploaded.status).toBe(201);
      expect(uploaded.body.data.url).toMatch(/^https?:\/\//);
    }
  });

  it('sends a video wish and plays it back as one', async () => {
    const sender = await registerUser({ displayName: 'Mary' });
    const birthdayPerson = await registerUser();
    await makeFriends(sender, birthdayPerson);

    const uploaded = await api()
      .post('/api/v1/uploads/wish')
      .set(authHeader(sender))
      .attach('file', MP4, { filename: 'wish.mp4', contentType: 'video/mp4' })
      .expect(201);

    const sent = await api()
      .post('/api/v1/birthday-messages')
      .set(authHeader(sender))
      .send({ recipientUserId: birthdayPerson.id, kind: 'VIDEO', mediaUrl: uploaded.body.data.url, durationSeconds: 12, body: 'Happy birthday!' })
      .expect(201);
    expect(sent.body.data.message.kind).toBe('VIDEO');

    const received = await api().get('/api/v1/birthday-messages/received').set(authHeader(birthdayPerson)).expect(200);
    const wish = received.body.data.items.find((item: { id: string }) => item.id === sent.body.data.message.id);
    expect(wish).toMatchObject({ kind: 'VIDEO', mediaUrl: uploaded.body.data.url, fromStranger: false });
    expect(wish.sender.displayName).toBe('Mary');
    expect(wish.readAt).toBeNull();

    // The wall marks each wish read as the recipient reaches it.
    await api().post('/api/v1/birthday-messages/read').set(authHeader(birthdayPerson)).send({ ids: [sent.body.data.message.id] }).expect(200);
    const reread = await api().get('/api/v1/birthday-messages/received').set(authHeader(birthdayPerson)).expect(200);
    expect(reread.body.data.items.find((item: { id: string }) => item.id === sent.body.data.message.id).readAt).not.toBeNull();
  });

  it('reacts to a wish and takes the reaction back', async () => {
    const sender = await registerUser();
    const birthdayPerson = await registerUser();
    await makeFriends(sender, birthdayPerson);
    const sent = await api()
      .post('/api/v1/birthday-messages')
      .set(authHeader(sender))
      .send({ recipientUserId: birthdayPerson.id, kind: 'TEXT', body: 'Have a great one!' })
      .expect(201);

    await api().post(`/api/v1/birthday-messages/${sent.body.data.message.id}/reactions`).set(authHeader(birthdayPerson)).send({ emoji: '❤️' }).expect(204);
    const withReaction = await api().get('/api/v1/birthday-messages/received').set(authHeader(birthdayPerson)).expect(200);
    expect(withReaction.body.data.items[0].reactions).toEqual([{ emoji: '❤️', count: 1, mine: true }]);

    await api().delete(`/api/v1/birthday-messages/${sent.body.data.message.id}/reactions/${encodeURIComponent('❤️')}`).set(authHeader(birthdayPerson)).expect(204);
    const cleared = await api().get('/api/v1/birthday-messages/received').set(authHeader(birthdayPerson)).expect(200);
    expect(cleared.body.data.items[0].reactions).toEqual([]);
  });
});

/**
 * The heart of the product: a wish is free, and anyone can add money to it.
 * One request sends both, and the money lands in the recipient's wallet.
 */
describeDb('a wish with money', () => {
  it('sends the wish and the money together, and credits the wallet', async () => {
    const sender = await registerUser({ displayName: 'Uncle Ken' });
    const birthdayPerson = await registerUser();
    await makeFriends(sender, birthdayPerson);

    const sent = await api()
      .post('/api/v1/birthday-messages')
      .set(authHeader(sender))
      .send({
        recipientUserId: birthdayPerson.id,
        kind: 'TEXT',
        body: 'Happy birthday! Buy yourself something.',
        money: { amountMinor: 50_000, currency: 'KES', provider: 'MPESA', payerPhone: '+254712345678', idempotencyKey: idempotencyKey() },
      })
      .expect(201);

    expect(sent.body.data.message.body).toMatch(/Happy birthday/);
    expect(sent.body.data.gift).toMatchObject({ type: 'WALLET_CREDIT', valueMinor: 50_000 });
    // Nothing is paid until the provider says so (spec §58 rule 5).
    expect(sent.body.data.payment.status).toBe('PENDING');

    await api().post(`/api/v1/payments/${sent.body.data.payment.id}/verify`).set(authHeader(sender)).expect(200);

    const received = await api().get('/api/v1/digital-gifts/received').set(authHeader(birthdayPerson)).expect(200);
    const gift = received.body.data.find((entry: { id: string }) => entry.id === sent.body.data.gift.id);
    expect(gift).toBeTruthy();

    // The money reaches the wallet when they open the gift.
    const before = await api().get('/api/v1/wallet').set(authHeader(birthdayPerson)).expect(200);
    expect(before.body.data.balanceMinor).toBe(0);
    await api().post(`/api/v1/digital-gifts/${gift.id}/open`).set(authHeader(birthdayPerson)).expect(200);
    const after = await api().get('/api/v1/wallet').set(authHeader(birthdayPerson)).expect(200);
    expect(after.body.data.balanceMinor).toBe(50_000);
    expect(after.body.data.transactions[0]).toMatchObject({ type: 'CREDIT', reason: 'GIFT_RECEIVED', amountMinor: 50_000 });
  });

  it('still sends a wish with no money at all', async () => {
    const sender = await registerUser();
    const birthdayPerson = await registerUser();
    await makeFriends(sender, birthdayPerson);
    const sent = await api()
      .post('/api/v1/birthday-messages')
      .set(authHeader(sender))
      .send({ recipientUserId: birthdayPerson.id, kind: 'TEXT', body: 'Have a lovely day!' })
      .expect(201);
    expect(sent.body.data.gift).toBeNull();
    expect(sent.body.data.payment).toBeNull();
  });
});
