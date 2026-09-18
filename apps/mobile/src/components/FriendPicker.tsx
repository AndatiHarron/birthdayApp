import type { FriendDto } from '@bday/shared';
import { useQuery } from '@tanstack/react-query';
import { Pressable, View } from 'react-native';
import { api } from '../lib/api';
import { colors, spacing } from '../theme';
import { Avatar, Loading, Row, T } from './ui';

/** Multi-select of friends, excluding anyone who must not be included (the birthday person). */
export function FriendPicker({ selected, onChange, excludeIds = [] }: { selected: string[]; onChange: (ids: string[]) => void; excludeIds?: string[] }) {
  const friends = useQuery({ queryKey: ['friends'], queryFn: () => api.get<FriendDto[]>('/friends') });
  if (friends.isLoading) return <Loading />;
  const list = (friends.data ?? []).filter((friend) => !excludeIds.includes(friend.user.id));
  if (list.length === 0) return <T color={colors.textMuted}>Add friends first to invite them.</T>;
  return (
    <View>
      {list.map((friend) => {
        const isSelected = selected.includes(friend.user.id);
        return (
          <Pressable
            key={friend.user.id}
            onPress={() => onChange(isSelected ? selected.filter((id) => id !== friend.user.id) : [...selected, friend.user.id])}
            style={{ paddingVertical: spacing.sm }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isSelected }}
          >
            <Row gap={spacing.md}>
              <Avatar name={friend.user.displayName} uri={friend.user.avatarUrl} size={40} />
              <T style={{ flex: 1 }}>{friend.user.displayName}</T>
              <T style={{ fontSize: 20 }}>{isSelected ? '✅' : '⚪'}</T>
            </Row>
          </Pressable>
        );
      })}
    </View>
  );
}
