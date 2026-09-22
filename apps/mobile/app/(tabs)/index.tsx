import type { HomeFeedResponse, TrackedBirthdayDto } from '@bday/shared';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { ProductCard } from '../../src/components/gifting';
import { Avatar, Button, Card, EmptyState, ErrorState, Icon, Photo, Row, Screen, Section, SkeletonCard, StoryAvatar, T } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { colors, gradients, radius, shadow, spacing } from '../../src/theme';

/**
 * Home (spec §6, §45, §65). A birthday app lives on faces and gifts, so this
 * reads as a feed: one hero, a strip of people, then rows to scroll. It is
 * never empty — global birthdays and marketplace rows carry a brand-new
 * account until it has friends of its own.
 */
export default function Home() {
  const feed = useQuery({ queryKey: ['home'], queryFn: () => api.get<HomeFeedResponse>('/home') });
  const data = feed.data;
  const next = data?.upcomingBirthdays?.[0] ?? null;

  return (
    <Screen edges={['top']} padded={false} refreshing={feed.isRefetching} onRefresh={() => void feed.refetch()}>
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: spacing.lg, paddingTop: spacing.sm }}>
        <View style={{ flex: 1 }}>
          <T variant="title">{data?.greeting ?? 'Hello'}</T>
          <T color={colors.textMuted}>Who’s celebrating soon?</T>
        </View>
        <Pressable onPress={() => router.push('/search')} accessibilityLabel="Search" style={{ padding: 8 }}>
          <Icon name="search" size={22} color={colors.text} />
        </Pressable>
        <Pressable onPress={() => router.push('/notifications')} accessibilityLabel="Notifications" style={{ padding: 8 }}>
          <Icon name="bell" size={22} color={colors.text} />
        </Pressable>
      </Row>

      {feed.error && !data ? <ErrorState error={feed.error} onRetry={() => void feed.refetch()} /> : null}
      {feed.isLoading ? (
        <View style={{ padding: spacing.lg }}>
          <SkeletonCard height={260} />
          <SkeletonCard height={120} />
        </View>
      ) : null}

      {/* the one thing that matters right now */}
      {data?.myBirthdayToday ? <MyBirthdayHero counts={data.myBirthdayToday} /> : next ? <NextBirthdayHero birthday={next} /> : data ? <StartHere /> : null}

      {/* people, as faces */}
      {data?.friendHighlights?.length ? (
        <Row wrap={false} style={{ paddingTop: spacing.lg }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingHorizontal: spacing.lg }}>
            {data!.friendHighlights.map((highlight) => (
              <View key={highlight.user.id} style={{ width: 84, alignItems: 'center' }}>
                <StoryAvatar
                  name={highlight.user.displayName}
                  uri={highlight.user.avatarUrl}
                  size={72}
                  tone={/today/i.test(highlight.detail) ? 'today' : /day|week/i.test(highlight.detail) ? 'soon' : 'none'}
                  label={highlight.user.displayName.split(' ')[0]}
                  onPress={() => router.push(`/person/${highlight.user.id}`)}
                />
                <T variant="caption" color={colors.textFaint} numberOfLines={1} center style={{ width: 84 }}>
                  {highlight.detail}
                </T>
              </View>
            ))}
          </ScrollView>
        </Row>
      ) : null}

      {/* the rest of the birthdays, as posters */}
      {(data?.upcomingBirthdays?.length ?? 0) > 1 ? (
        <Rail
          title="Coming up"
          icon="cake"
          action={{ label: 'See all', onPress: () => router.push('/(tabs)/birthdays') }}
          items={data!.upcomingBirthdays.slice(1)}
          keyOf={(birthday) => birthday.id}
          render={(birthday) => <BirthdayPoster birthday={birthday} />}
        />
      ) : null}

      {data?.globalToday && data.globalToday.people.length > 0 ? (
        <Rail
          title={`${data.globalToday.total} celebrating right now`}
          icon="globe"
          subtitle={data.globalToday.countries > 1 ? `Across ${data.globalToday.countries} countries — make someone feel noticed` : 'Make someone feel noticed'}
          action={{ label: 'Open', onPress: () => router.push('/global') }}
          items={data.globalToday.people}
          keyOf={(person) => person.userId}
          render={(person) => (
            <Pressable onPress={() => router.push('/global')} style={{ width: 96, alignItems: 'center' }}>
              <StoryAvatar name={person.displayName} uri={person.avatarUrl} size={80} tone="today" />
              <T variant="label" numberOfLines={1} center style={{ width: 96, marginTop: 6 }}>
                {person.displayName.split(' ')[0]}
              </T>
              <T variant="caption" color={colors.textMuted} numberOfLines={1} center style={{ width: 96 }}>
                {person.firstCelebration ? 'First celebration' : person.city ?? ''}
              </T>
            </Pressable>
          )}
        />
      ) : null}

      {data?.giftIdeas?.length ? (
        <Rail
          title="Gift ideas for you"
          icon="gift"
          action={{ label: 'Ask AI', onPress: () => router.push('/gift-finder') }}
          items={data!.giftIdeas}
          keyOf={(idea, index) => `${idea.name}-${index}`}
          render={(idea) => (
            <ProductCard
              product={idea}
              width={150}
              onPress={() => (idea.productId ? router.push(`/product/${idea.productId}`) : idea.forUser ? router.push(`/person/${idea.forUser.id}`) : undefined)}
            />
          )}
        />
      ) : null}

      {data?.moments?.length ? (
        <Rail
          title="Moments"
          icon="camera"
          subtitle="Photos from birthdays you were part of"
          action={{ label: 'All', onPress: () => router.push('/memories') }}
          items={data!.moments}
          keyOf={(moment) => moment.id}
          render={(moment) => (
            <Pressable onPress={() => router.push('/memories')} style={{ width: 132 }}>
              <View style={{ width: 132, height: 176, borderRadius: radius.lg, overflow: 'hidden' }}>
                <Image source={{ uri: moment.url }} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={180} />
                <LinearGradient colors={['transparent', 'rgba(16,24,40,0.7)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 80 }} />
                <View style={{ position: 'absolute', left: 8, right: 8, bottom: 8 }}>
                  <Row gap={6}>
                    <Avatar name={moment.owner.displayName} uri={moment.owner.avatarUrl} size={22} />
                    <T variant="caption" color={colors.white} numberOfLines={1} style={{ flex: 1 }}>
                      {moment.owner.displayName.split(' ')[0]} · {moment.celebrationYear}
                    </T>
                  </Row>
                </View>
              </View>
            </Pressable>
          )}
        />
      ) : null}

      {data?.shelves?.map((shelf) => (
        <Rail
          key={shelf.key}
          title={shelf.label}
          icon="bag"
          action={{ label: 'Browse', onPress: () => router.push('/(tabs)/gifts') }}
          items={shelf.products}
          keyOf={(product) => product.id}
          render={(product) => <ProductCard product={product} width={150} onPress={() => router.push(`/product/${product.id}`)} />}
        />
      ))}

      {data?.activity?.length ? (
        <View style={{ paddingHorizontal: spacing.lg }}>
          <Section icon="sparkles" title="Recent activity">
            {data!.activity.slice(0, 6).map((item) => (
              <Row key={item.id} gap={spacing.md} style={{ paddingVertical: spacing.sm }}>
                <Avatar name={item.actor?.displayName ?? ''} uri={item.actor?.avatarUrl} size={38} />
                <View style={{ flex: 1 }}>
                  <T numberOfLines={2}>{item.text}</T>
                  <T variant="caption" color={colors.textFaint}>
                    {new Date(item.createdAt).toLocaleDateString()}
                  </T>
                </View>
              </Row>
            ))}
          </Section>
        </View>
      ) : null}

      <Row gap={spacing.sm} style={{ marginTop: spacing.xl, marginBottom: spacing.xxl, paddingHorizontal: spacing.lg }} wrap>
        <Button small variant="secondary" icon="sparkles" title="Gift finder" onPress={() => router.push('/gift-finder')} />
        <Button small variant="secondary" icon="party" title="Events" onPress={() => router.push('/events')} />
        <Button small variant="secondary" icon="chat" title="Chats" onPress={() => router.push('/chats')} />
        <Button small variant="secondary" icon="calendarAdd" title="Add birthday" onPress={() => router.push('/birthday/new')} />
      </Row>
    </Screen>
  );
}

/** A titled horizontal row, the way a streaming app lays out its shelves. */
function Rail<T_ITEM>({
  title,
  subtitle,
  icon,
  action,
  items,
  keyOf,
  render,
}: {
  title: string;
  subtitle?: string;
  icon: Parameters<typeof Icon>[0]['name'];
  action?: { label: string; onPress: () => void };
  items: T_ITEM[];
  keyOf: (item: T_ITEM, index: number) => string;
  render: (item: T_ITEM) => React.ReactNode;
}) {
  return (
    <View style={{ marginTop: spacing.xl }}>
      <Row style={{ justifyContent: 'space-between', paddingHorizontal: spacing.lg, marginBottom: spacing.md }}>
        <Row gap={spacing.sm} style={{ flex: 1 }}>
          <Icon name={icon} size={18} color={colors.brand} />
          <View style={{ flex: 1 }}>
            <T variant="heading" numberOfLines={1}>
              {title}
            </T>
            {subtitle ? (
              <T variant="caption" color={colors.textMuted} numberOfLines={1}>
                {subtitle}
              </T>
            ) : null}
          </View>
        </Row>
        {action ? (
          <Pressable onPress={action.onPress} hitSlop={8}>
            <T variant="label" color={colors.brand}>
              {action.label}
            </T>
          </Pressable>
        ) : null}
      </Row>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md, paddingHorizontal: spacing.lg }}>
        {items.map((item, index) => (
          <View key={keyOf(item, index)}>{render(item)}</View>
        ))}
      </ScrollView>
    </View>
  );
}

/** The next birthday, as a full-width poster. */
function NextBirthdayHero({ birthday }: { birthday: TrackedBirthdayDto }) {
  const { width } = useWindowDimensions();
  const today = birthday.countdown.isToday;
  return (
    <Pressable
      onPress={() => router.push(`/birthday/${birthday.id}`)}
      style={[{ marginTop: spacing.lg, marginHorizontal: spacing.lg, height: Math.min(380, width * 0.95), borderRadius: radius.xl, overflow: 'hidden' }, shadow.card]}
    >
      <Photo uri={birthday.avatarUrl} name={birthday.name} />
      <LinearGradient colors={['rgba(16,24,40,0.1)', 'rgba(16,24,40,0.85)']} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      <View style={{ position: 'absolute', top: spacing.lg, left: spacing.lg }}>
        <View style={{ backgroundColor: today ? colors.accent : 'rgba(255,255,255,0.22)', borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 7 }}>
          <T variant="label" color={colors.white}>
            {today ? 'Today' : birthday.countdown.label}
          </T>
        </View>
      </View>
      <View style={{ position: 'absolute', left: spacing.lg, right: spacing.lg, bottom: spacing.lg }}>
        <T variant="display" color={colors.white} numberOfLines={1}>
          {birthday.name}
        </T>
        <T color="rgba(255,255,255,0.9)" style={{ marginBottom: spacing.md }}>
          {birthday.birthday.label}
          {birthday.countdown.turningAge ? ` · turning ${birthday.countdown.turningAge}` : ''}
          {birthday.newWishlistItemCount > 0 ? ` · ${birthday.newWishlistItemCount} new on their wishlist` : ''}
        </T>
        <Row gap={spacing.sm}>
          <Button small icon="bag" title="Send a gift" onPress={() => router.push({ pathname: '/send-gift', params: { birthdayId: birthday.id } })} style={{ flex: 1 }} />
          <Button small variant="secondary" icon="mail" title="Wish" onPress={() => router.push({ pathname: '/wish/send', params: { birthdayId: birthday.id } })} style={{ flex: 1 }} />
        </Row>
      </View>
    </Pressable>
  );
}

function MyBirthdayHero({ counts }: { counts: NonNullable<HomeFeedResponse['myBirthdayToday']> }) {
  return (
    <Pressable onPress={() => router.push('/celebration')} style={{ marginTop: spacing.lg, marginHorizontal: spacing.lg }}>
      <LinearGradient colors={gradients.celebration} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius.xl, padding: spacing.xl }}>
        <T variant="display" color={colors.white}>
          Happy birthday!
        </T>
        <T color="rgba(255,255,255,0.92)" style={{ marginTop: 6 }}>
          {counts.wishCount} {counts.wishCount === 1 ? 'wish' : 'wishes'} · {counts.giftCount} {counts.giftCount === 1 ? 'gift' : 'gifts'} waiting
          {counts.hasSurprise ? ' · something is being planned' : ''}
        </T>
        <Button small icon="play" title="Play your wishes" onPress={() => router.push('/wishes')} style={{ marginTop: spacing.lg, alignSelf: 'flex-start' }} />
      </LinearGradient>
    </Pressable>
  );
}

/** Day one: no birthdays yet, so the hero asks for the first one. */
function StartHere() {
  return (
    <Card style={{ marginTop: spacing.lg, marginHorizontal: spacing.lg, padding: 0, overflow: 'hidden' }}>
      <LinearGradient colors={gradients.celebration} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ padding: spacing.xl }}>
        <T variant="title" color={colors.white}>
          Never miss a birthday again
        </T>
        <T color="rgba(255,255,255,0.9)" style={{ marginTop: 6 }}>
          Add the people you care about, or import them from your contacts. We will remind you in time to plan something good.
        </T>
        <Row gap={spacing.sm} style={{ marginTop: spacing.lg }} wrap>
          <Button small icon="calendarAdd" title="Add a birthday" onPress={() => router.push('/birthday/new')} />
          <Button small variant="secondary" icon="contacts" title="Import contacts" onPress={() => router.push('/contacts-import')} />
        </Row>
      </LinearGradient>
    </Card>
  );
}

/** Upcoming birthdays as small posters in a row. */
function BirthdayPoster({ birthday }: { birthday: TrackedBirthdayDto }) {
  const today = birthday.countdown.isToday;
  return (
    <Pressable onPress={() => router.push(`/birthday/${birthday.id}`)} style={{ width: 148 }}>
      <View style={{ width: 148, height: 196, borderRadius: radius.lg, overflow: 'hidden' }}>
        <Photo uri={birthday.avatarUrl} name={birthday.name} />
        <LinearGradient colors={['transparent', 'rgba(16,24,40,0.8)']} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 110 }} />
        <View style={{ position: 'absolute', left: 10, right: 10, bottom: 10 }}>
          <T variant="label" color={colors.white} numberOfLines={1}>
            {birthday.name}
          </T>
          <T variant="caption" color={today ? '#FDBA74' : 'rgba(255,255,255,0.85)'} numberOfLines={1}>
            {birthday.countdown.label}
          </T>
        </View>
        {birthday.newWishlistItemCount > 0 ? (
          <View style={{ position: 'absolute', top: 8, right: 8, backgroundColor: colors.accent, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 }}>
            <T variant="caption" color={colors.white}>
              {birthday.newWishlistItemCount} new
            </T>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Kept so the empty state still explains itself if every rail is empty. */
export function HomeEmpty() {
  return <EmptyState icon="cake" title="Nothing yet" message="Add a birthday to get started." />;
}
