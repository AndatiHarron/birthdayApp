import type { WishlistDto } from '@bday/shared';
import { useQuery } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { WishlistItemRow } from '../../src/components/gifting';
import { Avatar, Button, Card, EmptyState, ErrorState, Loading, Row, Screen, T } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { colors, spacing } from '../../src/theme';

/** A shared wishlist link opened in the app (spec §12). Works signed out too. */
export default function SharedWishlist() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { status, user } = useAuth();
  const wishlist = useQuery({ queryKey: ['wishlist', 'share', slug], queryFn: () => api.get<WishlistDto>(`/wishlists/share/${slug}`) });

  if (wishlist.isLoading) return <Loading />;
  if (!wishlist.data) return <ErrorState error={wishlist.error} />;
  const data = wishlist.data;
  const isOwner = data.ownerId === user?.id;

  return (
    <Screen>
      <Stack.Screen options={{ title: data.title }} />
      <Card>
        <Row gap={spacing.md}>
          <Avatar name={data.owner.displayName} uri={data.owner.avatarUrl} size={56} />
          <T variant="title" style={{ flex: 1 }}>{data.owner.displayName}’s {data.title}</T>
        </Row>
        {data.description ? <T color={colors.textMuted} style={{ marginTop: spacing.sm }}>{data.description}</T> : null}
        {status === 'signed-in' && !isOwner ? <Button title="Open profile to reserve gifts" onPress={() => router.replace(`/person/${data.ownerId}`)} style={{ marginTop: spacing.md }} /> : null}
        {status !== 'signed-in' ? <Button title="Join to reserve a gift" onPress={() => router.replace('/(auth)/sign-up')} style={{ marginTop: spacing.md }} /> : null}
      </Card>
      {data.items.length === 0 ? <EmptyState icon="party" title="Nothing on the list yet" /> : null}
      {data.items.map((item) => (
        <WishlistItemRow key={item.id} item={item} isOwner={isOwner} />
      ))}
    </Screen>
  );
}
