import type { NotificationDto, Paginated } from '@bday/shared';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useEffect } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { Button, EmptyState, ErrorState, Loading, Row, T } from '../src/components/ui';
import { api } from '../src/lib/api';
import { routeForDeepLink } from '../src/lib/push';
import { colors, spacing } from '../src/theme';

/** In-app notification inbox (spec §28) — the source of truth behind every push. */
export default function Notifications() {
  const queryClient = useQueryClient();
  const list = useInfiniteQuery({
    queryKey: ['notifications'],
    queryFn: ({ pageParam }) => api.get<Paginated<NotificationDto>>('/notifications', { cursor: pageParam, limit: 30 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const markAll = useMutation({
    mutationFn: () => api.post('/notifications/read', { all: true }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['unread-count'] });
    },
  });

  useEffect(() => () => void queryClient.invalidateQueries({ queryKey: ['unread-count'] }), [queryClient]);

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'Notifications', headerRight: () => <Button small variant="ghost" title="Mark all read" onPress={() => markAll.mutate()} /> }} />
      {list.isLoading ? <Loading /> : null}
      {list.error && items.length === 0 ? <ErrorState error={list.error} onRetry={() => void list.refetch()} /> : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        refreshing={list.isRefetching}
        onRefresh={() => void list.refetch()}
        onEndReached={() => list.hasNextPage && void list.fetchNextPage()}
        ListEmptyComponent={!list.isLoading ? <EmptyState emoji="🔔" title="You’re all caught up" /> : null}
        renderItem={({ item }) => (
          <Pressable
            onPress={() => {
              if (!item.readAt) void api.post('/notifications/read', { ids: [item.id] }).then(() => queryClient.invalidateQueries({ queryKey: ['notifications'] }));
              const target = routeForDeepLink(item.deepLink);
              if (target && target !== '/notifications') router.push(target as never);
            }}
            style={{ padding: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.border, backgroundColor: item.readAt ? colors.bg : colors.surface }}
          >
            <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
              {!item.readAt ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.brand, marginTop: 7 }} /> : <View style={{ width: 8 }} />}
              <View style={{ flex: 1 }}>
                <T variant="label">{item.title}</T>
                <T color={colors.textMuted}>{item.body}</T>
                <T variant="caption" color={colors.textFaint} style={{ marginTop: 2 }}>
                  {new Date(item.createdAt).toLocaleString()}
                </T>
              </View>
            </Row>
          </Pressable>
        )}
      />
    </View>
  );
}
