import type { WishlistDto } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, Share, View } from 'react-native';
import { WishlistItemRow } from '../../src/components/gifting';
import { Badge, Button, Card, Chip, EmptyState, ErrorState, Row, Screen, SkeletonCard, T } from '../../src/components/ui';
import { api, errorMessage } from '../../src/lib/api';
import { colors, spacing } from '../../src/theme';

/** Your own wishlists (spec §10–12). Reservation state is never shown here. */
export default function Wishlist() {
  const queryClient = useQueryClient();
  const lists = useQuery({ queryKey: ['my-wishlists'], queryFn: () => api.get<WishlistDto[]>('/wishlists/mine') });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const activeId = selectedId ?? lists.data?.find((list) => list.isDefault)?.id ?? lists.data?.[0]?.id;

  const detail = useQuery({
    queryKey: ['wishlist', activeId],
    queryFn: () => api.get<WishlistDto>(`/wishlists/${activeId}`),
    enabled: Boolean(activeId),
  });

  const remove = useMutation({
    mutationFn: (itemId: string) => api.delete(`/wishlist/items/${itemId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wishlist', activeId] });
      void queryClient.invalidateQueries({ queryKey: ['my-wishlists'] });
    },
    onError: (error) => Alert.alert('Could not remove', errorMessage(error)),
  });

  async function share() {
    if (!detail.data) return;
    await Share.share({ message: `🎁 Here's my birthday wishlist: ${detail.data.shareUrl}`, url: detail.data.shareUrl });
  }

  const wishlist = detail.data;

  return (
    <Screen edges={['top']} refreshing={detail.isRefetching} onRefresh={() => void detail.refetch()}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="title">My wishlist</T>
        <Row>
          <Button small variant="secondary" icon="📤" title="Share" onPress={() => void share()} disabled={!wishlist} />
          <Button small icon="＋" title="Add" onPress={() => router.push({ pathname: '/wishlist/item-new', params: { wishlistId: activeId ?? '' } })} />
        </Row>
      </Row>

      {lists.data && lists.data.length > 1 ? (
        <Row wrap style={{ marginTop: spacing.md }}>
          {lists.data.map((list) => (
            <Chip key={list.id} label={`${list.title} (${list.itemCount})`} selected={list.id === activeId} onPress={() => setSelectedId(list.id)} />
          ))}
        </Row>
      ) : null}

      {lists.error && !lists.data ? <ErrorState error={lists.error} onRetry={() => void lists.refetch()} /> : null}

      {wishlist ? (
        <Card style={{ marginTop: spacing.md, backgroundColor: colors.brandSoft, borderColor: colors.brandSoft }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <T variant="heading">{wishlist.title}</T>
              <T variant="caption" color={colors.textMuted}>
                {wishlist.itemCount} items · {wishlist.viewCount ?? 0} views
              </T>
            </View>
            <Badge label={wishlist.visibility === 'PUBLIC' ? '🌍 Public' : wishlist.visibility === 'FRIENDS' ? '👥 Friends' : '🔒 Private'} />
          </Row>
          <Row style={{ marginTop: spacing.md }} wrap>
            <Button small variant="ghost" title="Settings & sharing" onPress={() => router.push({ pathname: '/wishlist/settings', params: { id: wishlist.id } })} />
          </Row>
          <T variant="caption" color={colors.brandDark} style={{ marginTop: 4 }}>
            🤫 What friends reserve stays a surprise — you’ll never see it here.
          </T>
        </Card>
      ) : null}

      <View style={{ marginTop: spacing.lg }}>
        {detail.isLoading || lists.isLoading ? [0, 1, 2].map((key) => <SkeletonCard key={key} />) : null}
        {wishlist && wishlist.items.length === 0 ? (
          <EmptyState
            emoji="💝"
            title="Your wishlist is empty"
            message="Add things you’d love — paste a product link and we’ll fill in the details."
            action={<Button title="Add your first wish" onPress={() => router.push({ pathname: '/wishlist/item-new', params: { wishlistId: wishlist.id } })} />}
          />
        ) : null}
        {wishlist?.items.map((item) => (
          <WishlistItemRow
            key={item.id}
            item={item}
            isOwner
            onPress={() => router.push({ pathname: '/wishlist/item-new', params: { wishlistId: wishlist.id, itemId: item.id } })}
            actions={
              <Row>
                <Button small variant="secondary" title="Edit" onPress={() => router.push({ pathname: '/wishlist/item-new', params: { wishlistId: wishlist.id, itemId: item.id } })} />
                <Button
                  small
                  variant="danger"
                  title="Remove"
                  onPress={() => Alert.alert('Remove this wish?', item.name, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => remove.mutate(item.id) }])}
                />
              </Row>
            }
          />
        ))}
      </View>
    </Screen>
  );
}
