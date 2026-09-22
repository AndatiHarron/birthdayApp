/**
 * Demo catalogue for local development: one approved shop and a shelf of
 * products with real photographs, so the home and gift screens can be judged
 * as they will look with stock in them.
 *
 *   npm run db:demo            (development only; refuses to run otherwise)
 *
 * Product images come from picsum.photos, which needs no key and returns a
 * stable picture per seed. Nothing here runs in production: real catalogue
 * data comes from vendors signing up.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const PRODUCTS: Array<{ name: string; description: string; priceMinor: number; category: string; tags: string[] }> = [
  { name: 'Chocolate fudge birthday cake', description: 'Two layers, dark chocolate ganache, written message on top.', priceMinor: 350_000, category: 'cakes', tags: ['popular', 'personalized'] },
  { name: 'Red roses, dozen', description: 'A dozen long-stem roses, wrapped and hand delivered.', priceMinor: 420_000, category: 'flowers', tags: ['popular'] },
  { name: 'Wireless headphones', description: 'Over-ear, noise cancelling, 30-hour battery.', priceMinor: 1_250_000, category: 'electronics', tags: ['premium', 'popular'] },
  { name: 'Instant camera', description: 'Prints credit-card sized photos straight away. Film included.', priceMinor: 1_150_000, category: 'electronics', tags: ['popular'] },
  { name: 'Scented candle set', description: 'Three soy candles: vanilla, sandalwood and jasmine.', priceMinor: 180_000, category: 'home', tags: [] },
  { name: 'Leather journal', description: 'Hand-stitched leather cover, 200 lined pages, name embossed free.', priceMinor: 240_000, category: 'personalized', tags: ['personalized'] },
  { name: 'Coffee sampler box', description: 'Four single-origin Kenyan roasts, ground to order.', priceMinor: 290_000, category: 'home', tags: ['popular'] },
  { name: 'Silk scarf', description: 'Hand-printed silk, boxed for gifting.', priceMinor: 480_000, category: 'fashion', tags: ['premium'] },
  { name: 'Football jersey', description: 'Official replica, any name and number printed.', priceMinor: 650_000, category: 'fashion', tags: ['personalized'] },
  { name: 'Board game night set', description: 'Three party games for four to eight players.', priceMinor: 390_000, category: 'toys', tags: [] },
  { name: 'Spa day for two', description: 'Ninety minutes each: massage, steam room and tea.', priceMinor: 900_000, category: 'experiences', tags: ['premium', 'popular'] },
  { name: 'Chocolate truffle box', description: 'Twenty-four handmade truffles in a gift tin.', priceMinor: 160_000, category: 'chocolates', tags: [] },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('The demo catalogue is for development only.');
  }

  const owner = await prisma.user.upsert({
    where: { email: 'demo-shop@example.test' },
    update: {},
    create: {
      email: 'demo-shop@example.test',
      username: 'demoshop',
      status: 'ACTIVE',
      emailVerified: true,
      role: 'VENDOR',
      profile: { create: { displayName: 'Westlands Gift Studio', city: 'Nairobi' } },
      privacy: { create: {} },
      notificationPreference: { create: {} },
    },
  });

  const vendor = await prisma.vendor.upsert({
    where: { ownerUserId: owner.id },
    update: { status: 'APPROVED' },
    create: {
      ownerUserId: owner.id,
      name: 'Westlands Gift Studio',
      slug: 'westlands-gift-studio',
      description: 'Cakes, flowers and thoughtful things, delivered across Nairobi the same day.',
      status: 'APPROVED',
      approvedAt: new Date(),
      contactEmail: 'demo-shop@example.test',
      contactPhone: '+254700000000',
      city: 'Nairobi',
      area: 'Westlands',
      rating: 4.7,
      ratingCount: 128,
    },
  });

  for (const [index, item] of PRODUCTS.entries()) {
    const slug = item.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const category = await prisma.giftCategory.findUnique({ where: { slug: item.category } });
    await prisma.product.upsert({
      where: { slug },
      update: { status: 'ACTIVE', stock: 25 },
      create: {
        vendorId: vendor.id,
        name: item.name,
        slug,
        description: item.description,
        images: [`https://picsum.photos/seed/${slug}/800/800`],
        priceMinor: item.priceMinor,
        currency: 'KES',
        status: 'ACTIVE',
        stock: 25,
        tags: item.tags,
        deliveryFeeMinor: 30_000,
        deliveryEstimate: 'Same day in Nairobi',
        isPersonalizable: item.tags.includes('personalized'),
        city: 'Nairobi',
        area: 'Westlands',
        rating: 4.2 + ((index % 7) / 10),
        reviewCount: 12 + index * 3,
        purchaseCount: 40 - index,
        ...(category ? { categories: { create: { categoryId: category.id } } } : {}),
      },
    });
  }

  console.log(`Demo catalogue ready: ${PRODUCTS.length} products from ${vendor.name}.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
