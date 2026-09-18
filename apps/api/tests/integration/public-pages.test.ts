import { prisma } from '../../src/lib/prisma';
import { api, authHeader, describeDb, makeFriends, registerUser } from '../setup/helpers';

describeDb('public share pages', () => {
  it('renders a public wishlist with escaped content and no reservation details', async () => {
    const [owner, friend] = await Promise.all([registerUser({ displayName: 'Owner <script>' }), registerUser({ displayName: 'Friend' })]);
    await makeFriends(owner, friend);
    const item = await api()
      .post('/api/v1/wishlist/items')
      .set(authHeader(owner))
      .send({ name: '<img src=x onerror=alert(1)> Camera', priceMinor: 850_000, currency: 'KES' })
      .expect(201);
    await prisma.wishlist.update({ where: { id: item.body.data.wishlistId }, data: { visibility: 'PUBLIC' } });
    await prisma.privacySetting.update({ where: { userId: owner.id }, data: { wishlistVisibility: 'PUBLIC' } });
    await api().post(`/api/v1/gifts/${item.body.data.id}/reserve`).set(authHeader(friend)).send({}).expect(201);

    const wishlist = await prisma.wishlist.findUniqueOrThrow({ where: { id: item.body.data.wishlistId } });
    const page = await api().get(`/wishlist/${wishlist.shareSlug}`).expect(200);

    expect(page.headers['content-type']).toContain('text/html');
    expect(page.text).toContain('&lt;img src=x onerror=alert(1)&gt; Camera');
    expect(page.text).not.toContain('<img src=x');
    expect(page.text).not.toContain('<script>');
    expect(page.text).not.toMatch(/reserved|Friend is getting/i);
    expect(page.text).toContain('KES 8,500');
  });

  it('lets a guest without an account RSVP through their link', async () => {
    const host = await registerUser({ displayName: 'Host' });
    const created = await api()
      .post('/api/v1/events')
      .set(authHeader(host))
      .send({ name: 'Garden party', startsAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), guestNames: ['Grandma'], createGroupChat: false })
      .expect(201);
    const links = await api().get(`/api/v1/events/${created.body.data.id}/invite-links`).set(authHeader(host)).expect(200);
    const token = (links.body.data as Array<{ token: string }>)[0]!.token;

    const form = await api().get(`/rsvp/${token}`).expect(200);
    expect(form.text).toContain('Garden party');

    await api().post(`/rsvp/${token}`).type('form').send({ status: 'GOING' }).expect(303);
    const guest = await prisma.eventGuest.findUniqueOrThrow({ where: { inviteToken: token } });
    expect(guest.rsvp).toBe('GOING');

    await api().get('/rsvp/not-a-real-token-at-all-xx').expect(403);
  });

  it('serves the privacy policy and terms', async () => {
    await api().get('/privacy').expect(200);
    await api().get('/terms').expect(200);
  });
});
