import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { Alert, View } from 'react-native';
import { money } from '../src/components/gifting';
import { Badge, Button, Card, EmptyState, ErrorState, Loading, Row, Screen, T } from '../src/components/ui';
import { api, errorMessage } from '../src/lib/api';
import { colors, spacing } from '../src/theme';

interface MyReservation {
  id: string;
  status: 'RESERVED' | 'PURCHASED' | 'DELIVERED';
  quantity: number;
  createdAt: string;
  item: { id: string; name: string; imageUrl: string | null; priceMinor: number | null; currency: string; productUrl: string | null };
  recipient: { id: string; displayName: string; avatarUrl: string | null };
}

/** Gifts I'm giving — reservations I made (spec §13). */
export default function Reservations() {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['reservations'], queryFn: () => api.get<MyReservation[]>('/gifts/reservations') });
  const update = useMutation({
    mutationFn: (input: { id: string; status: 'PURCHASED' | 'DELIVERED' | 'CANCELLED' }) => api.patch(`/gifts/reservations/${input.id}`, { status: input.status }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['reservations'] }),
    onError: (error) => Alert.alert('Error', errorMessage(error)),
  });

  return (
    <Screen refreshing={list.isRefetching} onRefresh={() => void list.refetch()}>
      <Stack.Screen options={{ title: 'Gifts I’m giving' }} />
      {list.isLoading ? <Loading /> : null}
      {list.error ? <ErrorState error={list.error} /> : null}
      {list.data?.length === 0 ? <EmptyState emoji="🎁" title="No reserved gifts" message="Tap “I’ll get this” on a friend’s wishlist." /> : null}
      {list.data?.map((reservation) => (
        <Card key={reservation.id} style={{ marginBottom: spacing.md }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <T variant="heading">{reservation.item.name}</T>
              <T color={colors.textMuted}>
                For {reservation.recipient.displayName}
                {reservation.item.priceMinor ? ` · ${money(reservation.item.priceMinor, reservation.item.currency)}` : ''}
              </T>
            </View>
            <Badge label={reservation.status.toLowerCase()} tone={reservation.status === 'DELIVERED' ? 'success' : 'brand'} />
          </Row>
          <Row wrap style={{ marginTop: spacing.md }}>
            {reservation.status === 'RESERVED' ? <Button small title="Mark bought" onPress={() => update.mutate({ id: reservation.id, status: 'PURCHASED' })} /> : null}
            {reservation.status !== 'DELIVERED' ? <Button small variant="secondary" title="Mark given" onPress={() => update.mutate({ id: reservation.id, status: 'DELIVERED' })} /> : null}
            {reservation.status === 'RESERVED' ? (
              <Button small variant="danger" title="Release" onPress={() => Alert.alert('Release this gift?', 'Others will be able to reserve it.', [{ text: 'Keep', style: 'cancel' }, { text: 'Release', style: 'destructive', onPress: () => update.mutate({ id: reservation.id, status: 'CANCELLED' }) }])} />
            ) : null}
            <Button small variant="ghost" title="Wishlist" onPress={() => router.push(`/person/${reservation.recipient.id}`)} />
          </Row>
        </Card>
      ))}
    </Screen>
  );
}
