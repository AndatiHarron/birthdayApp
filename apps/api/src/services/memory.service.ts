import type {
  CreateGiftHistoryEntryInput,
  CreateMemoryInput,
  GiftHistoryEntryDto,
  MemoryDto,
  UpdateMemoryInput,
} from '@bday/shared';
import type { GiftHistoryEntry, Memory, MemoryMedia, Prisma } from '@prisma/client';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { canSee, privacyOrDefaults, viewerContext } from './access.service';

/**
 * Birthday memories and the private gift ledger (spec §25, §26).
 *
 * One memory per user per year — the unique index says so — because the
 * product idea is a yearly album, not a stream. Adding photos to last year's
 * birthday should edit that album rather than start a second one.
 */

type MemoryRow = Memory & { media: MemoryMedia[] };

async function memoryCounts(userId: string, year: number) {
  const [giftCount, wishCount] = await Promise.all([
    prisma.giftHistoryEntry.count({
      where: { userId, direction: 'RECEIVED', celebrationYear: year },
    }),
    prisma.birthdayMessage.count({
      where: { recipientUserId: userId, celebrationYear: year },
    }),
  ]);
  return { giftCount, wishCount };
}

async function toMemoryDto(row: MemoryRow): Promise<MemoryDto> {
  const counts = await memoryCounts(row.userId, row.celebrationYear);
  return {
    id: row.id,
    userId: row.userId,
    celebrationYear: row.celebrationYear,
    title: row.title,
    note: row.note,
    media: row.media
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((item) => ({
        id: item.id,
        url: item.url,
        kind: item.kind,
        caption: item.caption,
      })),
    giftCount: counts.giftCount,
    wishCount: counts.wishCount,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function createOrUpdateMemory(
  userId: string,
  input: CreateMemoryInput,
): Promise<MemoryDto> {
  const row = await prisma.$transaction(async (tx) => {
    const memory = await tx.memory.upsert({
      where: { userId_celebrationYear: { userId, celebrationYear: input.celebrationYear } },
      create: {
        userId,
        celebrationYear: input.celebrationYear,
        title: input.title ?? null,
        note: input.note ?? null,
        visibility: input.visibility,
      },
      update: {
        title: input.title ?? null,
        note: input.note ?? null,
        visibility: input.visibility,
      },
      select: { id: true },
    });

    if (input.media.length > 0) {
      const existing = await tx.memoryMedia.count({ where: { memoryId: memory.id } });
      await tx.memoryMedia.createMany({
        data: input.media.map((item, index) => ({
          memoryId: memory.id,
          url: item.url,
          kind: item.kind,
          caption: item.caption ?? null,
          position: existing + index,
        })),
      });
    }

    return tx.memory.findUniqueOrThrow({
      where: { id: memory.id },
      include: { media: true },
    });
  });

  return toMemoryDto(row);
}

export async function updateMemory(
  userId: string,
  memoryId: string,
  input: UpdateMemoryInput,
): Promise<MemoryDto> {
  const memory = await prisma.memory.findFirst({
    where: { id: memoryId, userId },
    select: { id: true },
  });
  if (!memory) throw new AppError('NOT_FOUND');

  const data: Prisma.MemoryUpdateInput = {};
  if (input.title !== undefined) data.title = input.title ?? null;
  if (input.note !== undefined) data.note = input.note ?? null;
  if (input.visibility !== undefined) data.visibility = input.visibility;

  const row = await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length > 0) {
      await tx.memory.update({ where: { id: memoryId }, data });
    }
    if (input.media && input.media.length > 0) {
      const existing = await tx.memoryMedia.count({ where: { memoryId } });
      await tx.memoryMedia.createMany({
        data: input.media.map((item, index) => ({
          memoryId,
          url: item.url,
          kind: item.kind,
          caption: item.caption ?? null,
          position: existing + index,
        })),
      });
    }
    return tx.memory.findUniqueOrThrow({ where: { id: memoryId }, include: { media: true } });
  });

  return toMemoryDto(row);
}

export async function deleteMemoryMedia(userId: string, mediaId: string): Promise<void> {
  const media = await prisma.memoryMedia.findFirst({
    where: { id: mediaId, memory: { userId } },
    select: { id: true },
  });
  if (!media) throw new AppError('NOT_FOUND');
  await prisma.memoryMedia.delete({ where: { id: mediaId } });
}

export async function deleteMemory(userId: string, memoryId: string): Promise<void> {
  const result = await prisma.memory.deleteMany({ where: { id: memoryId, userId } });
  if (result.count === 0) throw new AppError('NOT_FOUND');
}

export async function listMemories(viewerId: string, ownerId: string): Promise<MemoryDto[]> {
  const context = await viewerContext(viewerId, ownerId);
  if (context.isBlocked) throw new AppError('NOT_FOUND');

  const rows = await prisma.memory.findMany({
    where: { userId: ownerId },
    orderBy: { celebrationYear: 'desc' },
    include: { media: true },
  });

  // Each album carries its own visibility, so a private year stays private
  // inside an otherwise shared history.
  const visible = rows.filter((row) => canSee(row.visibility, context));
  return Promise.all(visible.map(toMemoryDto));
}

export async function getMemory(viewerId: string, memoryId: string): Promise<MemoryDto> {
  const row = await prisma.memory.findUnique({
    where: { id: memoryId },
    include: { media: true },
  });
  if (!row) throw new AppError('NOT_FOUND');

  const context = await viewerContext(viewerId, row.userId);
  if (!canSee(row.visibility, context)) throw new AppError('FORBIDDEN');
  return toMemoryDto(row);
}

/* ----------------------------- gift history ----------------------------- */

function toGiftHistoryDto(
  row: GiftHistoryEntry & {
    counterparty: { id: string; username: string; profile: { displayName: string; avatarUrl: string | null } | null } | null;
  },
  options: { hidePrice: boolean },
): GiftHistoryEntryDto {
  const hidePrice = options.hidePrice || row.priceHidden;
  return {
    id: row.id,
    direction: row.direction,
    title: row.title,
    imageUrl: row.imageUrl,
    counterparty: row.counterparty
      ? {
          id: row.counterparty.id,
          displayName: row.counterparty.profile?.displayName ?? row.counterparty.username,
          avatarUrl: row.counterparty.profile?.avatarUrl ?? null,
        }
      : row.counterpartyName
        ? { id: null, displayName: row.counterpartyName, avatarUrl: null }
        : null,
    occasion: row.occasion,
    celebrationYear: row.celebrationYear,
    priceMinor: hidePrice ? null : row.priceMinor,
    currency: hidePrice ? null : row.currency,
    priceHidden: hidePrice,
    message: row.message,
    thankedAt: row.thankedAt?.toISOString() ?? null,
    source: row.source,
    occurredAt: row.occurredAt.toISOString(),
  };
}

const COUNTERPARTY_INCLUDE = {
  counterparty: {
    select: { id: true, username: true, profile: { select: { displayName: true, avatarUrl: true } } },
  },
} as const;

/**
 * The caller's own ledger (spec §26).
 *
 * Seeing what you were given last year is the whole point — it is how you avoid
 * giving the same person the same thing twice — so the owner always sees every
 * row, including prices they paid on gifts they sent.
 */
export async function listMyGiftHistory(
  userId: string,
  options: { direction?: 'RECEIVED' | 'SENT'; year?: number; counterpartyId?: string } = {},
): Promise<GiftHistoryEntryDto[]> {
  const rows = await prisma.giftHistoryEntry.findMany({
    where: {
      userId,
      ...(options.direction ? { direction: options.direction } : {}),
      ...(options.year ? { celebrationYear: options.year } : {}),
      ...(options.counterpartyId ? { counterpartyUserId: options.counterpartyId } : {}),
    },
    orderBy: { occurredAt: 'desc' },
    include: COUNTERPARTY_INCLUDE,
  });
  return rows.map((row) => toGiftHistoryDto(row, { hidePrice: false }));
}

/** Someone else's history, subject to their `giftHistoryVisibility`. */
export async function listGiftHistoryFor(
  viewerId: string,
  ownerId: string,
): Promise<GiftHistoryEntryDto[]> {
  if (viewerId === ownerId) return listMyGiftHistory(ownerId);

  const context = await viewerContext(viewerId, ownerId);
  const privacy = privacyOrDefaults(
    await prisma.privacySetting.findUnique({ where: { userId: ownerId } }),
  );
  if (!canSee(privacy.giftHistoryVisibility, context)) throw new AppError('FORBIDDEN');

  const rows = await prisma.giftHistoryEntry.findMany({
    where: { userId: ownerId, direction: 'RECEIVED' },
    orderBy: { occurredAt: 'desc' },
    include: COUNTERPARTY_INCLUDE,
  });
  // Prices are never shown to a third party, whatever the row says.
  return rows.map((row) => toGiftHistoryDto(row, { hidePrice: true }));
}

export async function createGiftHistoryEntry(
  userId: string,
  input: CreateGiftHistoryEntryInput,
): Promise<GiftHistoryEntryDto> {
  const row = await prisma.giftHistoryEntry.create({
    data: {
      userId,
      direction: input.direction,
      title: input.title,
      imageUrl: input.imageUrl ?? null,
      counterpartyUserId: input.counterpartyUserId ?? null,
      counterpartyName: input.counterpartyName ?? null,
      occasion: input.occasion,
      celebrationYear: input.celebrationYear ?? new Date().getFullYear(),
      priceMinor: input.priceMinor ?? null,
      currency: input.currency ?? null,
      message: input.message ?? null,
      source: 'MANUAL',
      occurredAt: input.occurredAt ? new Date(input.occurredAt) : new Date(),
    },
    include: COUNTERPARTY_INCLUDE,
  });
  return toGiftHistoryDto(row, { hidePrice: false });
}

export async function deleteGiftHistoryEntry(userId: string, entryId: string): Promise<void> {
  const entry = await prisma.giftHistoryEntry.findFirst({
    where: { id: entryId, userId },
    select: { id: true, source: true },
  });
  if (!entry) throw new AppError('NOT_FOUND');
  if (entry.source !== 'MANUAL') {
    throw new AppError('FORBIDDEN', {
      message: 'Gifts recorded automatically cannot be deleted.',
    });
  }
  await prisma.giftHistoryEntry.delete({ where: { id: entryId } });
}

/**
 * "What have I already given this person?" — the check that stops a repeat
 * gift, used by the AI assistant and shown on a friend's profile.
 */
export async function giftsGivenTo(userId: string, counterpartyId: string, limit = 20) {
  const rows = await prisma.giftHistoryEntry.findMany({
    where: { userId, direction: 'SENT', counterpartyUserId: counterpartyId },
    orderBy: { occurredAt: 'desc' },
    take: limit,
    select: { title: true, celebrationYear: true, occasion: true, occurredAt: true },
  });
  return rows.map((row) => ({
    title: row.title,
    celebrationYear: row.celebrationYear,
    occasion: row.occasion,
    occurredAt: row.occurredAt.toISOString(),
  }));
}
