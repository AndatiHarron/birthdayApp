import type { OrderDto, Paginated } from '@bday/shared';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { money } from '../src/components/gifting';
import { Badge, Card, Chip, EmptyState, ErrorState, Loading, Row, T } from '../src/components/ui';
import { api } from '../src/lib/api';
import { colors, spacing } from '../src/theme';

export default function Orders() {
  const [direction, setDirection] = useState<'SENT' | 'RECEIVED'>('SENT');
  const orders = useInfiniteQuery({
    queryKey: ['orders', direction],
    queryFn: ({ pageParam }) => api.get<Paginated<OrderDto>>('/orders', { direction, cursor: pageParam, limit: 20 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = orders.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'Orders' }} />
      <Row style={{ padding: spacing.lg, paddingBottom: 0 }}>
        <Chip label="🎁 Gifts I sent" selected={direction === 'SENT'} onPress={() => setDirection('SENT')} />
        <Chip label="📦 Gifts I received" selected={direction === 'RECEIVED'} onPress={() => setDirection('RECEIVED')} />
      </Row>
      {orders.isLoading ? <Loading /> : null}
      {orders.error && items.length === 0 ? <ErrorState error={orders.error} onRetry={() => void orders.refetch()} /> : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg }}
        refreshing={orders.isRefetching}
        onRefresh={() => void orders.refetch()}
        onEndReached={() => orders.hasNextPage && void orders.fetchNextPage()}
        ListEmptyComponent={!orders.isLoading ? <EmptyState emoji="📦" title="No orders yet" /> : null}
        renderItem={({ item }) => (
          <Card onPress={() => router.push(`/order/${item.id}`)} style={{ marginBottom: spacing.md }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T variant="label">{item.reference}</T>
              <Badge label={(item.delivery?.status ?? item.status).replace(/_/g, ' ').toLowerCase()} tone={item.status === 'FULFILLED' ? 'success' : item.status === 'CANCELLED' ? 'danger' : 'brand'} />
            </Row>
            <T style={{ marginTop: 4 }}>{item.items.map((line) => `${line.quantity}× ${line.name}`).join(', ')}</T>
            <T color={colors.textMuted}>
              {item.recipient ? `For ${item.recipient.name} · ` : ''}
              {direction === 'SENT' ? money(item.totalMinor, item.currency) : new Date(item.createdAt).toLocaleDateString()}
            </T>
          </Card>
        )}
      />
    </View>
  );
}
