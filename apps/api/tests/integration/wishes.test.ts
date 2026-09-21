import { api, authHeader, describeDb, makeFriends, registerUser } from '../setup/helpers';

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
    expect(sent.body.data.kind).toBe('VIDEO');

    const received = await api().get('/api/v1/birthday-messages/received').set(authHeader(birthdayPerson)).expect(200);
    const wish = received.body.data.items.find((item: { id: string }) => item.id === sent.body.data.id);
    expect(wish).toMatchObject({ kind: 'VIDEO', mediaUrl: uploaded.body.data.url, fromStranger: false });
    expect(wish.sender.displayName).toBe('Mary');
    expect(wish.readAt).toBeNull();

    // The wall marks each wish read as the recipient reaches it.
    await api().post('/api/v1/birthday-messages/read').set(authHeader(birthdayPerson)).send({ ids: [sent.body.data.id] }).expect(200);
    const reread = await api().get('/api/v1/birthday-messages/received').set(authHeader(birthdayPerson)).expect(200);
    expect(reread.body.data.items.find((item: { id: string }) => item.id === sent.body.data.id).readAt).not.toBeNull();
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

    await api().post(`/api/v1/birthday-messages/${sent.body.data.id}/reactions`).set(authHeader(birthdayPerson)).send({ emoji: '❤️' }).expect(204);
    const withReaction = await api().get('/api/v1/birthday-messages/received').set(authHeader(birthdayPerson)).expect(200);
    expect(withReaction.body.data.items[0].reactions).toEqual([{ emoji: '❤️', count: 1, mine: true }]);

    await api().delete(`/api/v1/birthday-messages/${sent.body.data.id}/reactions/${encodeURIComponent('❤️')}`).set(authHeader(birthdayPerson)).expect(204);
    const cleared = await api().get('/api/v1/birthday-messages/received').set(authHeader(birthdayPerson)).expect(200);
    expect(cleared.body.data.items[0].reactions).toEqual([]);
  });
});
