import type { CurrentUser } from '@bday/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { Alert, Pressable, View } from 'react-native';
import { Avatar, Badge, Button, Card, CoverHeader, Divider, Icon, type IconName, IconTile, Row, Screen, T } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { pickAndUploadImage } from '../../src/lib/media';
import { unregisterPushToken } from '../../src/lib/push';
import { colors, radius, spacing } from '../../src/theme';

const LINKS: Array<{ section: string; items: Array<{ icon: IconName; label: string; href: string }> }> = [
  {
    section: 'Celebrate',
    items: [
      { icon: 'users', label: 'Friends & requests', href: '/friends' },
      { icon: 'party', label: 'Events', href: '/events' },
      { icon: 'secret', label: 'Surprises & group gifts', href: '/surprises' },
      { icon: 'chat', label: 'Chats', href: '/chats' },
      { icon: 'mail', label: 'Wishes I received', href: '/wishes' },
    ],
  },
  {
    section: 'Gifts',
    items: [
      { icon: 'gift', label: 'Gifts I’m giving', href: '/reservations' },
      { icon: 'receipt', label: 'Gift history', href: '/gift-history' },
      { icon: 'camera', label: 'Birthday memories', href: '/memories' },
      { icon: 'package', label: 'Orders', href: '/orders' },
      { icon: 'wallet', label: 'Wallet & payments', href: '/wallet' },
    ],
  },
  {
    section: 'Account',
    items: [
      { icon: 'link', label: 'My birthday page (link in bio)', href: '/settings/public-page' },
      { icon: 'edit', label: 'Edit profile & interests', href: '/settings/profile' },
      { icon: 'bell', label: 'Reminders & notifications', href: '/settings/notifications' },
      { icon: 'lock', label: 'Privacy', href: '/settings/privacy' },
      { icon: 'store', label: 'Sell on the marketplace', href: '/vendor' },
      { icon: 'settings', label: 'Account & data', href: '/settings/account' },
    ],
  },
];

export default function Profile() {
  const { user: authUser, setUser, signOut } = useAuth();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<CurrentUser>('/users/me'), initialData: authUser ?? undefined });
  const user = me.data;

  /** Pick a new picture and save it straight away — no separate edit screen. */
  const changePhoto = async (kind: 'avatar' | 'cover') => {
    const url = await pickAndUploadImage(kind, { allowsEditing: kind === 'avatar' });
    if (!url) return;
    const updated = await api.patch<CurrentUser>('/users/me', kind === 'avatar' ? { avatarUrl: url } : { coverUrl: url });
    setUser(updated);
    void me.refetch();
  };

  return (
    <Screen edges={['top']} refreshing={me.isRefetching} onRefresh={() => void me.refetch()}>
      {user ? (
        <>
          <CoverHeader
            name={user.displayName}
            coverUrl={user.coverUrl}
            avatarUrl={user.avatarUrl}
            onPressCover={() => void changePhoto('cover')}
            onPressAvatar={() => void changePhoto('avatar')}
          >
            {user.birthday ? (
              <Row gap={spacing.sm}>
                <View style={{ backgroundColor: user.birthday.countdown.isToday ? colors.accent : 'rgba(255,255,255,0.22)', borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 }}>
                  <T variant="label" color={colors.white}>
                    {user.birthday.countdown.isToday ? 'Your birthday is today' : user.birthday.countdown.label}
                  </T>
                </View>
              </Row>
            ) : null}
          </CoverHeader>
          <Row style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <T variant="title">{user.displayName}</T>
              <T color={colors.textMuted}>@{user.username}</T>
              <Row style={{ marginTop: 6 }} wrap>
                {user.isPremium ? <Badge icon="crown" label="Premium" tone="gold" /> : null}
                {user.birthday ? <Badge icon="cake" label={user.birthday.label} /> : null}
              </Row>
            </View>
            <Button small variant="secondary" icon="user" title="My profile" onPress={() => router.push(`/person/${user.id}`)} />
          </Row>
        </>
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
                    <IconTile name={item.icon} size={34} tone="muted" />
                    <T style={{ flex: 1 }}>{item.label}</T>
                    <Icon name="chevronRight" size={18} color={colors.textFaint} />
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
