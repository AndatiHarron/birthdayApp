import { RealtimeEvent, type PublicProfile, type WishlistDto, type WishlistItemDto } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { WishlistItemRow, money } from '../../src/components/gifting';
import { Avatar, Badge, Button, Card, EmptyState, ErrorState, Loading, Row, Screen, Section, T, Toggle } from '../../src/components/ui';
import { api, errorMessage } from '../../src/lib/api';
import { useRealtimeRoom } from '../../src/lib/realtime';
import { colors, spacing } from '../../src/theme';

/** Someone's profile and wishlist, as a gifter sees it (spec §5, §10, §13). */
export default function Person() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const profile = useQuery({ queryKey: ['profile', id], queryFn: () => api.get<PublicProfile>(`/users/${id}`) });
  const wishlist = useQuery({
    queryKey: ['wishlist', 'user', id],
    queryFn: () => api.get<WishlistDto>(`/users/${id}/wishlist`),
    enabled: profile.data?.wishlistAccess === 'VISIBLE',
  });

  // Another gifter reserving an item flips it to "someone is getting this" live.
  useRealtimeRoom('wishlist', profile.data?.isSelf ? undefined : wishlist.data?.id, {
    [RealtimeEvent.RESERVATION_CHANGED]: () => void queryClient.invalidateQueries({ queryKey: ['wishlist', 'user', id] }),
    [RealtimeEvent.WISHLIST_ITEM_ADDED]: () => void queryClient.invalidateQueries({ queryKey: ['wishlist', 'user', id] }),
  });

  const friendRequest = useMutation({
    mutationFn: () => api.post('/friends/request', { userId: id }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['profile', id] }),
    onError: (error) => Alert.alert('Could not send request', errorMessage(error)),
  });

  if (profile.isLoading) return <Loading />;
  if (!profile.data) return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  const person = profile.data;
  const friendship = person.friendship;

  return (
    <Screen refreshing={wishlist.isRefetching} onRefresh={() => { void profile.refetch(); void wishlist.refetch(); }}>
      <Stack.Screen options={{ title: person.displayName }} />
      <Card style={{ alignItems: 'center' }}>
        <Avatar name={person.displayName} uri={person.avatarUrl} size={88} />
        <T variant="title" style={{ marginTop: spacing.md }}>
          {person.displayName}
        </T>
        <T color={colors.textMuted}>@{person.username}</T>
        {person.birthday ? (
          <T variant="label" color={colors.pink} style={{ marginTop: spacing.sm }}>
            🎂 {person.birthday.label} · {person.birthday.countdown.label}
            {person.age != null ? ` · ${person.age} years` : ''}
          </T>
        ) : null}
        {person.bio ? <T style={{ marginTop: spacing.sm }} center>{person.bio}</T> : null}
        <Row wrap style={{ marginTop: spacing.md, justifyContent: 'center' }}>
          {person.interests.map((interest) => (
            <Badge key={interest.slug} label={`${interest.emoji ?? ''} ${interest.label}`} tone="info" />
          ))}
        </Row>
        {!person.isSelf ? (
          <Row style={{ marginTop: spacing.lg }} wrap>
            {!friendship ? <Button small title="Add friend" icon="➕" loading={friendRequest.isPending} onPress={() => friendRequest.mutate()} /> : null}
            {friendship?.status === 'PENDING' ? <Badge label={friendship.outgoing ? 'Request sent' : 'Wants to connect'} tone="gold" /> : null}
            {friendship?.status === 'PENDING' && !friendship.outgoing ? <Button small title="Respond" onPress={() => router.push('/friends')} /> : null}
            <Button small variant="secondary" icon="💌" title="Wish" onPress={() => router.push({ pathname: '/wish/send', params: { userId: person.id, name: person.displayName } })} />
            <Button small variant="secondary" icon="🎁" title="Gift" onPress={() => router.push({ pathname: '/send-gift', params: { userId: person.id, name: person.displayName } })} />
            {friendship?.status === 'ACCEPTED' ? <Button small variant="secondary" icon="💬" title="Chat" onPress={() => void api.post<{ id: string }>('/conversations', { memberIds: [person.id] }).then((conversation) => router.push(`/chat/${conversation.id}`)).catch((error) => Alert.alert('Chat unavailable', errorMessage(error)))} /> : null}
          </Row>
        ) : null}
      </Card>

      {person.giftPreferences && (person.giftPreferences.favoriteColors.length || Object.keys(person.giftPreferences.sizes).length || person.giftPreferences.dislikes.length) ? (
        <Section title="Gift preferences">
          <Card>
            {Object.entries(person.giftPreferences.sizes).map(([item, size]) => (
              <T key={item}>📏 {item}: {size}</T>
            ))}
            {person.giftPreferences.favoriteColors.length ? <T>🎨 Loves {person.giftPreferences.favoriteColors.join(', ')}</T> : null}
            {person.giftPreferences.favoriteBrands.length ? <T>🏷️ Brands: {person.giftPreferences.favoriteBrands.join(', ')}</T> : null}
            {person.giftPreferences.dislikes.length ? <T>🚫 Not a fan of {person.giftPreferences.dislikes.join(', ')}</T> : null}
            {person.giftPreferences.allergies.length ? <T>⚠️ Allergies: {person.giftPreferences.allergies.join(', ')}</T> : null}
            {person.giftPreferences.notes ? <T>📝 {person.giftPreferences.notes}</T> : null}
          </Card>
        </Section>
      ) : null}

      <Section title="🎁 Wishlist" action={!person.isSelf ? <Button small variant="ghost" title="✨ Ideas" onPress={() => router.push({ pathname: '/gift-finder', params: { userId: person.id } })} /> : undefined}>
        {person.wishlistAccess === 'HIDDEN' ? <EmptyState emoji="🔒" title="This wishlist is private" message={friendship?.status === 'ACCEPTED' ? undefined : 'Become friends to see it.'} /> : null}
        {person.wishlistAccess === 'NONE' ? <EmptyState emoji="📝" title="No wishlist yet" /> : null}
        {wishlist.isLoading ? <Loading /> : null}
        {wishlist.error ? <ErrorState error={wishlist.error} /> : null}
        {wishlist.data && wishlist.data.items.length === 0 ? <EmptyState emoji="🎈" title="Nothing on the list yet" /> : null}
        {wishlist.data?.items.map((item) => (
          <GifterItem key={item.id} item={item} isOwner={person.isSelf} ownerName={person.displayName} ownerId={person.id} onChanged={() => void wishlist.refetch()} />
        ))}
      </Section>
    </Screen>
  );
}

function GifterItem({ item, isOwner, ownerName, ownerId, onChanged }: { item: WishlistItemDto; isOwner: boolean; ownerName: string; ownerId: string; onChanged: () => void }) {
  const [anonymous, setAnonymous] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const reserve = useMutation({
    mutationFn: () => api.post(`/gifts/${item.id}/reserve`, { isAnonymous: anonymous }),
    onSuccess: () => {
      setExpanded(false);
      onChanged();
      Alert.alert('🎁 Reserved!', `Nobody else can claim “${item.name}” now. ${ownerName.split(' ')[0]} won’t see that you did.`);
    },
    onError: (error) => {
      onChanged();
      Alert.alert('Couldn’t reserve', errorMessage(error));
    },
  });

  if (isOwner) return <WishlistItemRow item={item} isOwner />;

  const taken = item.reservation && !item.reservation.isMine && item.status !== 'AVAILABLE';
  const mine = item.reservation?.isMine;

  return (
    <WishlistItemRow
      item={item}
      isOwner={false}
      onPress={() => setExpanded(!expanded)}
      actions={
        taken ? null : mine ? (
          <Row wrap>
            <Button small variant="secondary" title="Manage" onPress={() => router.push('/reservations')} />
            {item.productId ? <Button small title="Buy in app" onPress={() => router.push({ pathname: '/product/[id]', params: { id: item.productId!, wishlistItemId: item.id, recipientUserId: ownerId } })} /> : null}
          </Row>
        ) : expanded ? (
          <View>
            <Toggle label="Stay anonymous to other gifters" value={anonymous} onChange={setAnonymous} />
            <Row wrap>
              <Button small icon="🎁" title="I’ll get this" loading={reserve.isPending} onPress={() => reserve.mutate()} />
              {item.priceMinor && item.priceMinor >= 500_000 ? (
                <Button
                  small
                  variant="secondary"
                  icon="👥"
                  title="Chip in together"
                  onPress={() => router.push({ pathname: '/group-gift/new', params: { wishlistItemId: item.id, title: item.name, target: String(item.priceMinor), currency: item.currency, beneficiaryUserId: ownerId, name: ownerName } })}
                />
              ) : null}
              {item.productUrl ? <T variant="caption" color={colors.textMuted}>Available at {item.merchant ?? 'the shop'} · {money(item.priceMinor, item.currency)}</T> : null}
            </Row>
          </View>
        ) : (
          <Button small icon="🎁" title="I’ll get this" onPress={() => setExpanded(true)} style={{ alignSelf: 'flex-start' }} />
        )
      }
    />
  );
}
