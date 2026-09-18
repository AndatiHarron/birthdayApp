import { formatBirthday, type FriendGroupDto, type TrackedBirthdayDto } from '@bday/shared';
import type { FriendGroup, Interest, TrackedBirthday } from '@prisma/client';
import { toCountdown, toInterestDto } from './user.mapper';

export type TrackedBirthdayRow = TrackedBirthday & {
  interests: Array<{ interest: Interest }>;
  groupMembers: Array<{ group: FriendGroup }>;
  linkedUser: { id: string; username: string } | null;
};

export interface WishlistSignal {
  itemCount: number;
  /** Items added recently enough to be worth surfacing as "new". */
  newItemCount: number;
}

/**
 * Calendar entry DTO.
 *
 * `newWishlistItemCount` is deliberately defined as "added in the last 14 days"
 * rather than "since you last looked": there is no per-viewer read marker on a
 * wishlist, and inventing one would mean writing a row on every profile view.
 * Fourteen days matches the reminder ladder, so the "she added 4 new things"
 * line in the spec §65 spotlight lines up with the reminder that precedes it.
 */
export const NEW_WISHLIST_ITEM_WINDOW_DAYS = 14;

export function toTrackedBirthdayDto(
  row: TrackedBirthdayRow,
  signal: WishlistSignal | null,
  groupCounts: Map<string, number> = new Map(),
  now = new Date(),
): TrackedBirthdayDto {
  const groups: FriendGroupDto[] = row.groupMembers.map((member) => ({
    id: member.group.id,
    name: member.group.name,
    color: member.group.color,
    isSystem: member.group.isSystem,
    memberCount: groupCounts.get(member.group.id) ?? 0,
  }));

  return {
    id: row.id,
    name: row.name,
    avatarUrl: row.avatarUrl,
    birthday: {
      month: row.birthMonth,
      day: row.birthDay,
      year: row.birthYear,
      label: formatBirthday(
        { month: row.birthMonth, day: row.birthDay, year: row.birthYear },
        { showYear: row.birthYear != null },
      ),
    },
    countdown: toCountdown(
      { month: row.birthMonth, day: row.birthDay, year: row.birthYear },
      now,
    ),
    relationship: row.relationship,
    isFavorite: row.isFavorite,
    notes: row.notes,
    phone: row.phone,
    email: row.email,
    interests: row.interests.map((link) => toInterestDto(link.interest)),
    linkedUser: row.linkedUser,
    hasWishlist: (signal?.itemCount ?? 0) > 0,
    wishlistItemCount: signal?.itemCount ?? 0,
    newWishlistItemCount: signal?.newItemCount ?? 0,
    // An empty override array means "use my default ladder"; null says the same
    // thing to the client, which renders it as "Default reminders".
    reminderOffsetsDays: row.reminderOffsetsDays.length > 0 ? row.reminderOffsetsDays : null,
    groups,
  };
}

export const TRACKED_BIRTHDAY_INCLUDE = {
  interests: { include: { interest: true } },
  groupMembers: { include: { group: true } },
  linkedUser: { select: { id: true, username: true } },
} as const;
