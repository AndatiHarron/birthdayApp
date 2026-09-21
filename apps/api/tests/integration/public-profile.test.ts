import { prisma } from '../../src/lib/prisma';
import { api, authHeader, describeDb, idempotencyKey, registerUser, type TestUser } from '../setup/helpers';

/**
 * The link-in-bio page at /@username, and gifting from it: the owner opts in,
 * strangers may then claim and buy from the wishlist, and the delivery address
 * stays hidden from the buyer.
 */

async function publish(user: TestUser, options: { gifting?: boolean } = {}): Promise<void> {
  await api()
    .put('/api/v1/users/me/privacy')
    .set(authHeader(user))
    .send({ publicPage: true, publicGifting: options.gifting ?? false, wishlistVisibility: 'PUBLIC' })
    .expect(200);
}

async function addItem(user: TestUser, name = 'Instax camera'): Promise<{ id: string }> {
  const response = await api()
    .post('/api/v1/wishlist/items')
    .set(authHeader(user))
    .send({ name, priceMinor: 1_150_000, currency: 'KES', priority: 'MUST_HAVE' })
    .expect(201);
  return { id: response.body.data.id };
}

describeDb('link-in-bio page', () => {
  it('is off until the owner publishes it', async () => {
    const owner = await registerUser({ displayName: 'Sarah Achieng' });
    await api().get(`/@${owner.username}`).expect(404);

    await publish(owner);
    const page = await api().get(`/@${owner.username}`).expect(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.text).toContain('Sarah Achieng');
    expect(page.text).toContain(`@${owner.username}`);
    // Link previews for Instagram, WhatsApp and X.
    expect(page.text).toMatch(/<meta property="og:title"/);
    expect(page.text).toMatch(/<meta property="og:url" content="[^"]+\/@/);
  });

  it('shows the wishlist and marks claimed gifts without naming who claimed them', async () => {
    const owner = await registerUser({ displayName: 'Brian' });
    const friend = await registerUser({ displayName: 'Nosy Friend' });
    await publish(owner, { gifting: true });
    const item = await addItem(owner, 'Mechanical keyboard');

    const before = await api().get(`/@${owner.username}`).expect(200);
    expect(before.text).toContain('Mechanical keyboard');
    expect(before.text).not.toContain('Claimed');

    await api().post(`/api/v1/gifts/${item.id}/reserve`).set(authHeader(friend)).send({}).expect(201);
    const after = await api().get(`/@${owner.username}`).expect(200);
    expect(after.text).toContain('Claimed');
    expect(after.text).not.toContain('Nosy Friend');
  });

  it('escapes anything the owner typed', async () => {
    const owner = await registerUser({ displayName: 'Mallory' });
    await publish(owner);
    await addItem(owner, '<script>alert(1)</script>');
    const page = await api().get(`/@${owner.username}`).expect(200);
    expect(page.text).not.toContain('<script>alert(1)</script>');
    expect(page.text).toContain('&lt;script&gt;');
  });

  it('opens wishlist gifting to strangers only when the owner allows it', async () => {
    const owner = await registerUser();
    const stranger = await registerUser();
    await publish(owner, { gifting: false });
    const item = await addItem(owner);

    const refused = await api().post(`/api/v1/gifts/${item.id}/reserve`).set(authHeader(stranger)).send({}).expect(403);
    expect(refused.body.code).toBe('PHYSICAL_GIFT_REQUIRES_CONNECTION');

    await publish(owner, { gifting: true });
    await api().post(`/api/v1/gifts/${item.id}/reserve`).set(authHeader(stranger)).send({}).expect(201);
  });

  it('delivers to the owner’s saved address and never shows it to the buyer', async () => {
    const owner = await registerUser({ displayName: 'Amina' });
    const stranger = await registerUser();
    await publish(owner, { gifting: true });

    const order = {
      items: [{ productId: 'prod_placeholder', quantity: 1 }],
      recipientUserId: owner.id,
      useRecipientAddress: true,
      provider: 'MPESA',
      payerPhone: '+254712345678',
      idempotencyKey: idempotencyKey(),
    };

    // No saved address yet: the buyer is told, without learning anything about them.
    const noAddress = await api().post('/api/v1/orders').set(authHeader(stranger)).send(order).expect(422);
    expect(noAddress.body.message).toMatch(/have not saved a delivery address/i);

    await api()
      .post('/api/v1/addresses')
      .set(authHeader(owner))
      .send({ label: 'Home', recipientName: 'Amina', phone: '+254722222222', addressLine1: 'Kilimani Road 12', city: 'Nairobi', area: 'Kilimani', isDefault: true })
      .expect(201);

    // A real product, so checkout gets past the catalogue.
    const vendor = await prisma.vendor.create({
      data: { ownerUserId: stranger.id, name: `Test shop ${Date.now()}`, slug: `shop-${Date.now()}`, status: 'APPROVED', contactEmail: 'shop@example.test', contactPhone: '+254700000000', city: 'Nairobi' },
    });
    const product = await prisma.product.create({
      data: { vendorId: vendor.id, name: 'Camera', slug: `cam-${Date.now()}`, description: 'A camera for the wishlist', images: [], priceMinor: 500_000, currency: 'KES', status: 'ACTIVE', stock: 5, deliveryFeeMinor: 30_000 },
    });

    const placed = await api()
      .post('/api/v1/orders')
      .set(authHeader(stranger))
      .send({ ...order, items: [{ productId: product.id, quantity: 1 }], idempotencyKey: idempotencyKey() })
      .expect(201);

    const delivery = placed.body.data.order.delivery;
    expect(delivery.addressLine1).toBeNull();
    expect(delivery.city).toBeNull();
    expect(delivery.recipientPhone).toBeNull();
    expect(JSON.stringify(placed.body)).not.toContain('Kilimani Road 12');

    // The courier still gets a real address: it is on the delivery row, just
    // never in what the buyer is shown. (The recipient cannot open the order
    // until it is delivered — that rule protects the surprise.)
    const delivered = await prisma.delivery.findFirstOrThrow({ where: { order: { id: placed.body.data.order.id } } });
    expect(delivered.addressLine1).toBe('Kilimani Road 12');
    expect(delivered.city).toBe('Nairobi');
  });
});
