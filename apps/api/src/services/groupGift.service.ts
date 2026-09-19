import {
  LIMITS,
  fundingPercent,
  type ContributeInput,
  type ContributionDto,
  type CreateGroupGiftInput,
  type GroupGiftDto,
  type InviteToGroupGiftInput,
  type RevealGroupGiftInput,
  type UpdateGroupGiftInput,
} from '@bday/shared';
import type { GiftContribution, GroupGift, PaymentStatus, Prisma } from '@prisma/client';
import { AppError } from '../lib/errors';
import { prisma, serializableTransaction, type Tx } from '../lib/prisma';
import { RealtimeEvent, emitToGroupGift, emitToUser } from '../realtime/emitter';
import { assertNotBlocked } from './access.service';
import { assertKnownForPhysicalGift } from './global.service';
import { notify, notifyMany } from './notification.service';
import { createPaymentRecord, initiateWithProvider, toPaymentDto } from './payment.service';

/**
 * Group gifting and surprise coordination (spec §14, §15, §49).
 *
 * The defining constraint is spec §58 rule 2: the beneficiary must not be able
 * to see the gift being planned for them. That is enforced in three places at
 * once — they cannot be added as a member, they cannot read the gift, and even
 * when a reveal happens the contributor list is only attached if the organiser
 * chose to share it.
 */

const CONTRIBUTOR_SELECT = {
  id: true,
  username: true,
  profile: { select: { displayName: true, avatarUrl: true } },
} as const;

type GroupGiftRow = GroupGift & {
  organizer: { id: string; username: string; profile: { displayName: string; avatarUrl: string | null } | null };
  beneficiary: { id: string; username: string; profile: { displayName: string; avatarUrl: string | null } | null } | null;
  trackedBirthday: { id: string; name: string; avatarUrl: string | null } | null;
  contributions?: Array<
    GiftContribution & {
      contributor: { id: string; username: string; profile: { displayName: string; avatarUrl: string | null } | null };
    }
  >;
  _count?: { contributions: number };
};

const GROUP_GIFT_INCLUDE = {
  organizer: { select: CONTRIBUTOR_SELECT },
  beneficiary: { select: CONTRIBUTOR_SELECT },
  trackedBirthday: { select: { id: true, name: true, avatarUrl: true } },
  contributions: {
    where: { status: { in: ['PENDING', 'SUCCESSFUL'] as PaymentStatus[] } },
    orderBy: { createdAt: 'desc' as const },
    include: { contributor: { select: CONTRIBUTOR_SELECT } },
  },
  _count: { select: { contributions: { where: { status: 'SUCCESSFUL' as PaymentStatus } } } },
} as const;

function toContributionDto(
  contribution: NonNullable<GroupGiftRow['contributions']>[number],
  viewer: { userId: string; isOrganizer: boolean },
): ContributionDto {
  // Anonymity is kept from other contributors but not from the organiser, who
  // has to reconcile what was actually collected.
  const reveal =
    !contribution.isAnonymous ||
    viewer.isOrganizer ||
    contribution.contributorId === viewer.userId;

  return {
    id: contribution.id,
    amountMinor: contribution.amountMinor,
    currency: contribution.currency,
    isAnonymous: contribution.isAnonymous,
    contributor: reveal
      ? {
          id: contribution.contributor.id,
          displayName: contribution.contributor.profile?.displayName ?? contribution.contributor.username,
          avatarUrl: contribution.contributor.profile?.avatarUrl ?? null,
        }
      : null,
    message: contribution.message,
    status: contribution.status,
    createdAt: contribution.createdAt.toISOString(),
  };
}

function toGroupGiftDto(gift: GroupGiftRow, viewerId: string): GroupGiftDto {
  const isOrganizer = gift.organizerId === viewerId;
  const isBeneficiary = gift.beneficiaryUserId === viewerId;
  const contributions = gift.contributions ?? [];

  // The beneficiary sees a revealed gift, and its contributor list only if the
  // organiser opted to share it.
  const showContributions = !isBeneficiary || (gift.revealedAt != null && gift.revealContributors);

  return {
    id: gift.id,
    title: gift.title,
    status: gift.status,
    targetMinor: gift.targetMinor,
    raisedMinor: gift.raisedMinor,
    currency: gift.currency,
    percentFunded: fundingPercent(
      { amountMinor: gift.raisedMinor, currency: gift.currency as never },
      { amountMinor: gift.targetMinor, currency: gift.currency as never },
    ),
    contributorCount: gift._count?.contributions ?? 0,
    hasContributed: contributions.some((row) => row.contributorId === viewerId),
    deadline: gift.deadline?.toISOString() ?? null,
    description: gift.description,
    imageUrl: gift.imageUrl,
    organizer: {
      id: gift.organizer.id,
      displayName: gift.organizer.profile?.displayName ?? gift.organizer.username,
      avatarUrl: gift.organizer.profile?.avatarUrl ?? null,
    },
    beneficiary: {
      id: gift.beneficiaryUserId,
      name:
        gift.beneficiary?.profile?.displayName ??
        gift.trackedBirthday?.name ??
        gift.beneficiaryName,
      avatarUrl: gift.beneficiary?.profile?.avatarUrl ?? gift.trackedBirthday?.avatarUrl ?? null,
    },
    wishlistItemId: gift.wishlistItemId,
    productId: gift.productId,
    contributions: showContributions
      ? contributions.map((row) => toContributionDto(row, { userId: viewerId, isOrganizer }))
      : [],
    conversationId: gift.conversationId,
    minContributionMinor: gift.minContributionMinor,
    isOrganizer,
    createdAt: gift.createdAt.toISOString(),
  };
}

/* ------------------------------ access rules ------------------------------ */

async function loadForViewer(giftId: string, viewerId: string): Promise<GroupGiftRow> {
  const gift = (await prisma.groupGift.findUnique({
    where: { id: giftId },
    include: GROUP_GIFT_INCLUDE,
  })) as GroupGiftRow | null;
  if (!gift) throw new AppError('NOT_FOUND', { message: 'That group gift no longer exists.' });

  const isBeneficiary = gift.beneficiaryUserId === viewerId;
  if (isBeneficiary && gift.revealedAt == null) {
    // Deliberately NOT_FOUND: a FORBIDDEN would confirm that a surprise for
    // them exists, which is the one thing that must stay hidden.
    throw new AppError('NOT_FOUND', { message: 'That group gift no longer exists.' });
  }

  if (gift.organizerId === viewerId || isBeneficiary) return gift;

  const member = await prisma.groupGiftMember.findUnique({
    where: { groupGiftId_userId: { groupGiftId: giftId, userId: viewerId } },
    select: { userId: true },
  });
  if (!member) throw new AppError('NOT_GROUP_MEMBER');
  return gift;
}

async function assertOrganizer(giftId: string, userId: string): Promise<GroupGift> {
  const gift = await prisma.groupGift.findUnique({ where: { id: giftId } });
  if (!gift) throw new AppError('NOT_FOUND');
  if (gift.organizerId !== userId) {
    const admin = await prisma.groupGiftMember.findUnique({
      where: { groupGiftId_userId: { groupGiftId: giftId, userId } },
      select: { isAdmin: true },
    });
    if (!admin?.isAdmin) throw new AppError('FORBIDDEN', { message: 'Only the organiser can do that.' });
  }
  return gift;
}

/* ------------------------------- creation ------------------------------- */

/** Resolves who the gift is for, from whichever of the three inputs was given. */
async function resolveBeneficiary(
  organizerId: string,
  input: { beneficiaryUserId?: string; trackedBirthdayId?: string; beneficiaryName?: string },
): Promise<{ beneficiaryUserId: string | null; trackedBirthdayId: string | null; beneficiaryName: string }> {
  if (input.beneficiaryUserId) {
    if (input.beneficiaryUserId === organizerId) {
      throw new AppError('BIRTHDAY_PERSON_EXCLUDED', {
        message: 'You cannot organise a surprise for yourself.',
      });
    }
    const user = await prisma.user.findFirst({
      where: { id: input.beneficiaryUserId, deletedAt: null },
      select: { id: true, username: true, profile: { select: { displayName: true } } },
    });
    if (!user) throw new AppError('NOT_FOUND', { message: 'That account could not be found.' });
    await assertNotBlocked(organizerId, user.id);
    await assertKnownForPhysicalGift(organizerId, user.id);
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

export async function createGroupGift(
  organizerId: string,
  input: CreateGroupGiftInput,
): Promise<GroupGiftDto> {
  const beneficiary = await resolveBeneficiary(organizerId, input);

  if (beneficiary.beneficiaryUserId && input.inviteUserIds.includes(beneficiary.beneficiaryUserId)) {
    throw new AppError('BIRTHDAY_PERSON_EXCLUDED');
  }

  if (input.wishlistItemId) {
    const item = await prisma.wishlistItem.findFirst({
      where: { id: input.wishlistItemId, deletedAt: null },
      select: { id: true, wishlist: { select: { ownerId: true } } },
    });
    if (!item) throw new AppError('WISHLIST_ITEM_NOT_FOUND');
    if (item.wishlist.ownerId === organizerId) throw new AppError('CANNOT_RESERVE_OWN_ITEM');
  }

  const organizer = await prisma.user.findUnique({
    where: { id: organizerId },
    select: { isPremium: true, username: true, profile: { select: { displayName: true } } },
  });
  const memberCap = organizer?.isPremium
    ? LIMITS.groupGiftMembers.premium
    : LIMITS.groupGiftMembers.free;
  if (input.inviteUserIds.length + 1 > memberCap) {
    throw new AppError('FORBIDDEN', {
      message: `Group gifts can have up to ${memberCap} people. Upgrade for larger groups.`,
    });
  }

  const giftId = await prisma.$transaction(async (tx) => {
    let conversationId: string | null = null;

    if (input.createSurpriseGroup) {
      // The planning chat exists only for the people organising it — the
      // beneficiary is never added as a member (spec §14).
      const conversation = await tx.conversation.create({
        data: {
          type: 'SURPRISE_GROUP',
          title: `${beneficiary.beneficiaryName}'s surprise`,
          createdById: organizerId,
          members: {
            create: [
              { userId: organizerId, isAdmin: true },
              ...input.inviteUserIds
                .filter((id) => id !== organizerId && id !== beneficiary.beneficiaryUserId)
                .map((userId) => ({ userId })),
            ],
          },
        },
        select: { id: true },
      });
      conversationId = conversation.id;
    }

    const gift = await tx.groupGift.create({
      data: {
        organizerId,
        beneficiaryUserId: beneficiary.beneficiaryUserId,
        trackedBirthdayId: beneficiary.trackedBirthdayId,
        beneficiaryName: beneficiary.beneficiaryName,
        title: input.title,
        description: input.description ?? null,
        imageUrl: input.imageUrl ?? null,
        targetMinor: input.targetMinor,
        currency: input.currency,
        deadline: input.deadline ? new Date(input.deadline) : null,
        minContributionMinor: input.minContributionMinor,
        wishlistItemId: input.wishlistItemId ?? null,
        productId: input.productId ?? null,
        conversationId,
        members: {
          create: [
            { userId: organizerId, isAdmin: true, joinedAt: new Date() },
            ...input.inviteUserIds
              .filter((id) => id !== organizerId && id !== beneficiary.beneficiaryUserId)
              .map((userId) => ({ userId })),
          ],
        },
      },
      select: { id: true },
    });

    return gift.id;
  });

  const organizerName = organizer?.profile?.displayName ?? organizer?.username ?? 'A friend';
  await notifyMany(
    input.inviteUserIds.filter((id) => id !== organizerId && id !== beneficiary.beneficiaryUserId),
    {
      type: 'GROUP_GIFT_INVITE',
      title: 'You are invited to a group gift',
      body: `${organizerName} is organising “${input.title}” for ${beneficiary.beneficiaryName}.`,
      deepLink: `group-gift/${giftId}`,
      data: { groupGiftId: giftId },
    },
  );

  const gift = (await prisma.groupGift.findUnique({
    where: { id: giftId },
    include: GROUP_GIFT_INCLUDE,
  })) as GroupGiftRow;
  return toGroupGiftDto(gift, organizerId);
}

/* ------------------------------- reading ------------------------------- */

export async function getGroupGift(viewerId: string, giftId: string): Promise<GroupGiftDto> {
  const gift = await loadForViewer(giftId, viewerId);
  return toGroupGiftDto(gift, viewerId);
}

/**
 * Group gifts the caller takes part in.
 *
 * Gifts where they are the beneficiary are excluded unless already revealed —
 * otherwise the list itself would spoil the surprise.
 */
export async function listMyGroupGifts(userId: string): Promise<GroupGiftDto[]> {
  const gifts = (await prisma.groupGift.findMany({
    where: {
      OR: [
        { organizerId: userId },
        { members: { some: { userId } } },
        { beneficiaryUserId: userId, revealedAt: { not: null } },
      ],
      NOT: { beneficiaryUserId: userId, revealedAt: null },
    },
    orderBy: { createdAt: 'desc' },
    include: GROUP_GIFT_INCLUDE,
  })) as GroupGiftRow[];

  return gifts.map((gift) => toGroupGiftDto(gift, userId));
}

/* ------------------------------ mutations ------------------------------ */

export async function updateGroupGift(
  userId: string,
  giftId: string,
  input: UpdateGroupGiftInput,
): Promise<GroupGiftDto> {
  const gift = await assertOrganizer(giftId, userId);
  if (gift.status === 'CANCELLED' || gift.status === 'REVEALED') {
    throw new AppError('GROUP_GIFT_CLOSED');
  }

  if (input.targetMinor != null && input.targetMinor < gift.raisedMinor) {
    throw new AppError('CONFLICT', {
      message: 'The goal cannot be lower than what has already been raised.',
    });
  }

  await prisma.groupGift.update({
    where: { id: giftId },
    data: {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description ?? null } : {}),
      ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl ?? null } : {}),
      ...(input.targetMinor !== undefined ? { targetMinor: input.targetMinor } : {}),
      ...(input.deadline !== undefined
        ? { deadline: input.deadline ? new Date(input.deadline) : null }
        : {}),
      ...(input.minContributionMinor !== undefined
        ? { minContributionMinor: input.minContributionMinor }
        : {}),
    },
  });

  const updated = await loadForViewer(giftId, userId);
  emitToGroupGift(giftId, RealtimeEvent.GROUP_GIFT_UPDATED, { groupGiftId: giftId });
  return toGroupGiftDto(updated, userId);
}

export async function inviteToGroupGift(
  userId: string,
  giftId: string,
  input: InviteToGroupGiftInput,
): Promise<void> {
  const gift = await assertOrganizer(giftId, userId);

  const invitees = input.userIds.filter(
    (id) => id !== gift.beneficiaryUserId && id !== gift.organizerId,
  );
  if (invitees.length !== input.userIds.length && gift.beneficiaryUserId) {
    throw new AppError('BIRTHDAY_PERSON_EXCLUDED');
  }

  await prisma.$transaction(async (tx) => {
    await tx.groupGiftMember.createMany({
      data: invitees.map((memberId) => ({ groupGiftId: giftId, userId: memberId })),
      skipDuplicates: true,
    });
    if (gift.conversationId) {
      await tx.conversationMember.createMany({
        data: invitees.map((memberId) => ({ conversationId: gift.conversationId!, userId: memberId })),
        skipDuplicates: true,
      });
    }
  });

  await notifyMany(invitees, {
    type: 'GROUP_GIFT_INVITE',
    title: 'You are invited to a group gift',
    body: `Join “${gift.title}” for ${gift.beneficiaryName}.`,
    deepLink: `group-gift/${giftId}`,
    data: { groupGiftId: giftId },
  });
}

export async function leaveGroupGift(userId: string, giftId: string): Promise<void> {
  const gift = await prisma.groupGift.findUnique({
    where: { id: giftId },
    select: { organizerId: true, conversationId: true },
  });
  if (!gift) throw new AppError('NOT_FOUND');
  if (gift.organizerId === userId) {
    throw new AppError('FORBIDDEN', { message: 'The organiser cannot leave. Cancel the gift instead.' });
  }

  const contributed = await prisma.giftContribution.count({
    where: { groupGiftId: giftId, contributorId: userId, status: 'SUCCESSFUL' },
  });
  if (contributed > 0) {
    throw new AppError('CONFLICT', {
      message: 'You have already contributed. Ask the organiser for a refund instead.',
    });
  }

  await prisma.groupGiftMember.deleteMany({ where: { groupGiftId: giftId, userId } });
  if (gift.conversationId) {
    await prisma.conversationMember.updateMany({
      where: { conversationId: gift.conversationId, userId },
      data: { leftAt: new Date() },
    });
  }
}

export async function cancelGroupGift(userId: string, giftId: string): Promise<void> {
  const gift = await assertOrganizer(giftId, userId);
  if (gift.raisedMinor > 0) {
    throw new AppError('CONFLICT', {
      message: 'Money has already been collected. Contact support to arrange refunds.',
    });
  }
  await prisma.groupGift.update({ where: { id: giftId }, data: { status: 'CANCELLED' } });
}

/* ----------------------------- contributions ----------------------------- */

export interface ContributeResult {
  contributionId: string;
  payment: ReturnType<typeof toPaymentDto>;
}

/**
 * Contribute to a group gift (spec §15, §58 rule 4).
 *
 * The contribution row is written PENDING alongside its payment, and
 * `raisedMinor` does not move until the provider confirms. Over-funding is
 * checked against settled money plus in-flight attempts, so a burst of
 * simultaneous contributions cannot collectively blow past the goal.
 */
export async function contribute(
  contributorId: string,
  giftId: string,
  input: ContributeInput,
): Promise<ContributeResult> {
  const gift = await prisma.groupGift.findUnique({
    where: { id: giftId },
    select: {
      id: true,
      title: true,
      status: true,
      currency: true,
      targetMinor: true,
      raisedMinor: true,
      minContributionMinor: true,
      deadline: true,
      organizerId: true,
      beneficiaryUserId: true,
      beneficiaryName: true,
    },
  });
  if (!gift) throw new AppError('NOT_FOUND', { message: 'That group gift no longer exists.' });
  if (gift.beneficiaryUserId === contributorId) throw new AppError('BIRTHDAY_PERSON_EXCLUDED');
  if (gift.status !== 'OPEN') throw new AppError('GROUP_GIFT_CLOSED');
  if (gift.deadline && gift.deadline.getTime() < Date.now()) throw new AppError('GROUP_GIFT_CLOSED');
  if (input.currency !== gift.currency) {
    throw new AppError('CURRENCY_MISMATCH', { message: `This gift is collecting in ${gift.currency}.` });
  }
  if (input.amountMinor < gift.minContributionMinor) {
    throw new AppError('CONTRIBUTION_TOO_SMALL');
  }

  const { contributionId, paymentId } = await serializableTransaction(async (tx) => {
    const existing = await tx.giftContribution.findUnique({
      where: { idempotencyKey: `${contributorId}:${input.idempotencyKey}` },
      select: { id: true, paymentId: true },
    });
    if (existing?.paymentId) {
      return { contributionId: existing.id, paymentId: existing.paymentId };
    }

    const inFlight = await tx.giftContribution.aggregate({
      where: { groupGiftId: giftId, status: { in: ['PENDING', 'SUCCESSFUL'] } },
      _sum: { amountMinor: true },
    });
    const committed = inFlight._sum.amountMinor ?? 0;
    if (committed + input.amountMinor > gift.targetMinor) {
      const remaining = Math.max(0, gift.targetMinor - committed);
      throw new AppError('GROUP_GIFT_TARGET_EXCEEDED', {
        message:
          remaining === 0
            ? 'This gift is already fully funded.'
            : `Only ${remaining / 100} left to raise — reduce your amount.`,
      });
    }

    const payment = await createPaymentRecord({
      userId: contributorId,
      provider: input.provider,
      amountMinor: input.amountMinor,
      currency: input.currency,
      purpose: 'GROUP_CONTRIBUTION',
      referenceType: 'GROUP_GIFT',
      referenceId: giftId,
      idempotencyKey: input.idempotencyKey,
      description: `Contribution to ${gift.title}`,
      db: tx,
    });

    const contribution = await tx.giftContribution.create({
      data: {
        groupGiftId: giftId,
        contributorId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        isAnonymous: input.isAnonymous,
        message: input.message ?? null,
        paymentId: payment.id,
        idempotencyKey: `${contributorId}:${input.idempotencyKey}`,
      },
      select: { id: true },
    });

    return { contributionId: contribution.id, paymentId: payment.id };
  });

  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } });
  const dto = await initiateWithProvider(payment, {
    description: `Contribution to ${gift.title}`,
    payerPhone: input.payerPhone ?? null,
  });

  return { contributionId, payment: dto };
}

export async function listContributions(
  viewerId: string,
  giftId: string,
): Promise<ContributionDto[]> {
  const gift = await loadForViewer(giftId, viewerId);
  const isBeneficiary = gift.beneficiaryUserId === viewerId;
  if (isBeneficiary && !(gift.revealedAt && gift.revealContributors)) {
    throw new AppError('OWNER_CANNOT_VIEW_RESERVATIONS', {
      message: 'Surprise! You cannot see who contributed yet.',
    });
  }
  return (gift.contributions ?? []).map((row) =>
    toContributionDto(row, { userId: viewerId, isOrganizer: gift.organizerId === viewerId }),
  );
}

/** The caller's own contributions, which they may always see. */
export async function listMyContributions(userId: string) {
  const rows = await prisma.giftContribution.findMany({
    where: { contributorId: userId },
    orderBy: { createdAt: 'desc' },
    include: { groupGift: { select: { id: true, title: true, beneficiaryName: true, status: true } } },
  });
  return rows.map((row) => ({
    id: row.id,
    amountMinor: row.amountMinor,
    currency: row.currency,
    status: row.status,
    isAnonymous: row.isAnonymous,
    createdAt: row.createdAt.toISOString(),
    groupGift: row.groupGift,
  }));
}

/* -------------------------------- reveal -------------------------------- */

/**
 * Reveals the surprise (spec §49 step 8).
 *
 * Until this runs, the beneficiary cannot load the gift at all. Afterwards they
 * can, and they see the contributor list only if `revealContributors` is set.
 */
export async function revealGroupGift(
  userId: string,
  giftId: string,
  input: RevealGroupGiftInput,
): Promise<GroupGiftDto> {
  const gift = await assertOrganizer(giftId, userId);
  if (gift.revealedAt) throw new AppError('CONFLICT', { message: 'This gift has already been revealed.' });

  await prisma.$transaction(async (tx) => {
    await tx.groupGift.update({
      where: { id: giftId },
      data: {
        status: 'REVEALED',
        revealedAt: new Date(),
        revealMessage: input.message ?? null,
        revealContributors: input.revealContributors,
      },
    });
    if (gift.beneficiaryUserId) {
      await writeGroupGiftHistory(tx, giftId, gift.beneficiaryUserId);
    }
  });

  if (gift.beneficiaryUserId) {
    await notify({
      userId: gift.beneficiaryUserId,
      type: 'GIFT_RECEIVED',
      title: '🎁 A surprise for you!',
      body: input.message ?? `Your friends got together to give you “${gift.title}”.`,
      deepLink: `group-gift/${giftId}`,
      data: { groupGiftId: giftId },
    }).catch(() => undefined);
    emitToUser(gift.beneficiaryUserId, RealtimeEvent.GROUP_GIFT_UPDATED, { groupGiftId: giftId });
  }

  const revealed = await loadForViewer(giftId, userId);
  return toGroupGiftDto(revealed, userId);
}

/**
 * Ledger rows for a revealed group gift.
 *
 * The recipient gets one "received" row naming the group; each contributor gets
 * a "sent" row for their own share. `skipDuplicates` plus the unique index make
 * a repeated reveal harmless.
 */
async function writeGroupGiftHistory(tx: Tx, giftId: string, beneficiaryId: string): Promise<void> {
  const gift = await tx.groupGift.findUnique({
    where: { id: giftId },
    select: {
      title: true,
      imageUrl: true,
      currency: true,
      raisedMinor: true,
      contributions: {
        where: { status: 'SUCCESSFUL' },
        select: { contributorId: true, amountMinor: true, isAnonymous: true },
      },
    },
  });
  if (!gift) return;

  const beneficiary = await tx.user.findUnique({
    where: { id: beneficiaryId },
    select: { username: true, profile: { select: { displayName: true } } },
  });
  const year = new Date().getFullYear();

  const rows: Prisma.GiftHistoryEntryCreateManyInput[] = [
    {
      userId: beneficiaryId,
      direction: 'RECEIVED',
      title: gift.title,
      imageUrl: gift.imageUrl,
      counterpartyName: 'Group gift',
      celebrationYear: year,
      priceMinor: gift.raisedMinor,
      currency: gift.currency,
      priceHidden: true,
      source: 'GROUP_GIFT',
      sourceId: giftId,
    },
    ...gift.contributions.map((contribution) => ({
      userId: contribution.contributorId,
      direction: 'SENT' as const,
      title: gift.title,
      imageUrl: gift.imageUrl,
      counterpartyUserId: beneficiaryId,
      counterpartyName: beneficiary?.profile?.displayName ?? beneficiary?.username ?? null,
      celebrationYear: year,
      priceMinor: contribution.amountMinor,
      currency: gift.currency,
      priceHidden: false,
      source: 'GROUP_GIFT' as const,
      sourceId: giftId,
    })),
  ];

  await tx.giftHistoryEntry.createMany({ data: rows, skipDuplicates: true });
}

/** Marks a funded gift as bought, so the group can see it was actioned. */
export async function markGroupGiftPurchased(userId: string, giftId: string): Promise<GroupGiftDto> {
  const gift = await assertOrganizer(giftId, userId);
  if (gift.status !== 'FUNDED' && gift.status !== 'OPEN') throw new AppError('GROUP_GIFT_CLOSED');
  await prisma.groupGift.update({ where: { id: giftId }, data: { status: 'PURCHASED' } });
  const updated = await loadForViewer(giftId, userId);
  emitToGroupGift(giftId, RealtimeEvent.GROUP_GIFT_UPDATED, { groupGiftId: giftId });
  return toGroupGiftDto(updated, userId);
}
