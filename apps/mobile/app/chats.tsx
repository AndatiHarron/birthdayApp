import type { ConversationDto } from '@bday/shared';
import { useQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { FlatList, View } from 'react-native';
import { Avatar, Badge, Card, EmptyState, ErrorState, Loading, Row, T } from '../src/components/ui';
import { api } from '../src/lib/api';
import { colors, spacing } from '../src/theme';

export default function Chats() {
  const conversations = useQuery({ queryKey: ['conversations'], queryFn: () => api.get<ConversationDto[]>('/conversations'), refetchInterval: 30_000 });

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ title: 'Chats' }} />
      {conversations.isLoading ? <Loading /> : null}
      {conversations.error && !conversations.data ? <ErrorState error={conversations.error} onRetry={() => void conversations.refetch()} /> : null}
      <FlatList
        data={conversations.data ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: spacing.lg }}
        refreshing={conversations.isRefetching}
        onRefresh={() => void conversations.refetch()}
        ListEmptyComponent={!conversations.isLoading ? <EmptyState icon="chat" title="No chats yet" message="Surprise planning groups, event chats and friend chats appear here." /> : null}
        renderItem={({ item }) => (
          <Card onPress={() => router.push(`/chat/${item.id}`)} style={{ marginBottom: spacing.sm }}>
            <Row gap={spacing.md}>
              <Avatar name={item.title ?? 'Chat'} uri={item.imageUrl} />
              <View style={{ flex: 1 }}>
                <Row style={{ justifyContent: 'space-between' }}>
                  <T variant="label" numberOfLines={1} style={{ flex: 1 }}>
                    {item.type === 'SURPRISE_GROUP' ? '' : item.type === 'EVENT' ? '' : ''}
                    {item.title ?? 'Chat'}
                  </T>
                  {item.unreadCount > 0 ? <Badge label={String(item.unreadCount)} tone="danger" /> : null}
                </Row>
                <T color={colors.textMuted} numberOfLines={1}>
                  {item.lastMessage ? `${item.lastMessage.sender?.displayName ? `${item.lastMessage.sender.displayName}: ` : ''}${item.lastMessage.body ?? (item.lastMessage.kind === 'VOICE' ? 'Voice note' : item.lastMessage.kind === 'IMAGE' ? 'Photo' : '')}` : `${item.memberCount} members`}
                </T>
              </View>
            </Row>
          </Card>
        )}
      />
    </View>
  );
}
