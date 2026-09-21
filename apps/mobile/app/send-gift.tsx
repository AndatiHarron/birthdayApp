import { Stack, router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { Avatar, Card, EmptyState, type IconName, IconTile, Loading, Row, Screen, T } from '../src/components/ui';
import { useRecipient } from '../src/lib/recipient';
import { colors, spacing } from '../src/theme';

/** "Send gift" hub: every way to give, for one person. */
export default function SendGift() {
  const params = useLocalSearchParams<{ userId?: string; birthdayId?: string; name?: string }>();
  const { recipient, isLoading } = useRecipient(params);
  if (isLoading) return <Loading />;
  if (!recipient) return <EmptyState icon="help" title="Choose who the gift is for" />;

  const recipientParams = { userId: recipient.userId ?? '', birthdayId: recipient.birthdayId ?? '', name: recipient.name };
  const options = [
    recipient.userId ? { icon: 'heart' as IconName, title: 'From their wishlist', body: 'Reserve something they actually asked for.', go: () => router.push(`/person/${recipient.userId}`) } : null,
    { icon: 'sparkles' as IconName, title: 'Get AI gift ideas', body: 'Ideas matched to their interests and your budget.', go: () => router.push({ pathname: '/gift-finder', params: recipientParams }) },
    { icon: 'bag' as IconName, title: 'Buy & deliver a gift', body: 'Cakes, flowers, gadgets — delivered to them or to you.', go: () => router.push({ pathname: '/(tabs)/gifts' }) },
    recipient.userId ? { icon: 'party' as IconName, title: 'Send a digital gift', body: 'Cards, flowers, airtime, vouchers — instantly or scheduled.', go: () => router.push({ pathname: '/digital-gift/send', params: recipientParams }) } : null,
    { icon: 'users' as IconName, title: 'Chip in with friends', body: 'Start a group gift and collect contributions.', go: () => router.push({ pathname: '/group-gift/new', params: { beneficiaryUserId: recipient.userId ?? '', birthdayId: recipient.birthdayId ?? '', name: recipient.name } }) },
    { icon: 'secret' as IconName, title: 'Plan a surprise', body: 'A private group they can’t see.', go: () => router.push({ pathname: '/surprise/new', params: recipientParams }) },
  ].filter((option): option is NonNullable<typeof option> => option !== null);

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Send a gift' }} />
      <Row gap={spacing.md} style={{ marginBottom: spacing.lg }}>
        <Avatar name={recipient.name} uri={recipient.avatarUrl} size={52} />
        <T variant="title">For {recipient.name.split(' ')[0]}</T>
      </Row>
      {options.map((option) => (
        <Card key={option.title} onPress={option.go} style={{ marginBottom: spacing.md }}>
          <Row gap={spacing.md}>
            <IconTile name={option.icon} size={40} />
            <View style={{ flex: 1 }}>
              <T variant="heading">{option.title}</T>
              <T color={colors.textMuted}>{option.body}</T>
            </View>
            <T color={colors.textFaint}>›</T>
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
