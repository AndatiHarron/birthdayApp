import { RESERVED_USERNAMES } from '@bday/shared';
import type { AuthProvider, Prisma, UserRole } from '@prisma/client';
import { shareSlug } from '../lib/crypto';
import { prisma, type Tx } from '../lib/prisma';

/**
 * Everything a brand-new account needs before it can be used.
 *
 * A user without a profile row, privacy row or default wishlist would force a
 * null check into every read path downstream, so all of it is created in the
 * same transaction as the user. If any part fails, no half-built account is
 * left behind.
 */

/** System friend groups every user starts with (spec §9). */
const SYSTEM_GROUPS = [
  { name: 'Family', color: '#F97362', position: 0 },
  { name: 'Close friends', color: '#7C5CFF', position: 1 },
  { name: 'Friends', color: '#2BB3A3', position: 2 },
  { name: 'Colleagues', color: '#3E7BFA', position: 3 },
] as const;

/**
 * Derives an available username from a display name.
 *
 * Collisions are resolved by appending digits rather than by failing, because
 * this runs during social sign-in where there is nobody to prompt.
 */
export async function deriveUsername(seed: string, db: Tx | typeof prisma = prisma): Promise<string> {
  const base =
    seed
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9._]/g, '')
      .replace(/\.{2,}/g, '.')
      .replace(/^\.+|\.+$/g, '')
      .slice(0, 18) || 'friend';

  const candidates = [base.length >= 3 ? base : `${base}bday`.slice(0, 18)];
  for (let i = 0; i < 40; i += 1) {
    candidates.push(`${candidates[0]!.slice(0, 16)}${Math.floor(Math.random() * 9000) + 1000}`);
  }

  for (const candidate of candidates) {
    if ((RESERVED_USERNAMES as readonly string[]).includes(candidate)) continue;
    const taken = await db.user.findUnique({ where: { username: candidate }, select: { id: true } });
    if (!taken) return candidate;
  }
  // Astronomically unlikely; a timestamp suffix is guaranteed distinct.
  return `friend${Date.now().toString(36)}`;
}

export interface ProvisionUserInput {
  email?: string | null;
  phone?: string | null;
  username: string;
  displayName: string;
  passwordHash?: string | null;
  role?: UserRole;
  emailVerified?: boolean;
  phoneVerified?: boolean;
  birthday?: { month: number; day: number; year?: number | null } | null;
  timezone?: string | null;
  countryCode?: string | null;
  identity?: { provider: AuthProvider; providerUserId: string; email?: string | null } | null;
}

export async function provisionUser(tx: Tx, input: ProvisionUserInput) {
  const verified = input.emailVerified === true || input.phoneVerified === true;

  const user = await tx.user.create({
    data: {
      email: input.email ?? null,
      phone: input.phone ?? null,
      username: input.username,
      passwordHash: input.passwordHash ?? null,
      role: input.role ?? 'USER',
      status: verified ? 'ACTIVE' : 'PENDING_VERIFICATION',
      emailVerified: input.emailVerified ?? false,
      phoneVerified: input.phoneVerified ?? false,
      emailVerifiedAt: input.emailVerified ? new Date() : null,
      phoneVerifiedAt: input.phoneVerified ? new Date() : null,
      profile: {
        create: {
          displayName: input.displayName,
          birthMonth: input.birthday?.month ?? null,
          birthDay: input.birthday?.day ?? null,
          birthYear: input.birthday?.year ?? null,
          timezone: input.timezone ?? 'Africa/Nairobi',
          countryCode: input.countryCode ?? 'KE',
        },
      },
      privacy: { create: {} },
      notificationPreference: { create: { timezone: input.timezone ?? 'Africa/Nairobi' } },
      wallet: { create: {} },
      wishlists: {
        create: {
          title: 'My wishlist',
          isDefault: true,
          shareSlug: shareSlug(),
        },
      },
      friendGroups: {
        create: SYSTEM_GROUPS.map((group) => ({ ...group, isSystem: true })),
      },
      ...(input.identity
        ? {
            identities: {
              create: {
                provider: input.identity.provider,
                providerUserId: input.identity.providerUserId,
                email: input.identity.email ?? null,
              },
            },
          }
        : {}),
    },
    select: { id: true, role: true, isPremium: true, username: true },
  });

  return user;
}

/**
 * Links interest slugs to a user, creating any interest rows that the seed did
 * not cover so a client can introduce a new tag without a migration.
 */
export async function setUserInterests(
  tx: Tx,
  userId: string,
  slugs: string[],
): Promise<void> {
  const unique = Array.from(new Set(slugs.map((slug) => slug.trim().toLowerCase()).filter(Boolean)));

  await tx.userInterest.deleteMany({ where: { userId } });
  if (unique.length === 0) return;

  // ON CONFLICT DO NOTHING: two people onboarding at once may both introduce
  // the same new interest, and a plain insert would abort one transaction.
  await tx.interest.createMany({
    data: unique.map((slug) => ({ slug, label: toLabel(slug), isActive: true })),
    skipDuplicates: true,
  });
  const existing = await tx.interest.findMany({
    where: { slug: { in: unique } },
    select: { id: true, slug: true },
  });
  const bySlug = new Map(existing.map((row) => [row.slug, row.id]));

  const data: Prisma.UserInterestCreateManyInput[] = unique
    .map((slug) => bySlug.get(slug))
    .filter((id): id is string => Boolean(id))
    .map((interestId) => ({ userId, interestId }));

  await tx.userInterest.createMany({ data, skipDuplicates: true });
}

function toLabel(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
