import type {
  CreateFriendGroupInput,
  FriendDto,
  FriendGroupDto,
  FriendRequestDto,
  FriendRequestInput,
  RespondToFriendRequestInput,
  UpdateFriendGroupInput,
  UpdateFriendshipInput,
} from '@bday/shared';
import type { RelationshipType } from '@prisma/client';
import { AppError } from '../lib/errors';
import { prisma, type Tx } from '../lib/prisma';
import { toPublicProfile, type ProfileForViewer } from '../mappers/user.mapper';
import { isBlockedEitherWay, viewerContext } from './access.service';
import { notify } from './notification.service';
import { summariseFriendship } from './user.service';

/**
 * Friends and connections (spec §9).
 *
 * Accepting a request does more than flip a status: it puts each person on the
 * other's birthday calendar. The calendar reads from `TrackedBirthday` only, so
 * without that step a new friend would be connected but invisible on the one
 * screen the product exists for.
 */

const PROFILE_INCLUDE = {
  profile: true,
  privacy: true,
  interests: { include: { interest: true } },
} as const;

/* ------------------------------- requests ------------------------------- */

export async function sendFriendRequest(
  requesterId: string,
  input: FriendRequestInput,
): Promise<FriendRequestDto> {
  const target = await prisma.user.findFirst({
    where: {
      deletedAt: null,
      ...(input.userId ? { id: input.userId } : { username: input.username! }),
    },
    include: PROFILE_INCLUDE,
  });
  if (!target) throw new AppError('NOT_FOUND', { message: 'That account could not be found.' });
  if (target.id === requesterId) throw new AppError('CANNOT_FRIEND_SELF');
  if (await isBlockedEitherWay(requesterId, target.id)) throw new AppError('BLOCKED_BY_USER');

  const existing = await prisma.friendship.findFirst({
    where: {
      OR: [
        { requesterId, addresseeId: target.id },
        { requesterId: target.id, addresseeId: requesterId },
      ],
    },
    select: { id: true, status: true, requesterId: true },
  });

  if (existing?.status === 'ACCEPTED') throw new AppError('ALREADY_FRIENDS');

  if (existing?.status === 'PENDING') {
    // They already asked us. Treating a second request as an acceptance is
    // what a user means by tapping "Add" on someone who is waiting on them.
    if (existing.requesterId === target.id) {
      await acceptFriendship(existing.id, requesterId, input.relationship ?? undefined);
      const context = await viewerContext(requesterId, target.id);
      return {
        id: existing.id,
        user: toPublicProfile(target as unknown as ProfileForViewer, context, {
          friendship: await summariseFriendship(requesterId, target.id),
        }),
        direction: 'INCOMING',
        message: null,
        createdAt: new Date().toISOString(),
      };
    }
    throw new AppError('FRIEND_REQUEST_EXISTS');
  }

  const friendship = existing
    ? await prisma.friendship.update({
        where: { id: existing.id },
        data: {
          requesterId,
          addresseeId: target.id,
          status: 'PENDING',
          message: input.message ?? null,
          respondedAt: null,
        },
        select: { id: true, message: true, createdAt: true },
      })
    : await prisma.friendship.create({
        data: {
          requesterId,
          addresseeId: target.id,
          message: input.message ?? null,
        },
        select: { id: true, message: true, createdAt: true },
      });

  const requester = await prisma.user.findUnique({
    where: { id: requesterId },
    select: { username: true, profile: { select: { displayName: true, avatarUrl: true } } },
  });
  const requesterName = requester?.profile?.displayName ?? requester?.username ?? 'Someone';

  await notify({
    userId: target.id,
    type: 'FRIEND_REQUEST',
    title: 'New friend request',
    body: `${requesterName} wants to connect with you.`,
    deepLink: `friends/requests`,
    data: { friendshipId: friendship.id, userId: requesterId },
    imageUrl: requester?.profile?.avatarUrl ?? null,
  });

  const context = await viewerContext(requesterId, target.id);
  return {
    id: friendship.id,
    user: toPublicProfile(target as unknown as ProfileForViewer, context, {
      friendship: await summariseFriendship(requesterId, target.id),
    }),
    direction: 'OUTGOING',
    message: friendship.message,
    createdAt: friendship.createdAt.toISOString(),
  };
}

export async function respondToFriendRequest(
  userId: string,
  input: RespondToFriendRequestInput,
): Promise<{ status: 'ACCEPTED' | 'DECLINED' }> {
  const friendship = await prisma.friendship.findUnique({
    where: { id: input.requestId },
    select: { id: true, requesterId: true, addresseeId: true, status: true },
  });
  if (!friendship) throw new AppError('NOT_FOUND', { message: 'That request no longer exists.' });
  if (friendship.addresseeId !== userId) throw new AppError('FORBIDDEN');
  if (friendship.status !== 'PENDING') throw new AppError('CONFLICT', { message: 'That request has already been answered.' });

  if (input.action === 'DECLINE') {
    await prisma.friendship.update({
      where: { id: friendship.id },
      data: { status: 'DECLINED', respondedAt: new Date() },
    });
    return { status: 'DECLINED' };
  }

  await acceptFriendship(friendship.id, userId, input.relationship, input.groupIds);
  return { status: 'ACCEPTED' };
}

/**
 * Marks a friendship accepted and mirrors both profiles onto each other's
 * calendar. Runs in one transaction so a connection can never exist without
 * its calendar entries.
 */
async function acceptFriendship(
  friendshipId: string,
  accepterId: string,
  relationship?: RelationshipType,
  groupIds: string[] = [],
): Promise<void> {
  const friendship = await prisma.friendship.update({
    where: { id: friendshipId },
    data: { status: 'ACCEPTED', respondedAt: new Date() },
    select: { requesterId: true, addresseeId: true },
  });

  await prisma.$transaction(async (tx) => {
    await mirrorCalendarEntry(tx, accepterId, otherSide(friendship, accepterId), relationship, groupIds);
    await mirrorCalendarEntry(tx, otherSide(friendship, accepterId), accepterId);
  });

  const accepter = await prisma.user.findUnique({
    where: { id: accepterId },
    select: { username: true, profile: { select: { displayName: true, avatarUrl: true } } },
  });
  const name = accepter?.profile?.displayName ?? accepter?.username ?? 'Someone';

  await notify({
    userId: otherSide(friendship, accepterId),
    type: 'FRIEND_REQUEST_ACCEPTED',
    title: 'You are now connected',
    body: `${name} accepted your friend request.`,
    deepLink: `profile/${accepterId}`,
    data: { userId: accepterId },
    imageUrl: accepter?.profile?.avatarUrl ?? null,
  });
}

function otherSide(friendship: { requesterId: string; addresseeId: string }, userId: string): string {
  return friendship.requesterId === userId ? friendship.addresseeId : friendship.requesterId;
}

/**
 * Creates or refreshes the calendar entry `ownerId` holds for `friendId`.
 *
 * The entry is skipped when the friend has not set a birthday yet or hides it:
 * a placeholder row would show up as a birthday on an arbitrary date.
 */
async function mirrorCalendarEntry(
  tx: Tx,
  ownerId: string,
  friendId: string,
  relationship?: RelationshipType,
  groupIds: string[] = [],
): Promise<void> {
  const friend = await tx.user.findUnique({
    where: { id: friendId },
    select: {
      username: true,
      phone: true,
      email: true,
      profile: { select: { displayName: true, avatarUrl: true, birthMonth: true, birthDay: true, birthYear: true } },
      privacy: { select: { birthdayVisibility: true, showBirthYear: true } },
    },
  });
  if (!friend?.profile?.birthMonth || !friend.profile.birthDay) return;
  if (friend.privacy?.birthdayVisibility === 'PRIVATE') return;

  const existing = await tx.trackedBirthday.findUnique({
    where: { ownerId_linkedUserId: { ownerId, linkedUserId: friendId } },
    select: { id: true },
  });

  const data = {
    name: friend.profile.displayName ?? friend.username,
    avatarUrl: friend.profile.avatarUrl,
    birthMonth: friend.profile.birthMonth,
    birthDay: friend.profile.birthDay,
    birthYear: friend.privacy?.showBirthYear === false ? null : friend.profile.birthYear,
    source: 'LINKED_USER' as const,
  };

  const row = existing
    ? await tx.trackedBirthday.update({
        where: { id: existing.id },
        data: { ...data, deletedAt: null, ...(relationship ? { relationship } : {}) },
        select: { id: true },
      })
    : await tx.trackedBirthday.create({
        data: {
          ...data,
          ownerId,
          linkedUserId: friendId,
          relationship: relationship ?? 'FRIEND',
        },
        select: { id: true },
      });

  if (groupIds.length > 0) {
    const owned = await tx.friendGroup.findMany({
      where: { id: { in: groupIds }, ownerId },
      select: { id: true },
    });
    await tx.friendGroupMember.createMany({
      data: owned.map((group) => ({ groupId: group.id, trackedBirthdayId: row.id })),
      skipDuplicates: true,
    });
  }
}

export async function cancelFriendRequest(userId: string, requestId: string): Promise<void> {
  const friendship = await prisma.friendship.findUnique({
    where: { id: requestId },
    select: { requesterId: true, status: true },
  });
  if (!friendship) throw new AppError('NOT_FOUND');
  if (friendship.requesterId !== userId) throw new AppError('FORBIDDEN');
  if (friendship.status !== 'PENDING') throw new AppError('CONFLICT');
  await prisma.friendship.update({
    where: { id: requestId },
    data: { status: 'CANCELLED', respondedAt: new Date() },
  });
}

export async function listFriendRequests(
  userId: string,
  direction: 'INCOMING' | 'OUTGOING',
): Promise<FriendRequestDto[]> {
  const rows = await prisma.friendship.findMany({
    where: {
      status: 'PENDING',
      ...(direction === 'INCOMING' ? { addresseeId: userId } : { requesterId: userId }),
    },
    orderBy: { createdAt: 'desc' },
    include: {
      requester: { include: PROFILE_INCLUDE },
      addressee: { include: PROFILE_INCLUDE },
    },
  });

  return Promise.all(
    rows.map(async (row) => {
      const other = direction === 'INCOMING' ? row.requester : row.addressee;
      const context = await viewerContext(userId, other.id);
      return {
        id: row.id,
        user: toPublicProfile(other as unknown as ProfileForViewer, context),
        direction,
        message: row.message,
        createdAt: row.createdAt.toISOString(),
      };
    }),
  );
}

/* -------------------------------- friends -------------------------------- */

export async function listFriends(
  userId: string,
  options: { groupId?: string; relationship?: RelationshipType; favoritesOnly?: boolean } = {},
): Promise<FriendDto[]> {
  const friendships = await prisma.friendship.findMany({
    where: {
      status: 'ACCEPTED',
      OR: [{ requesterId: userId }, { addresseeId: userId }],
    },
    select: { id: true, requesterId: true, addresseeId: true },
  });

  const friendIds = friendships.map((row) => otherSide(row, userId));
  if (friendIds.length === 0) return [];

  const [users, tracked] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: friendIds }, deletedAt: null },
      include: PROFILE_INCLUDE,
    }),
    prisma.trackedBirthday.findMany({
      where: { ownerId: userId, linkedUserId: { in: friendIds }, deletedAt: null },
      select: {
        linkedUserId: true,
        relationship: true,
        isFavorite: true,
        groupMembers: { select: { group: true, groupId: true } },
      },
    }),
  ]);

  const trackedByUser = new Map(tracked.map((row) => [row.linkedUserId!, row]));
  const friendshipByUser = new Map(friendships.map((row) => [otherSide(row, userId), row.id]));

  const groupCounts = await groupMemberCounts(userId);

  const result: FriendDto[] = [];
  for (const user of users) {
    const entry = trackedByUser.get(user.id);
    if (options.favoritesOnly && !entry?.isFavorite) continue;
    if (options.relationship && entry?.relationship !== options.relationship) continue;
    if (options.groupId && !entry?.groupMembers.some((member) => member.groupId === options.groupId)) continue;

    const context = await viewerContext(userId, user.id);
    result.push({
      friendshipId: friendshipByUser.get(user.id) ?? '',
      user: toPublicProfile(user as unknown as ProfileForViewer, context, {
        friendship: await summariseFriendship(userId, user.id),
      }),
      relationship: entry?.relationship ?? null,
      isFavorite: entry?.isFavorite ?? false,
      groups:
        entry?.groupMembers.map((member) => ({
          id: member.group.id,
          name: member.group.name,
          color: member.group.color,
          isSystem: member.group.isSystem,
          memberCount: groupCounts.get(member.group.id) ?? 0,
        })) ?? [],
    });
  }

  return result.sort((a, b) => a.user.displayName.localeCompare(b.user.displayName));
}

export async function removeFriend(userId: string, friendId: string): Promise<void> {
  const deleted = await prisma.friendship.deleteMany({
    where: {
      status: 'ACCEPTED',
      OR: [
        { requesterId: userId, addresseeId: friendId },
        { requesterId: friendId, addresseeId: userId },
      ],
    },
  });
  if (deleted.count === 0) throw new AppError('NOT_FRIENDS');

  // The calendar entry survives as a manual contact: forgetting a birthday
  // because a connection lapsed is exactly the failure this app exists to stop.
  await prisma.trackedBirthday.updateMany({
    where: { ownerId: userId, linkedUserId: friendId },
    data: { linkedUserId: null, source: 'MANUAL' },
  });
  await prisma.trackedBirthday.updateMany({
    where: { ownerId: friendId, linkedUserId: userId },
    data: { linkedUserId: null, source: 'MANUAL' },
  });
}

/**
 * Relationship, favourite flag, group membership and per-person reminders all
 * live on the owner's calendar entry rather than on the friendship, so this
 * creates one on demand for friends who joined before it existed.
 */
export async function updateFriendship(
  userId: string,
  friendId: string,
  input: UpdateFriendshipInput,
): Promise<void> {
  const friends = await prisma.friendship.findFirst({
    where: {
      status: 'ACCEPTED',
      OR: [
        { requesterId: userId, addresseeId: friendId },
        { requesterId: friendId, addresseeId: userId },
      ],
    },
    select: { id: true },
  });
  if (!friends) throw new AppError('NOT_FRIENDS');

  await prisma.$transaction(async (tx) => {
    let entry = await tx.trackedBirthday.findUnique({
      where: { ownerId_linkedUserId: { ownerId: userId, linkedUserId: friendId } },
      select: { id: true },
    });
    if (!entry) {
      await mirrorCalendarEntry(tx, userId, friendId, input.relationship);
      entry = await tx.trackedBirthday.findUnique({
        where: { ownerId_linkedUserId: { ownerId: userId, linkedUserId: friendId } },
        select: { id: true },
      });
    }
    if (!entry) throw new AppError('NOT_FOUND', { message: 'That friend has not shared a birthday yet.' });

    await tx.trackedBirthday.update({
      where: { id: entry.id },
      data: {
        ...(input.relationship ? { relationship: input.relationship } : {}),
        ...(input.isFavorite !== undefined ? { isFavorite: input.isFavorite } : {}),
        ...(input.reminderOffsetsDays !== undefined
          ? { reminderOffsetsDays: input.reminderOffsetsDays ?? [] }
          : {}),
      },
    });

    if (input.groupIds) {
      const owned = await tx.friendGroup.findMany({
        where: { id: { in: input.groupIds }, ownerId: userId },
        select: { id: true },
      });
      await tx.friendGroupMember.deleteMany({ where: { trackedBirthdayId: entry.id } });
      await tx.friendGroupMember.createMany({
        data: owned.map((group) => ({ groupId: group.id, trackedBirthdayId: entry!.id })),
        skipDuplicates: true,
      });
    }
  });
}

/* -------------------------------- groups -------------------------------- */

async function groupMemberCounts(ownerId: string): Promise<Map<string, number>> {
  const counts = await prisma.friendGroupMember.groupBy({
    by: ['groupId'],
    where: { group: { ownerId } },
    _count: { trackedBirthdayId: true },
  });
  return new Map(counts.map((row) => [row.groupId, row._count.trackedBirthdayId]));
}

export async function listFriendGroups(ownerId: string): Promise<FriendGroupDto[]> {
  const [groups, counts] = await Promise.all([
    prisma.friendGroup.findMany({
      where: { ownerId },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
    }),
    groupMemberCounts(ownerId),
  ]);
  return groups.map((group) => ({
    id: group.id,
    name: group.name,
    color: group.color,
    isSystem: group.isSystem,
    memberCount: counts.get(group.id) ?? 0,
  }));
}

export async function createFriendGroup(
  ownerId: string,
  input: CreateFriendGroupInput,
): Promise<FriendGroupDto> {
  const existing = await prisma.friendGroup.findUnique({
    where: { ownerId_name: { ownerId, name: input.name } },
    select: { id: true },
  });
  if (existing) throw new AppError('CONFLICT', { message: 'You already have a group with that name.' });

  const group = await prisma.friendGroup.create({
    data: { ownerId, name: input.name, color: input.color ?? null },
  });

  if (input.memberIds.length > 0) {
    const owned = await prisma.trackedBirthday.findMany({
      where: { id: { in: input.memberIds }, ownerId, deletedAt: null },
      select: { id: true },
    });
    await prisma.friendGroupMember.createMany({
      data: owned.map((entry) => ({ groupId: group.id, trackedBirthdayId: entry.id })),
      skipDuplicates: true,
    });
  }

  return {
    id: group.id,
    name: group.name,
    color: group.color,
    isSystem: group.isSystem,
    memberCount: input.memberIds.length,
  };
}

export async function updateFriendGroup(
  ownerId: string,
  groupId: string,
  input: UpdateFriendGroupInput,
): Promise<FriendGroupDto> {
  const group = await prisma.friendGroup.findFirst({
    where: { id: groupId, ownerId },
    select: { id: true, isSystem: true },
  });
  if (!group) throw new AppError('NOT_FOUND');
  if (group.isSystem && input.name) {
    throw new AppError('FORBIDDEN', { message: 'Built-in groups cannot be renamed.' });
  }

  const updated = await prisma.friendGroup.update({
    where: { id: groupId },
    data: {
      ...(input.name ? { name: input.name } : {}),
      ...(input.color !== undefined ? { color: input.color ?? null } : {}),
    },
  });

  if (input.memberIds) {
    const owned = await prisma.trackedBirthday.findMany({
      where: { id: { in: input.memberIds }, ownerId, deletedAt: null },
      select: { id: true },
    });
    await prisma.friendGroupMember.deleteMany({ where: { groupId } });
    await prisma.friendGroupMember.createMany({
      data: owned.map((entry) => ({ groupId, trackedBirthdayId: entry.id })),
      skipDuplicates: true,
    });
  }

  const counts = await groupMemberCounts(ownerId);
  return {
    id: updated.id,
    name: updated.name,
    color: updated.color,
    isSystem: updated.isSystem,
    memberCount: counts.get(updated.id) ?? 0,
  };
}

export async function deleteFriendGroup(ownerId: string, groupId: string): Promise<void> {
  const group = await prisma.friendGroup.findFirst({
    where: { id: groupId, ownerId },
    select: { id: true, isSystem: true },
  });
  if (!group) throw new AppError('NOT_FOUND');
  if (group.isSystem) throw new AppError('FORBIDDEN', { message: 'Built-in groups cannot be deleted.' });
  await prisma.friendGroup.delete({ where: { id: groupId } });
}
