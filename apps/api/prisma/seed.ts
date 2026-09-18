import 'dotenv/config';
import { CARD_TEMPLATE_META, GIFT_CATEGORY_SEED, INTEREST_CATALOG, type CardTemplateStyle } from '@bday/shared';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Reference data seed (`npm run db:seed`).
 *
 * Seeds only taxonomy the app cannot run without — interests, gift categories
 * and card templates — plus, when SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are
 * set, the first super-admin account. It never creates demo users, products or
 * orders. Safe to run repeatedly: every write is an upsert.
 */

const prisma = new PrismaClient();

const CARD_TEMPLATES: Array<{ name: string; style: CardTemplateStyle; backgroundColor: string; headline: string; body: string; isPremium: boolean }> = [
  { name: 'Hearts & roses', style: 'ROMANTIC', backgroundColor: '#FDE2E4', headline: 'Happy birthday, my love', body: 'Every year with you is my favourite gift.', isPremium: false },
  { name: 'Cake chaos', style: 'FUNNY', backgroundColor: '#FFF3B0', headline: 'You’re not old, you’re vintage', body: 'Have your cake and eat all of it.', isPremium: false },
  { name: 'Best friends', style: 'FRIENDSHIP', backgroundColor: '#D8F3DC', headline: 'Happy birthday, bestie!', body: 'Thanks for always showing up. Today we celebrate you.', isPremium: false },
  { name: 'Family warmth', style: 'FAMILY', backgroundColor: '#FFE8D6', headline: 'Happy birthday from all of us', body: 'Wishing you love, laughter and a year full of good things.', isPremium: false },
  { name: 'Team card', style: 'PROFESSIONAL', backgroundColor: '#E0ECFF', headline: 'Happy birthday!', body: 'Wishing you a great year ahead from the whole team.', isPremium: false },
  { name: 'Clean & simple', style: 'SIMPLE', backgroundColor: '#FFFFFF', headline: 'Happy birthday', body: 'Hope your day is as wonderful as you are.', isPremium: false },
  { name: 'Gold confetti', style: 'ELEGANT', backgroundColor: '#1F1B2E', headline: 'Happy Birthday', body: 'Here’s to another beautiful year.', isPremium: true },
];

async function seedInterests() {
  for (const [position, interest] of INTEREST_CATALOG.entries()) {
    await prisma.interest.upsert({
      where: { slug: interest.slug },
      create: { slug: interest.slug, label: interest.label, emoji: interest.emoji, position },
      update: { label: interest.label, emoji: interest.emoji, position, isActive: true },
    });
  }
  return INTEREST_CATALOG.length;
}

async function seedCategories() {
  for (const [position, category] of GIFT_CATEGORY_SEED.entries()) {
    await prisma.giftCategory.upsert({
      where: { slug: category.slug },
      create: { slug: category.slug, label: category.label, emoji: category.emoji, position },
      update: { label: category.label, emoji: category.emoji, position },
    });
  }
  return GIFT_CATEGORY_SEED.length;
}

async function seedCardTemplates() {
  const base = (process.env.API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
  for (const [position, template] of CARD_TEMPLATES.entries()) {
    const slug = template.style.toLowerCase();
    const existing = await prisma.cardTemplate.findFirst({ where: { name: template.name }, select: { id: true } });
    const data = {
      name: template.name,
      style: template.style,
      previewUrl: `${base}/static/cards/${slug}.svg`,
      backgroundUrl: `${base}/static/cards/${slug}.svg`,
      backgroundColor: template.backgroundColor,
      defaultHeadline: template.headline,
      defaultBody: template.body,
      isPremium: template.isPremium,
      position,
    };
    if (existing) await prisma.cardTemplate.update({ where: { id: existing.id }, data });
    else await prisma.cardTemplate.create({ data });
  }
  return CARD_TEMPLATES.length;
}

async function seedAdmin() {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (!email || !password) return null;
  if (password.length < 12) throw new Error('SEED_ADMIN_PASSWORD must be at least 12 characters');

  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { role: 'SUPER_ADMIN', status: 'ACTIVE' } });
    return email;
  }

  const username = `admin${Date.now().toString(36).slice(-5)}`;
  await prisma.user.create({
    data: {
      email,
      username,
      passwordHash: await bcrypt.hash(password, Number(process.env.BCRYPT_ROUNDS ?? 12)),
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      emailVerified: true,
      emailVerifiedAt: new Date(),
      onboardingCompletedAt: new Date(),
      profile: { create: { displayName: process.env.SEED_ADMIN_NAME ?? 'Administrator' } },
      privacy: { create: { profileVisibility: 'PRIVATE', discoverableByEmail: false, discoverableByPhone: false, discoverableByUsername: false } },
      notificationPreference: { create: {} },
    },
  });
  return email;
}

async function main() {
  const [interests, categories, templates, admin] = [
    await seedInterests(),
    await seedCategories(),
    await seedCardTemplates(),
    await seedAdmin(),
  ];
  const styles = Object.keys(CARD_TEMPLATE_META).length;
  process.stdout.write(
    `Seeded ${interests} interests, ${categories} categories, ${templates} card templates (${styles} styles)` +
      `${admin ? `, super admin ${admin}` : ' — set SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD to create an admin'}.\n`,
  );
}

main()
  .catch((error) => {
    process.stderr.write(`Seed failed: ${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
