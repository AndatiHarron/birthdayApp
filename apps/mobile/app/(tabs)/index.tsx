import type { GlobalTodayDto, HomeFeedResponse } from '@bday/shared';
import { useQuery } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { BirthdayCard, ProductCard } from '../../src/components/gifting';
import { Avatar, Button, Card, EmptyState, ErrorState, Row, Screen, Section, SkeletonCard, T } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { colors, gradients, radius, spacing } from '../../src/theme';

/** Home dashboard (spec §6, §45, §65). */
export default function Home() {
  const feed = useQuery({ queryKey: ['home'], queryFn: () => api.get<HomeFeedResponse>('/home') });
  const data = feed.data;

  return (
    <Screen edges={['top']} refreshing={feed.isRefetching} onRefresh={() => void feed.refetch()}>
      <Row style={{ justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <T variant="title">{data?.greeting ?? 'Hello 👋'}</T>
          <T color={colors.textMuted}>Who’s celebrating soon?</T>
        </View>
        <Pressable onPress={() => router.push('/notifications')} accessibilityLabel="Notifications" style={{ padding: 8 }}>
          <T style={{ fontSize: 24 }}>🔔</T>
        </Pressable>
        <Pressable onPress={() => router.push('/search')} accessibilityLabel="Search" style={{ padding: 8 }}>
          <T style={{ fontSize: 24 }}>🔍</T>
        </Pressable>
      </Row>

      {feed.error && !data ? <ErrorState error={feed.error} onRetry={() => void feed.refetch()} /> : null}

      {data?.myBirthdayToday ? (
        <Pressable onPress={() => router.push('/celebration')} style={{ marginTop: spacing.lg }}>
          <LinearGradient colors={gradients.celebration} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius.xl, padding: spacing.xl }}>
            <T variant="title" color={colors.white}>
              🎉 Happy birthday!
            </T>
            <T color={colors.white} style={{ marginTop: 4 }}>
              {data.myBirthdayToday.wishCount} wishes · {data.myBirthdayToday.giftCount} gifts waiting — tap to celebrate
            </T>
          </LinearGradient>
        </Pressable>
      ) : null}

      {data?.spotlight ? (
        <LinearGradient colors={gradients.soft} style={{ borderRadius: radius.xl, padding: spacing.lg, marginTop: spacing.lg, borderWidth: 1, borderColor: colors.border }}>
          <Row gap={spacing.md} style={{ marginBottom: spacing.sm }}>
            <Avatar name={data.spotlight.personName} uri={data.spotlight.personAvatarUrl} size={48} />
            <T variant="heading" style={{ flex: 1 }}>
              {data.spotlight.personName}
            </T>
          </Row>
          {data.spotlight.lines.map((line) => (
            <T key={line} style={{ marginVertical: 3, lineHeight: 21 }}>
              {line}
            </T>
          ))}
          <Row gap={spacing.sm} style={{ marginTop: spacing.md }}>
            {data.spotlight.topWish ? (
              <Button small title="See wishlist" onPress={() => router.push(`/birthday/${data.spotlight!.birthdayId}`)} style={{ flex: 1 }} />
            ) : null}
            <Button small variant="secondary" title="Create surprise" onPress={() => router.push({ pathname: '/surprise/new', params: { birthdayId: data.spotlight!.birthdayId } })} style={{ flex: 1 }} />
          </Row>
        </LinearGradient>
      ) : null}

      <GlobalTeaser />

      <Section title="🎂 Upcoming Birthdays" action={<Pressable onPress={() => router.push('/(tabs)/birthdays')}><T variant="label" color={colors.brand}>See all</T></Pressable>}>
        {feed.isLoading ? [0, 1].map((key) => <SkeletonCard key={key} height={130} />) : null}
        {data && data.upcomingBirthdays.length === 0 ? (
          <Card>
            <EmptyState emoji="🎈" title="No birthdays yet" message="Add friends and family so you never miss a birthday." action={<Button small title="Add a birthday" onPress={() => router.push('/birthday/new')} />} />
          </Card>
        ) : null}
        {data?.upcomingBirthdays.slice(0, 5).map((birthday) => <BirthdayCard key={birthday.id} birthday={birthday} />)}
      </Section>

      {data && data.giftIdeas.length > 0 ? (
        <Section title="🎁 Gift Ideas For You" action={<Pressable onPress={() => router.push('/gift-finder')}><T variant="label" color={colors.brand}>Ask AI</T></Pressable>}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
            {data.giftIdeas.map((idea, index) => (
              <ProductCard
                key={`${idea.name}-${index}`}
                product={idea}
                width={150}
                onPress={() => (idea.productId ? router.push(`/product/${idea.productId}`) : idea.forUser ? router.push(`/person/${idea.forUser.id}`) : undefined)}
              />
            ))}
          </ScrollView>
        </Section>
      ) : null}

      {data && data.friendHighlights.length > 0 ? (
        <Section title="❤️ Your Friends">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
            {data.friendHighlights.map((highlight) => (
              <Pressable key={highlight.user.id} onPress={() => router.push(`/person/${highlight.user.id}`)} style={{ width: 96, alignItems: 'center' }}>
                <Avatar name={highlight.user.displayName} uri={highlight.user.avatarUrl} size={64} />
                <T variant="label" numberOfLines={1} style={{ marginTop: 6 }}>
                  {highlight.user.displayName.split(' ')[0]}
                </T>
                <T variant="caption" color={colors.textMuted} numberOfLines={2} center>
                  {highlight.detail}
                </T>
              </Pressable>
            ))}
          </ScrollView>
        </Section>
      ) : null}

      <Section title="🎉 Recent Activity">
        {data && data.activity.length === 0 ? <T color={colors.textMuted}>Activity from your friends will show up here.</T> : null}
        {data?.activity.map((item) => (
          <Row key={item.id} gap={spacing.md} style={{ paddingVertical: spacing.sm }}>
            <Avatar name={item.actor?.displayName ?? '🎁'} uri={item.actor?.avatarUrl} size={36} />
            <View style={{ flex: 1 }}>
              <T>{item.text}</T>
              <T variant="caption" color={colors.textFaint}>
                {new Date(item.createdAt).toLocaleDateString()}
              </T>
            </View>
          </Row>
        ))}
      </Section>

      <Row gap={spacing.sm} style={{ marginTop: spacing.xl }} wrap>
        <Button small variant="secondary" icon="✨" title="Smart gift finder" onPress={() => router.push('/gift-finder')} />
        <Button small variant="secondary" icon="🎉" title="Events" onPress={() => router.push('/events')} />
        <Button small variant="secondary" icon="💬" title="Chats" onPress={() => router.push('/chats')} />
      </Row>
    </Screen>
  );
}

/** Global birthdays on the home screen: people you could make feel noticed today. */
function GlobalTeaser() {
  // Same query as the global screen, so opening it is instant. Hidden for
  // anyone not eligible (the API answers 403), so minors never see it.
  const today = useQuery({ queryKey: ['global', 'today'], queryFn: () => api.get<GlobalTodayDto>('/global/today', { limit: 50 }), retry: false });
  if (!today.data) return null;
  const { totalCelebrating, countries, items } = today.data;
  const firstTimers = items.filter((item) => item.firstCelebration).length;

  return (
    <Pressable onPress={() => router.push('/global')} style={{ marginTop: spacing.lg }} accessibilityRole="button" accessibilityLabel="Open global birthdays">
      <LinearGradient colors={gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius.xl, padding: spacing.lg }}>
        <Row gap={spacing.md}>
          <T style={{ fontSize: 34 }}>🌍</T>
          <View style={{ flex: 1 }}>
            <T variant="heading" color={colors.white}>
              {totalCelebrating === 0
                ? 'Global birthdays'
                : `${totalCelebrating} ${totalCelebrating === 1 ? 'person is' : 'people are'} celebrating today${countries > 1 ? ` in ${countries} countries` : ''}`}
            </T>
            <T variant="caption" color={colors.white} style={{ marginTop: 2, opacity: 0.95 }}>
              {firstTimers > 0
                ? `${firstTimers} celebrating for the first time. Make someone feel noticed 💜`
                : totalCelebrating === 0
                  ? 'Celebrate people around the world on their birthday.'
                  : 'Send a cheer, a wish or a small gift to someone who needs it 💜'}
            </T>
          </View>
        </Row>
        {items.length > 0 ? (
          <Row gap={0} style={{ marginTop: spacing.md }}>
            {items.slice(0, 6).map((item, index) => (
              <View key={item.userId} style={{ borderWidth: 2, borderColor: colors.white, borderRadius: 999, marginLeft: index === 0 ? 0 : -10 }}>
                <Avatar name={item.displayName} uri={item.avatarUrl} size={32} />
              </View>
            ))}
          </Row>
        ) : null}
      </LinearGradient>
    </Pressable>
  );
}
