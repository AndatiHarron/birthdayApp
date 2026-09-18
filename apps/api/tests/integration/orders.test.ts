import { prisma } from '../../src/lib/prisma';
import { api, authHeader, describeDb, idempotencyKey, makeFriends, registerUser, type TestUser } from '../setup/helpers';

describeDb('marketplace orders and delivery (spec §17, §18, §34, §58 rule 6)', () => {
  let shopper: TestUser;
  let friend: TestUser;
  let vendorOwner: TestUser;
  let admin: TestUser;
  let productId: string;

  beforeAll(async () => {
    [shopper, friend, vendorOwner, admin] = await Promise.all([
      registerUser({ displayName: 'Shopper' }),
      registerUser({ displayName: 'Birthday Friend' }),
      registerUser({ displayName: 'Cake Shop Owner' }),
      registerUser({ displayName: 'Admin' }),
    ]);
    await prisma.user.update({ where: { id: admin.id }, data: { role: 'SUPER_ADMIN' } });
    await makeFriends(shopper, friend);

    const category = await prisma.giftCategory.upsert({
      where: { slug: 'cakes' },
      create: { slug: 'cakes', label: 'Cakes' },
      update: {},
    });

    const application = await api()
      .post('/api/v1/vendor/apply')
      .set(authHeader(vendorOwner))
      .send({
        name: `Westlands Cakes ${Date.now()}`,
        description: 'Custom birthday cakes baked fresh in Westlands.',
        contactEmail: 'cakes@example.test',
        contactPhone: '+254711111111',
        city: 'Nairobi',
        area: 'Westlands',
      })
      .expect(201);

    // Listing is refused until an admin approves the shop.
    const early = await api()
      .post('/api/v1/vendor/products')
      .set(authHeader(vendorOwner))
      .send({ name: 'Chocolate cake', description: 'Two-tier chocolate cake', images: ['https://example.test/cake.jpg'], priceMinor: 350_000, currency: 'KES', categoryIds: [category.id] });
    expect(early.status).toBe(403);

    await api().patch(`/api/v1/admin/vendors/${application.body.data.id}`).set(authHeader(admin)).send({ status: 'APPROVED' }).expect(200);

    const product = await api()
      .post('/api/v1/vendor/products')
      .set(authHeader(vendorOwner))
      .send({
        name: 'Chocolate birthday cake',
        description: 'Two-tier chocolate cake with a personalised message.',
        images: ['https://example.test/cake.jpg'],
        priceMinor: 350_000,
        currency: 'KES',
        categoryIds: [category.id],
        stock: 5,
        deliveryFeeMinor: 30_000,
        isPersonalizable: true,
        city: 'Nairobi',
        area: 'Westlands',
      })
      .expect(201);
    productId = product.body.data.id;

    // Not visible to shoppers until approved.
    await api().get(`/api/v1/products/${productId}`).set(authHeader(shopper)).expect((response) => {
      if (response.status === 200 && response.body.data.status === 'ACTIVE') throw new Error('product should not be active yet');
    });
    await api().patch(`/api/v1/admin/products/${productId}`).set(authHeader(admin)).send({ status: 'ACTIVE' }).expect(200);
  });

  it('computes totals on the server and ignores anything the client sends', async () => {
    const response = await api()
      .post('/api/v1/orders')
      .set(authHeader(shopper))
      .send({
        items: [{ productId, quantity: 2, personalization: 'Happy birthday Sarah!' }],
        recipientUserId: friend.id,
        deliveryAddress: { recipientName: 'Sarah', phone: '+254722222222', addressLine1: 'Kilimani Road 12', city: 'Nairobi', area: 'Kilimani' },
        provider: 'MPESA',
        payerPhone: '+254712345678',
        idempotencyKey: idempotencyKey(),
        totalMinor: 1,
      })
      .expect(201);

    expect(response.body.data.order.subtotalMinor).toBe(700_000);
    expect(response.body.data.order.deliveryFeeMinor).toBe(30_000);
    expect(response.body.data.order.totalMinor).toBe(730_000);
    expect(response.body.data.payment.status).toBe('PENDING');
  });

  it('runs an order from payment through delivery with a full timeline', async () => {
    const created = await api()
      .post('/api/v1/orders')
      .set(authHeader(shopper))
      .send({
        items: [{ productId, quantity: 1 }],
        recipientUserId: friend.id,
        deliveryAddress: { recipientName: 'Sarah', addressLine1: 'Kilimani Road 12', city: 'Nairobi' },
        scheduledDate: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
        scheduledWindow: 'MORNING',
        provider: 'CARD',
        idempotencyKey: idempotencyKey(),
      })
      .expect(201);
    const orderId = created.body.data.order.id as string;

    // Vendor cannot move an unpaid order.
    const unpaid = await api().post(`/api/v1/vendor/orders/${orderId}/delivery`).set(authHeader(vendorOwner)).send({ status: 'PROCESSING' });
    expect(unpaid.status).toBe(409);

    await api().post(`/api/v1/payments/${created.body.data.payment.id}/verify`).set(authHeader(shopper)).expect(200);
    const paid = await api().get(`/api/v1/orders/${orderId}`).set(authHeader(shopper)).expect(200);
    expect(paid.body.data.status).toBe('PAID');

    const skip = await api().post(`/api/v1/vendor/orders/${orderId}/delivery`).set(authHeader(vendorOwner)).send({ status: 'DELIVERED' });
    expect(skip.status).toBe(409);
    expect(skip.body.code).toBe('INVALID_DELIVERY_TRANSITION');

    for (const status of ['PROCESSING', 'DISPATCHED', 'OUT_FOR_DELIVERY', 'DELIVERED']) {
      await api().post(`/api/v1/vendor/orders/${orderId}/delivery`).set(authHeader(vendorOwner)).send({ status }).expect(200);
    }

    const done = await api().get(`/api/v1/orders/${orderId}`).set(authHeader(shopper)).expect(200);
    expect(done.body.data.status).toBe('FULFILLED');
    expect((done.body.data.delivery.timeline as Array<{ status: string }>).map((event) => event.status)).toEqual(
      expect.arrayContaining(['PENDING', 'PROCESSING', 'DISPATCHED', 'OUT_FOR_DELIVERY', 'DELIVERED']),
    );

    // The recipient can now see the gift, but not what it cost.
    const recipientView = await api().get(`/api/v1/orders/${orderId}`).set(authHeader(friend)).expect(200);
    expect(recipientView.body.data.totalMinor).toBe(0);

    const stock = await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { stock: true } });
    expect(stock.stock).toBeLessThan(5);
  });

  it('refuses an order larger than the stock', async () => {
    const response = await api()
      .post('/api/v1/orders')
      .set(authHeader(shopper))
      .send({ items: [{ productId, quantity: 20 }], deliveryTarget: 'SENDER', provider: 'MPESA', payerPhone: '+254712345678', idempotencyKey: idempotencyKey() });
    expect(response.status).toBe(409);
    expect(response.body.code).toBe('PRODUCT_UNAVAILABLE');
  });

  it('lets an admin refund a paid order', async () => {
    const created = await api()
      .post('/api/v1/orders')
      .set(authHeader(shopper))
      .send({ items: [{ productId, quantity: 1 }], deliveryTarget: 'SENDER', provider: 'CARD', idempotencyKey: idempotencyKey() })
      .expect(201);
    await api().post(`/api/v1/payments/${created.body.data.payment.id}/verify`).set(authHeader(shopper)).expect(200);

    const refund = await api()
      .post(`/api/v1/admin/orders/${created.body.data.order.id}/refund`)
      .set(authHeader(admin))
      .send({ reason: 'Shop could not bake in time' })
      .expect(200);
    expect(refund.body.data.refund.status).toBe('REFUNDED');

    const audit = await prisma.auditLog.findFirst({ where: { action: 'order.refund', targetId: created.body.data.order.id } });
    expect(audit).not.toBeNull();
  });

  it('keeps admin routes closed to regular users', async () => {
    const response = await api().get('/api/v1/admin/stats').set(authHeader(shopper)).expect(403);
    expect(response.body.code).toBe('FORBIDDEN');
    await api().get('/api/v1/admin/stats').set(authHeader(admin)).expect(200);
  });
});
