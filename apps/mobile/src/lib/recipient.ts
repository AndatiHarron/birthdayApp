import type { TrackedBirthdayDto } from '@bday/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

/**
 * Screens for sending things can be opened for a platform user (`userId`) or a
 * calendar entry (`birthdayId`). This resolves either into one recipient.
 */
export interface Recipient {
  userId: string | null;
  birthdayId: string | null;
  name: string;
  avatarUrl: string | null;
}

export function useRecipient(params: { userId?: string; birthdayId?: string; name?: string }) {
  const birthday = useQuery({
    queryKey: ['birthdays', 'detail', params.birthdayId],
    queryFn: () => api.get<TrackedBirthdayDto>(`/birthdays/${params.birthdayId}`),
    enabled: Boolean(params.birthdayId),
  });

  const recipient: Recipient | null = params.birthdayId
    ? birthday.data
      ? { userId: birthday.data.linkedUser?.id ?? null, birthdayId: birthday.data.id, name: birthday.data.name, avatarUrl: birthday.data.avatarUrl }
      : null
    : params.userId
      ? { userId: params.userId, birthdayId: null, name: params.name ?? 'them', avatarUrl: null }
      : null;

  return { recipient, isLoading: birthday.isLoading && Boolean(params.birthdayId), error: birthday.error };
}
