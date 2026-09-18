import type { CurrentUser } from '@bday/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Alert, Pressable, View } from 'react-native';
import { Avatar, Badge, Card, Divider, Row, Screen, T } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { unregisterPushToken } from '../../src/lib/push';
import { colors, spacing } from '../../src/theme';

const LINKS: Array<{ section: string; items: Array<{ emoji: string; label: string; href: string }> }> = [
  {
    section: 'Celebrate',
    items: [
      { emoji: '👥', label: 'Friends & requests', href: '/friends' },
      { emoji: '🎉', label: 'Events', href: '/events' },
      { emoji: '🤫', label: 'Surprises & group gifts', href: '/surprises' },
      { emoji: '💬', label: 'Chats', href: '/chats' },
      { emoji: '💌', label: 'Wishes I received', href: '/celebration' },
    ],
  },
  {
    section: 'Gifts',
    items: [
      { emoji: '🎁', label: 'Gifts I’m giving', href: '/reservations' },
      { emoji: '📜', label: 'Gift history', href: '/gift-history' },
      { emoji: '📸', label: 'Birthday memories', href: '/memories' },
      { emoji: '📦', label: 'Orders', href: '/orders' },
      { emoji: '👛', label: 'Wallet & payments', href: '/wallet' },
    ],
  },
  {
    section: 'Account',
    items: [
      { emoji: '✏️', label: 'Edit profile & interests', href: '/settings/profile' },
      { emoji: '🔔', label: 'Reminders & notifications', href: '/settings/notifications' },
      { emoji: '🔒', label: 'Privacy', href: '/settings/privacy' },
      { emoji: '🏪', label: 'Sell on the marketplace', href: '/vendor' },
      { emoji: '⚙️', label: 'Account & data', href: '/settings/account' },
    ],
  },
];

export default function Profile() {
  const { user: authUser, signOut } = useAuth();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<CurrentUser>('/users/me'), initialData: authUser ?? undefined });
  const user = me.data;

  return (
    <Screen edges={['top']} refreshing={me.isRefetching} onRefresh={() => void me.refetch()}>
      {user ? (
        <Card>
          <Row gap={spacing.lg}>
            <Avatar name={user.displayName} uri={user.avatarUrl} size={72} />
            <View style={{ flex: 1 }}>
              <T variant="title">{user.displayName}</T>
              <T color={colors.textMuted}>@{user.username}</T>
              <Row style={{ marginTop: 6 }} wrap>
                {user.isPremium ? <Badge label="✨ Premium" tone="gold" /> : null}
                {user.birthday ? <Badge label={`🎂 ${user.birthday.label}`} /> : null}
              </Row>
            </View>
          </Row>
          {user.birthday ? (
            <T variant="label" color={colors.pink} style={{ marginTop: spacing.md }}>
              {user.birthday.countdown.isToday ? '🎉 It’s your birthday today!' : `Your birthday: ${user.birthday.countdown.label}`}
            </T>
          ) : null}
          <Pressable onPress={() => router.push(`/person/${user.id}`)} style={{ marginTop: spacing.sm }}>
            <T variant="label" color={colors.brand}>
              View my public profile ›
            </T>
          </Pressable>
        </Card>
      ) : null}

      {LINKS.map((group) => (
        <View key={group.section} style={{ marginTop: spacing.xl }}>
          <T variant="label" color={colors.textMuted} style={{ marginBottom: spacing.sm }}>
            {group.section.toUpperCase()}
          </T>
          <Card style={{ paddingVertical: spacing.sm }}>
            {group.items.map((item, index) => (
              <View key={item.href}>
                {index > 0 ? <Divider /> : null}
                <Pressable onPress={() => router.push(item.href as never)} style={{ paddingVertical: spacing.sm }}>
                  <Row gap={spacing.md}>
                    <T style={{ fontSize: 20 }}>{item.emoji}</T>
                    <T style={{ flex: 1 }}>{item.label}</T>
                    <T color={colors.textFaint}>›</T>
                  </Row>
                </Pressable>
              </View>
            ))}
          </Card>
        </View>
      ))}

      <Pressable
        onPress={() =>
          Alert.alert('Sign out?', undefined, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Sign out', style: 'destructive', onPress: () => void unregisterPushToken().finally(() => void signOut()) },
          ])
        }
        style={{ marginTop: spacing.xl, alignSelf: 'center', padding: spacing.md }}
      >
        <T variant="label" color={colors.danger}>
          Sign out
        </T>
      </Pressable>
    </Screen>
  );
}
