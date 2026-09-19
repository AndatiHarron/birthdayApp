import {
  computeAge,
  formatBirthday,
  formatCountdown,
  getBirthdayCountdown,
  type BirthdayInfo,
  type CountdownInfo,
  type CurrentUser,
  type GiftPreferences,
  type InterestDto,
  type NotificationPreferences,
  type PrivacySettings,
  type PublicProfile,
} from '@bday/shared';
import type {
  Interest,
  NotificationPreference,
  PrivacySetting,
  Profile,
  User,
  UserInterest,
} from '@prisma/client';
import { privacyOrDefaults, type ViewerContext } from '../services/access.service';

/** The `{ id, displayName, avatarUrl }` triple used all over the DTOs. */
export interface Actor {
  id: string;
  displayName: string;
  avatarUrl: string | null;
}

export function toActor(
  user: { id: string; username?: string; profile?: { displayName: string; avatarUrl: string | null } | null } | null,
): Actor | null {
  if (!user) return null;
  return {
    id: user.id,
    displayName: user.profile?.displayName ?? user.username ?? 'Someone',
    avatarUrl: user.profile?.avatarUrl ?? null,
  };
}

export function toCountdown(
  parts: { month: number; day: number; year?: number | null },
  now = new Date(),
): CountdownInfo {
  const countdown = getBirthdayCountdown(parts, now);
  return {
    daysUntil: countdown.daysUntil,
    hoursUntil: countdown.hoursUntil,
    nextDate: countdown.nextDate,
    isToday: countdown.isToday,
    label: formatCountdown(countdown),
    turningAge: countdown.turningAge,
  };
}

/**
 * Birthday block for a profile.
 *
 * `showYear` is the privacy decision, made by the caller; this function only
 * renders it. When the year is hidden, `turningAge` is stripped too — leaving
 * it in would give the hidden year away by subtraction.
 */
export function toBirthdayInfo(
  profile: Pick<Profile, 'birthMonth' | 'birthDay' | 'birthYear'>,
  options: { showYear: boolean } = { showYear: true },
  now = new Date(),
): BirthdayInfo | null {
  if (profile.birthMonth == null || profile.birthDay == null) return null;
  const year = options.showYear ? profile.birthYear : null;
  const countdown = toCountdown(
    { month: profile.birthMonth, day: profile.birthDay, year },
    now,
  );
  return {
    month: profile.birthMonth,
    day: profile.birthDay,
    year: year ?? null,
    label: formatBirthday({ month: profile.birthMonth, day: profile.birthDay, year }, { showYear: options.showYear }),
    countdown: options.showYear ? countdown : { ...countdown, turningAge: null },
  };
}

export function toPrivacyDto(privacy: PrivacySetting | null): PrivacySettings {
  const value = privacyOrDefaults(privacy);
  return {
    profileVisibility: value.profileVisibility,
    birthdayVisibility: value.birthdayVisibility,
    wishlistVisibility: value.wishlistVisibility,
    giftHistoryVisibility: value.giftHistoryVisibility,
    showAge: value.showAge,
    showBirthYear: value.showBirthYear,
    discoverableByPhone: value.discoverableByPhone,
    discoverableByEmail: value.discoverableByEmail,
    discoverableByUsername: value.discoverableByUsername,
    celebrateGlobally: value.celebrateGlobally ?? false,
  };
}

export function toNotificationPreferencesDto(
  preference: NotificationPreference | null,
): NotificationPreferences {
  return {
    reminderOffsetsDays: preference?.reminderOffsetsDays ?? [30, 14, 7, 3, 1, 0],
    channels: {
      push: preference?.pushEnabled ?? true,
      email: preference?.emailEnabled ?? true,
      sms: preference?.smsEnabled ?? false,
    },
    mutedTypes: preference?.mutedTypes ?? [],
    quietHoursStart: preference?.quietHoursStart ?? null,
    quietHoursEnd: preference?.quietHoursEnd ?? null,
    timezone: preference?.timezone ?? 'Africa/Nairobi',
  };
}

export function toInterestDto(interest: Pick<Interest, 'slug' | 'label' | 'emoji'>): InterestDto {
  return { slug: interest.slug, label: interest.label, emoji: interest.emoji };
}

export function toGiftPreferences(value: unknown): GiftPreferences {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const stringArray = (input: unknown): string[] =>
    Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string') : [];
  return {
    sizes:
      typeof raw.sizes === 'object' && raw.sizes !== null
        ? Object.fromEntries(
            Object.entries(raw.sizes as Record<string, unknown>)
              .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
          )
        : {},
    favoriteColors: stringArray(raw.favoriteColors),
    favoriteBrands: stringArray(raw.favoriteBrands),
    dislikes: stringArray(raw.dislikes),
    allergies: stringArray(raw.allergies),
    notes: typeof raw.notes === 'string' ? raw.notes : null,
  };
}

export type UserWithRelations = User & {
  profile: Profile | null;
  privacy: PrivacySetting | null;
  notificationPreference: NotificationPreference | null;
};

export function toCurrentUser(user: UserWithRelations, now = new Date()): CurrentUser {
  const privacy = privacyOrDefaults(user.privacy);
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    username: user.username,
    displayName: user.profile?.displayName ?? user.username,
    avatarUrl: user.profile?.avatarUrl ?? null,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerified,
    phoneVerified: user.phoneVerified,
    isPremium: user.isPremium,
    onboardingCompletedAt: user.onboardingCompletedAt?.toISOString() ?? null,
    // The owner always sees their own year, whatever the privacy setting says.
    birthday: user.profile ? toBirthdayInfo(user.profile, { showYear: true }, now) : null,
    privacy: toPrivacyDto(user.privacy),
    notificationPreferences: toNotificationPreferencesDto(user.notificationPreference),
    createdAt: user.createdAt.toISOString(),
  };
}

export type ProfileForViewer = User & {
  profile: Profile | null;
  privacy: PrivacySetting | null;
  interests: Array<UserInterest & { interest: Interest }>;
};

/**
 * Public profile, filtered for the viewer.
 *
 * Fields the viewer may not see come back as `null` rather than being omitted,
 * so the mobile client renders a consistent shape and never has to guess
 * whether a missing key means "hidden" or "not set".
 */
export function toPublicProfile(
  user: ProfileForViewer,
  context: ViewerContext,
  extras: {
    friendship?: PublicProfile['friendship'];
    wishlistAccess?: PublicProfile['wishlistAccess'];
  } = {},
  now = new Date(),
): PublicProfile {
  const privacy = privacyOrDefaults(user.privacy);
  const canSeeProfile =
    context.isSelf ||
    privacy.profileVisibility === 'PUBLIC' ||
    (privacy.profileVisibility === 'FRIENDS' && context.isFriend);
  const canSeeBirthday =
    context.isSelf ||
    privacy.birthdayVisibility === 'PUBLIC' ||
    (privacy.birthdayVisibility === 'FRIENDS' && context.isFriend);

  const showYear = context.isSelf || privacy.showBirthYear;
  const birthday =
    canSeeBirthday && user.profile ? toBirthdayInfo(user.profile, { showYear }, now) : null;

  const showAge = context.isSelf || (privacy.showAge && canSeeBirthday);
  const age =
    showAge && user.profile?.birthMonth != null && user.profile.birthDay != null
      ? computeAge(
          { month: user.profile.birthMonth, day: user.profile.birthDay, year: user.profile.birthYear },
          now,
        )
      : null;

  return {
    id: user.id,
    username: user.username,
    displayName: user.profile?.displayName ?? user.username,
    avatarUrl: user.profile?.avatarUrl ?? null,
    bio: canSeeProfile ? user.profile?.bio ?? null : null,
    birthday,
    age,
    interests: canSeeProfile ? user.interests.map((link) => toInterestDto(link.interest)) : [],
    friendship: extras.friendship ?? null,
    wishlistAccess: extras.wishlistAccess ?? 'NONE',
    // Gift preferences exist to help gifters, so friends may read them.
    giftPreferences:
      canSeeProfile && user.profile ? toGiftPreferences(user.profile.giftPreferences) : null,
    isSelf: context.isSelf,
  };
}
