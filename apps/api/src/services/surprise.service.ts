import type { CreateSurpriseInput, SurpriseDto } from '@bday/shared';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { notifyMany } from './notification.service';

/**
 * Surprise mode (spec §14, §49).
 *
 * A surprise is a private planning group with a beneficiary who is never in it.
 * The exclusion is enforced on creation, on every join, and on every read — a
 * beneficiary asking for their own surprise gets NOT_FOUND, never a hint that
 * one exists.
 */

const MEMBER_SELECT = {
  id: true,
  username: true,
  profile: { select: { displayName: true, avatarUrl: true } },
} as const;

type SurpriseRow = {
  id: string;
  title: string;
  organizerId: string;
  beneficiaryUserId: string | null;
  beneficiaryName: string;
  budgetMinor: number | null;
  currency: string;
  conversationId: string | null;
  revealedAt: Date | null;
  createdAt: Date;
  beneficiary: { id: string; username: string; profile: { displayName: string; avatarUrl: string | null } | null } | null;
  trackedBirthday: { name: string; avatarUrl: string | null } | null;
  _count: { members: number };
  groupGifts: Array<{ id: string }>;
};

const SURPRISE_INCLUDE = {
  beneficiary: { select: MEMBER_SELECT },
  trackedBirthday: { select: { name: true, avatarUrl: true } },
  _count: { select: { members: true } },
  groupGifts: { select: { id: true }, take: 1, orderBy: { createdAt: 'desc' as const } },
} as const;

function toSurpriseDto(row: SurpriseRow): SurpriseDto {
  return {
    id: row.id,
    title: row.title,
    beneficiary: {
      id: row.beneficiaryUserId,
      name: row.beneficiary?.profile?.displayName ?? row.trackedBirthday?.name ?? row.beneficiaryName,
      avatarUrl: row.beneficiary?.profile?.avatarUrl ?? row.trackedBirthday?.avatarUrl ?? null,
    },
    organizerId: row.organizerId,
    memberCount: row._count.members,
    budgetMinor: row.budgetMinor,
    currency: row.currency,
    conversationId: row.conversationId ?? '',
    groupGiftId: row.groupGifts[0]?.id ?? null,
    revealedAt: row.revealedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function resolveBeneficiary(
  organizerId: string,
  input: CreateSurpriseInput,
): Promise<{ beneficiaryUserId: string | null; trackedBirthdayId: string | null; beneficiaryName: string }> {
  if (input.beneficiaryUserId) {
    if (input.beneficiaryUserId === organizerId) throw new AppError('BIRTHDAY_PERSON_EXCLUDED');
    const user = await prisma.user.findFirst({
      where: { id: input.beneficiaryUserId, deletedAt: null },
      select: { id: true, username: true, profile: { select: { displayName: true } } },
    });
    if (!user) throw new AppError('NOT_FOUND');
    return {
      beneficiaryUserId: user.id,
      trackedBirthdayId: null,
      beneficiaryName: user.profile?.displayName ?? user.username,
    };
  }
  if (input.trackedBirthdayId) {
    const tracked = await prisma.trackedBirthday.findFirst({
      where: { id: input.trackedBirthdayId, ownerId: organizerId, deletedAt: null },
      select: { id: true, name: true, linkedUserId: true },
    });
    if (!tracked) throw new AppError('NOT_FOUND', { message: 'That birthday is not on your calendar.' });
    return {
      beneficiaryUserId: tracked.linkedUserId,
      trackedBirthdayId: tracked.id,
      beneficiaryName: tracked.name,
    };
  }
  return { beneficiaryUserId: null, trackedBirthdayId: null, beneficiaryName: input.beneficiaryName! };
}

export async function createSurprise(
  organizerId: string,
  input: CreateSurpriseInput,
): Promise<SurpriseDto> {
  const beneficiary = await resolveBeneficiary(organizerId, input);

  if (beneficiary.beneficiaryUserId && input.memberIds.includes(beneficiary.beneficiaryUserId)) {
    throw new AppError('BIRTHDAY_PERSON_EXCLUDED');
  }

  const members = Array.from(
    new Set(
      input.memberIds.filter(
        (id) => id !== organizerId && id !== beneficiary.beneficiaryUserId,
      ),
    ),
  );

  const surpriseId = await prisma.$transaction(async (tx) => {
    const conversation = await tx.conversation.create({
      data: {
        type: 'SURPRISE_GROUP',
        title: input.title,
        createdById: organizerId,
        members: {
          create: [
            { userId: organizerId, isAdmin: true },
            ...members.map((userId) => ({ userId })),
          ],
        },
      },
      select: { id: true },
    });

    const surprise = await tx.surprise.create({
      data: {
        title: input.title,
        organizerId,
        beneficiaryUserId: beneficiary.beneficiaryUserId,
        trackedBirthdayId: beneficiary.trackedBirthdayId,
        beneficiaryName: beneficiary.beneficiaryName,
        budgetMinor: input.budgetMinor ?? null,
        currency: input.currency,
        conversationId: conversation.id,
        members: {
          create: [
            { userId: organizerId, isAdmin: true },
            ...members.map((userId) => ({ userId })),
          ],
        },
      },
      select: { id: true },
    });

    await tx.message.create({
      data: {
        conversationId: conversation.id,
        kind: 'SYSTEM',
        body: `Planning started for ${beneficiary.beneficiaryName}. They cannot see this chat.`,
      },
    });

    return surprise.id;
  });

  await notifyMany(members, {
    type: 'GROUP_GIFT_INVITE',
    title: 'You are in on a surprise 🤫',
    body: `${input.title} — for ${beneficiary.beneficiaryName}.`,
    deepLink: `surprise/${surpriseId}`,
    data: { surpriseId },
  });

  return getSurprise(organizerId, surpriseId);
}

export async function getSurprise(viewerId: string, surpriseId: string): Promise<SurpriseDto> {
  const surprise = (await prisma.surprise.findUnique({
    where: { id: surpriseId },
    include: SURPRISE_INCLUDE,
  })) as SurpriseRow | null;
  if (!surprise) throw new AppError('NOT_FOUND');

  // The beneficiary must not be able to confirm this exists, even by error code.
  if (surprise.beneficiaryUserId === viewerId && surprise.revealedAt == null) {
    throw new AppError('NOT_FOUND');
  }

  if (surprise.organizerId !== viewerId) {
    const member = await prisma.surpriseMember.findUnique({
      where: { surpriseId_userId: { surpriseId, userId: viewerId } },
      select: { userId: true },
    });
    if (!member) throw new AppError('NOT_FOUND');
  }

  return toSurpriseDto(surprise);
}

export async function listMySurprises(userId: string): Promise<SurpriseDto[]> {
  const rows = (await prisma.surprise.findMany({
    where: {
      OR: [{ organizerId: userId }, { members: { some: { userId } } }],
      // Never list a surprise the caller is the subject of.
      NOT: { beneficiaryUserId: userId },
    },
    orderBy: { createdAt: 'desc' },
    include: SURPRISE_INCLUDE,
  })) as SurpriseRow[];
  return rows.map(toSurpriseDto);
}

export async function addSurpriseMembers(
  userId: string,
  surpriseId: string,
  memberIds: string[],
): Promise<void> {
  const surprise = await prisma.surprise.findUnique({
    where: { id: surpriseId },
    select: { organizerId: true, beneficiaryUserId: true, conversationId: true },
  });
  if (!surprise) throw new AppError('NOT_FOUND');

  if (surprise.organizerId !== userId) {
    const admin = await prisma.surpriseMember.findUnique({
      where: { surpriseId_userId: { surpriseId, userId } },
      select: { isAdmin: true },
    });
    if (!admin?.isAdmin) throw new AppError('FORBIDDEN');
  }

  if (surprise.beneficiaryUserId && memberIds.includes(surprise.beneficiaryUserId)) {
    throw new AppError('BIRTHDAY_PERSON_EXCLUDED');
  }

  const additions = memberIds.filter((id) => id !== surprise.beneficiaryUserId);

  await prisma.$transaction(async (tx) => {
    await tx.surpriseMember.createMany({
      data: additions.map((memberId) => ({ surpriseId, userId: memberId })),
      skipDuplicates: true,
    });
    if (surprise.conversationId) {
      await tx.conversationMember.createMany({
        data: additions.map((memberId) => ({
          conversationId: surprise.conversationId!,
          userId: memberId,
        })),
        skipDuplicates: true,
      });
    }
  });

  await notifyMany(additions, {
    type: 'GROUP_GIFT_INVITE',
    title: 'You are in on a surprise 🤫',
    body: 'You have been added to a birthday surprise group.',
    deepLink: `surprise/${surpriseId}`,
    data: { surpriseId },
  });
}

export async function leaveSurprise(userId: string, surpriseId: string): Promise<void> {
  const surprise = await prisma.surprise.findUnique({
    where: { id: surpriseId },
    select: { organizerId: true, conversationId: true },
  });
  if (!surprise) throw new AppError('NOT_FOUND');
  if (surprise.organizerId === userId) {
    throw new AppError('FORBIDDEN', { message: 'The organiser cannot leave their own surprise.' });
  }

  await prisma.surpriseMember.deleteMany({ where: { surpriseId, userId } });
  if (surprise.conversationId) {
    await prisma.conversationMember.updateMany({
      where: { conversationId: surprise.conversationId, userId },
      data: { leftAt: new Date() },
    });
  }
}

/** Links a group gift to a surprise, so the planning chat and money line up. */
export async function attachGroupGift(
  userId: string,
  surpriseId: string,
  groupGiftId: string,
): Promise<void> {
  const surprise = await prisma.surprise.findUnique({
    where: { id: surpriseId },
    select: { organizerId: true },
  });
  if (!surprise) throw new AppError('NOT_FOUND');
  if (surprise.organizerId !== userId) throw new AppError('FORBIDDEN');

  const gift = await prisma.groupGift.findUnique({
    where: { id: groupGiftId },
    select: { organizerId: true },
  });
  if (!gift) throw new AppError('NOT_FOUND');
  if (gift.organizerId !== userId) throw new AppError('FORBIDDEN');

  await prisma.groupGift.update({ where: { id: groupGiftId }, data: { surpriseId } });
}

export async function markSurpriseRevealed(userId: string, surpriseId: string): Promise<void> {
  const surprise = await prisma.surprise.findUnique({
    where: { id: surpriseId },
    select: { organizerId: true, revealedAt: true },
  });
  if (!surprise) throw new AppError('NOT_FOUND');
  if (surprise.organizerId !== userId) throw new AppError('FORBIDDEN');
  if (surprise.revealedAt) return;
  await prisma.surprise.update({ where: { id: surpriseId }, data: { revealedAt: new Date() } });
}
