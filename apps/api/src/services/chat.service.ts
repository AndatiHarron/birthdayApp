import type {
  ChatMessageDto,
  ConversationDto,
  CreateConversationInput,
  CreatePollInput,
  Paginated,
  PollDto,
  SendChatMessageInput,
  VotePollInput,
} from '@bday/shared';
import type { Prisma } from '@prisma/client';
import { AppError } from '../lib/errors';
import { prisma } from '../lib/prisma';
import { decodeCursor, encodeCursor } from '../lib/response';
import { toActor } from '../mappers/user.mapper';
import { RealtimeEvent, emitToConversation } from '../realtime/emitter';
import { areFriends, isBlockedEitherWay } from './access.service';
import { notify } from './notification.service';

/**
 * Chat for surprise groups, events and one-to-one conversations (spec §29).
 *
 * Membership is the only authorisation rule, and it is checked on every read
 * and write. The birthday person is never a member of their own surprise group
 * — the surprise and group-gift services refuse to add them — so nothing here
 * can leak the planning to them.
 */

const USER_SELECT = {
  id: true,
  username: true,
  profile: { select: { displayName: true, avatarUrl: true } },
} as const;

const MESSAGE_INCLUDE = {
  sender: { select: USER_SELECT },
  poll: { include: { options: { orderBy: { position: 'asc' }, include: { votes: { select: { userId: true } } } } } },
} satisfies Prisma.MessageInclude;

type MessageRow = Prisma.MessageGetPayload<{ include: typeof MESSAGE_INCLUDE }>;

function toPollDto(poll: MessageRow['poll'], viewerId: string): PollDto | null {
  if (!poll) return null;
  return {
    id: poll.id,
    question: poll.question,
    allowsMultiple: poll.allowsMultiple,
    closesAt: poll.closesAt?.toISOString() ?? null,
    options: poll.options.map((option) => ({
      id: option.id,
      label: option.label,
      voteCount: option.votes.length,
      votedByMe: option.votes.some((vote) => vote.userId === viewerId),
    })),
  };
}

export function toChatMessageDto(message: MessageRow, viewerId: string): ChatMessageDto {
  const deleted = message.deletedAt != null;
  return {
    id: message.id,
    conversationId: message.conversationId,
    kind: message.kind,
    body: deleted ? null : message.body,
    mediaUrl: deleted ? null : message.mediaUrl,
    durationSeconds: message.durationSeconds,
    sender: toActor(message.sender),
    poll: deleted ? null : toPollDto(message.poll, viewerId),
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
  };
}

/** Throws unless `userId` is a current member. */
export async function assertMember(conversationId: string, userId: string) {
  const member = await prisma.conversationMember.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    select: { leftAt: true, lastReadAt: true, mutedUntil: true, isAdmin: true },
  });
  if (!member || member.leftAt) throw new AppError('NOT_GROUP_MEMBER');
  return member;
}

export async function isMember(conversationId: string, userId: string): Promise<boolean> {
  try {
    await assertMember(conversationId, userId);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------ conversations ------------------------------ */

const CONVERSATION_INCLUDE = {
  members: { where: { leftAt: null }, include: { user: { select: USER_SELECT } } },
  surprise: { select: { id: true } },
  groupGift: { select: { id: true } },
  event: { select: { id: true } },
} satisfies Prisma.ConversationInclude;

type ConversationRow = Prisma.ConversationGetPayload<{ include: typeof CONVERSATION_INCLUDE }>;

async function decorateConversations(rows: ConversationRow[], viewerId: string): Promise<ConversationDto[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const lastMessages = await Promise.all(
    ids.map((conversationId) =>
      prisma.message.findFirst({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        include: MESSAGE_INCLUDE,
      }),
    ),
  );

  const unreadCounts = await Promise.all(
    rows.map((row) => {
      const me = row.members.find((member) => member.userId === viewerId);
      return prisma.message.count({
        where: {
          conversationId: row.id,
          NOT: { senderId: viewerId },
          deletedAt: null,
          ...(me?.lastReadAt ? { createdAt: { gt: me.lastReadAt } } : {}),
        },
      });
    }),
  );

  return rows.map((row, index) => {
    const other = row.type === 'DIRECT' ? row.members.find((member) => member.userId !== viewerId) : undefined;
    const otherActor = other ? toActor(other.user) : null;
    return {
      id: row.id,
      type: row.type,
      title: row.title ?? otherActor?.displayName ?? null,
      imageUrl: row.imageUrl ?? otherActor?.avatarUrl ?? null,
      memberCount: row.members.length,
      members: row.members.map((member) => ({ ...toActor(member.user)!, isAdmin: member.isAdmin })),
      lastMessage: lastMessages[index] ? toChatMessageDto(lastMessages[index]!, viewerId) : null,
      unreadCount: unreadCounts[index] ?? 0,
      surpriseId: row.surprise?.id ?? null,
      eventId: row.event?.id ?? null,
      groupGiftId: row.groupGift?.id ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  });
}

export async function listConversations(userId: string): Promise<ConversationDto[]> {
  const rows = await prisma.conversation.findMany({
    where: { members: { some: { userId, leftAt: null } } },
    orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
    take: 100,
    include: CONVERSATION_INCLUDE,
  });
  return decorateConversations(rows, userId);
}

export async function getConversation(userId: string, conversationId: string): Promise<ConversationDto> {
  await assertMember(conversationId, userId);
  const row = await prisma.conversation.findUnique({ where: { id: conversationId }, include: CONVERSATION_INCLUDE });
  if (!row) throw new AppError('NOT_FOUND');
  const [dto] = await decorateConversations([row], userId);
  return dto!;
}

/**
 * Opens (or reuses) a one-to-one conversation with a friend. Planning groups
 * are created through surprises and events, which enforce who may not join.
 */
export async function createConversation(userId: string, input: CreateConversationInput): Promise<ConversationDto> {
  const others = Array.from(new Set(input.memberIds.filter((id) => id !== userId)));
  if (others.length !== 1) {
    throw new AppError('VALIDATION_ERROR', {
      message: 'To plan with several friends, create a birthday surprise or an event.',
    });
  }
  const otherId = others[0]!;
  if (await isBlockedEitherWay(userId, otherId)) throw new AppError('BLOCKED_BY_USER');
  if (!(await areFriends(userId, otherId))) throw new AppError('NOT_FRIENDS');

  const existing = await prisma.conversation.findFirst({
    where: {
      type: 'DIRECT',
      AND: [{ members: { some: { userId } } }, { members: { some: { userId: otherId } } }],
    },
    select: { id: true },
  });
  if (existing) {
    await prisma.conversationMember.updateMany({
      where: { conversationId: existing.id, userId },
      data: { leftAt: null },
    });
    return getConversation(userId, existing.id);
  }

  const created = await prisma.conversation.create({
    data: {
      type: 'DIRECT',
      createdById: userId,
      members: { create: [{ userId }, { userId: otherId }] },
    },
    select: { id: true },
  });
  return getConversation(userId, created.id);
}

export async function leaveConversation(userId: string, conversationId: string): Promise<void> {
  await assertMember(conversationId, userId);
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId } },
    data: { leftAt: new Date() },
  });
}

export async function muteConversation(userId: string, conversationId: string, hours: number | null): Promise<void> {
  await assertMember(conversationId, userId);
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId } },
    data: { mutedUntil: hours ? new Date(Date.now() + hours * 3_600_000) : null },
  });
}

export async function markConversationRead(userId: string, conversationId: string): Promise<void> {
  await assertMember(conversationId, userId);
  await prisma.conversationMember.update({
    where: { conversationId_userId: { conversationId, userId } },
    data: { lastReadAt: new Date() },
  });
}

/* -------------------------------- messages -------------------------------- */

export async function listMessages(
  userId: string,
  conversationId: string,
  options: { cursor?: string; limit: number },
): Promise<Paginated<ChatMessageDto>> {
  await assertMember(conversationId, userId);
  const cursor = decodeCursor<{ createdAt: string; id: string }>(options.cursor);
  const rows = await prisma.message.findMany({
    where: {
      conversationId,
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(cursor.createdAt) } },
              { createdAt: new Date(cursor.createdAt), id: { lt: cursor.id } },
            ],
          }
        : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.limit + 1,
    include: MESSAGE_INCLUDE,
  });
  const hasMore = rows.length > options.limit;
  const items = hasMore ? rows.slice(0, options.limit) : rows;
  const last = items[items.length - 1];
  return {
    items: items.map((row) => toChatMessageDto(row, userId)),
    nextCursor: hasMore && last ? encodeCursor({ createdAt: last.createdAt.toISOString(), id: last.id }) : null,
  };
}

async function fanOut(conversationId: string, senderId: string, preview: string): Promise<void> {
  const [conversation, sender] = await Promise.all([
    prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { type: true, title: true, members: { where: { leftAt: null }, select: { userId: true, mutedUntil: true } } },
    }),
    prisma.user.findUnique({ where: { id: senderId }, select: USER_SELECT }),
  ]);
  if (!conversation) return;
  const senderName = sender?.profile?.displayName ?? sender?.username ?? 'Someone';
  const now = Date.now();
  for (const member of conversation.members) {
    if (member.userId === senderId) continue;
    const muted = member.mutedUntil != null && member.mutedUntil.getTime() > now;
    await notify({
      userId: member.userId,
      type: 'CHAT_MESSAGE',
      title: conversation.type === 'DIRECT' ? senderName : conversation.title ?? 'Group chat',
      body: conversation.type === 'DIRECT' ? preview : `${senderName}: ${preview}`,
      deepLink: `chat/${conversationId}`,
      data: { conversationId },
      silent: muted,
    }).catch(() => undefined);
  }
}

export async function sendMessage(
  userId: string,
  conversationId: string,
  input: SendChatMessageInput,
): Promise<ChatMessageDto> {
  await assertMember(conversationId, userId);
  if (input.kind === 'SYSTEM' || input.kind === 'POLL') {
    throw new AppError('VALIDATION_ERROR', { message: 'Use the poll endpoint to create polls.' });
  }
  if ((input.kind === 'IMAGE' || input.kind === 'VOICE') && !input.mediaUrl) {
    throw new AppError('VALIDATION_ERROR', { fieldErrors: { 'body.mediaUrl': ['Attach the file first'] } });
  }

  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { type: true, members: { where: { leftAt: null }, select: { userId: true } } },
  });
  if (conversation?.type === 'DIRECT') {
    const other = conversation.members.find((member) => member.userId !== userId);
    if (other && (await isBlockedEitherWay(userId, other.userId))) throw new AppError('BLOCKED_BY_USER');
  }

  // A client retry with the same clientId returns the original message.
  if (input.clientId) {
    const duplicate = await prisma.message.findUnique({
      where: { conversationId_clientId: { conversationId, clientId: input.clientId } },
      include: MESSAGE_INCLUDE,
    });
    if (duplicate) return toChatMessageDto(duplicate, userId);
  }

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: {
        conversationId,
        senderId: userId,
        kind: input.kind,
        body: input.body ?? null,
        mediaUrl: input.mediaUrl ?? null,
        durationSeconds: input.durationSeconds ?? null,
        clientId: input.clientId ?? null,
      },
      include: MESSAGE_INCLUDE,
    });
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: created.createdAt } });
    await tx.conversationMember.update({
      where: { conversationId_userId: { conversationId, userId } },
      data: { lastReadAt: created.createdAt },
    });
    return created;
  });

  const dto = toChatMessageDto(message, userId);
  emitToConversation(conversationId, RealtimeEvent.CHAT_MESSAGE_CREATED, { ...dto, clientId: input.clientId ?? null });

  const preview =
    input.kind === 'IMAGE' ? '📷 Photo' : input.kind === 'VOICE' ? '🎤 Voice note' : (input.body ?? '').slice(0, 120);
  void fanOut(conversationId, userId, preview);

  return dto;
}

export async function deleteMessage(userId: string, messageId: string): Promise<void> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { senderId: true, conversationId: true, deletedAt: true },
  });
  if (!message || message.deletedAt) throw new AppError('NOT_FOUND');
  const member = await assertMember(message.conversationId, userId);
  if (message.senderId !== userId && !member.isAdmin) throw new AppError('FORBIDDEN');
  await prisma.message.update({ where: { id: messageId }, data: { deletedAt: new Date(), body: null, mediaUrl: null } });
  emitToConversation(message.conversationId, RealtimeEvent.CHAT_MESSAGE_CREATED, {
    id: messageId,
    conversationId: message.conversationId,
    deleted: true,
  });
}

/* ---------------------------------- polls ---------------------------------- */

export async function createPoll(userId: string, conversationId: string, input: CreatePollInput): Promise<ChatMessageDto> {
  await assertMember(conversationId, userId);
  if (input.closesAt && new Date(input.closesAt) <= new Date()) {
    throw new AppError('VALIDATION_ERROR', { fieldErrors: { 'body.closesAt': ['Choose a time in the future'] } });
  }

  const message = await prisma.$transaction(async (tx) => {
    const created = await tx.message.create({
      data: { conversationId, senderId: userId, kind: 'POLL', body: input.question },
      select: { id: true, createdAt: true },
    });
    await tx.poll.create({
      data: {
        conversationId,
        messageId: created.id,
        question: input.question,
        allowsMultiple: input.allowsMultiple,
        closesAt: input.closesAt ? new Date(input.closesAt) : null,
        options: { create: input.options.map((label, position) => ({ label, position })) },
      },
    });
    await tx.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: created.createdAt } });
    return tx.message.findUniqueOrThrow({ where: { id: created.id }, include: MESSAGE_INCLUDE });
  });

  const dto = toChatMessageDto(message, userId);
  emitToConversation(conversationId, RealtimeEvent.CHAT_MESSAGE_CREATED, dto);
  void fanOut(conversationId, userId, `📊 ${input.question}`);
  return dto;
}

export async function votePoll(userId: string, pollId: string, input: VotePollInput): Promise<ChatMessageDto> {
  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    include: { options: { select: { id: true } } },
  });
  if (!poll) throw new AppError('NOT_FOUND');
  await assertMember(poll.conversationId, userId);
  if (poll.closesAt && poll.closesAt <= new Date()) {
    throw new AppError('CONFLICT', { message: 'This poll has closed.' });
  }

  const validIds = new Set(poll.options.map((option) => option.id));
  const choices = Array.from(new Set(input.optionIds));
  if (choices.some((id) => !validIds.has(id))) throw new AppError('VALIDATION_ERROR', { message: 'That option is not part of this poll.' });
  if (!poll.allowsMultiple && choices.length > 1) {
    throw new AppError('VALIDATION_ERROR', { message: 'Choose one option.' });
  }

  await prisma.$transaction(async (tx) => {
    // A vote replaces the previous ballot, so changing your mind is one tap.
    await tx.pollVote.deleteMany({ where: { userId, option: { pollId } } });
    await tx.pollVote.createMany({ data: choices.map((optionId) => ({ optionId, userId })) });
  });

  const message = await prisma.message.findUniqueOrThrow({ where: { id: poll.messageId }, include: MESSAGE_INCLUDE });
  const dto = toChatMessageDto(message, userId);
  emitToConversation(poll.conversationId, RealtimeEvent.CHAT_MESSAGE_CREATED, { ...dto, pollUpdated: true });
  return dto;
}
