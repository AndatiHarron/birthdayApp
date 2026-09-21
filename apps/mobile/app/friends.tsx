import type { FriendDto, FriendRequestDto, PublicProfile } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, TextInput, View } from 'react-native';
import { Avatar, Badge, Button, Card, Chip, EmptyState, Icon, Loading, Row, Screen, Section, T } from '../src/components/ui';
import { api, errorMessage } from '../src/lib/api';
import { colors, radius, spacing } from '../src/theme';

/** Friends, requests and people search (spec §9). */
export default function Friends() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'friends' | 'requests' | 'find'>('friends');
  const friends = useQuery({ queryKey: ['friends'], queryFn: () => api.get<FriendDto[]>('/friends') });
  const incoming = useQuery({ queryKey: ['friend-requests', 'INCOMING'], queryFn: () => api.get<FriendRequestDto[]>('/friends/requests', { direction: 'INCOMING' }) });
  const outgoing = useQuery({ queryKey: ['friend-requests', 'OUTGOING'], queryFn: () => api.get<FriendRequestDto[]>('/friends/requests', { direction: 'OUTGOING' }) });
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setTerm(q.trim()), 350);
    return () => clearTimeout(timer);
  }, [q]);
  const results = useQuery({ queryKey: ['user-search', term], queryFn: () => api.get<PublicProfile[]>('/users/search', { q: term }), enabled: term.length >= 2 });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['friends'] });
    void queryClient.invalidateQueries({ queryKey: ['friend-requests'] });
    void queryClient.invalidateQueries({ queryKey: ['birthdays'] });
    void queryClient.invalidateQueries({ queryKey: ['user-search'] });
  };

  const respond = useMutation({ mutationFn: (input: { requestId: string; action: 'ACCEPT' | 'DECLINE' }) => api.post('/friends/respond', input), onSuccess: invalidate, onError: (error) => Alert.alert('Error', errorMessage(error)) });
  const request = useMutation({ mutationFn: (userId: string) => api.post('/friends/request', { userId }), onSuccess: invalidate, onError: (error) => Alert.alert('Could not send', errorMessage(error)) });
  const cancel = useMutation({ mutationFn: (requestId: string) => api.delete(`/friends/requests/${requestId}`), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (userId: string) => api.delete(`/friends/${userId}`), onSuccess: invalidate });
  const block = useMutation({ mutationFn: (userId: string) => api.post('/users/block', { userId }), onSuccess: invalidate });
  const favorite = useMutation({ mutationFn: (input: { userId: string; isFavorite: boolean }) => api.patch(`/friends/${input.userId}`, { isFavorite: input.isFavorite }), onSuccess: invalidate });

  const requestCount = incoming.data?.length ?? 0;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Friends' }} />
      <Row wrap style={{ marginBottom: spacing.lg }}>
        <Chip label={`Friends (${friends.data?.length ?? 0})`} selected={tab === 'friends'} onPress={() => setTab('friends')} />
        <Chip label={`Requests${requestCount ? ` (${requestCount})` : ''}`} selected={tab === 'requests'} onPress={() => setTab('requests')} />
        <Chip icon="search" label="Find people" selected={tab === 'find'} onPress={() => setTab('find')} />
      </Row>

      {tab === 'friends' ? (
        <>
          {friends.isLoading ? <Loading /> : null}
          {friends.data?.length === 0 ? <EmptyState icon="users" title="No friends yet" action={<Button title="Find people" onPress={() => setTab('find')} />} /> : null}
          {friends.data?.map((friend) => (
            <Card key={friend.friendshipId} onPress={() => router.push(`/person/${friend.user.id}`)} style={{ marginBottom: spacing.sm }}>
              <Row gap={spacing.md}>
                <Avatar name={friend.user.displayName} uri={friend.user.avatarUrl} />
                <View style={{ flex: 1 }}>
                  <T variant="label">{friend.user.displayName}</T>
                  <T variant="caption" color={colors.textMuted}>
                    {friend.user.birthday ? `${friend.user.birthday.label} · ${friend.user.birthday.countdown.label}` : `@${friend.user.username}`}
                  </T>
                  <Row wrap style={{ marginTop: 4 }}>
                    {friend.relationship ? <Badge label={friend.relationship.replace('_', ' ').toLowerCase()} tone="muted" /> : null}
                    {friend.groups.map((group) => <Badge key={group.id} label={group.name} tone="info" />)}
                  </Row>
                </View>
                <Pressable accessibilityLabel="Favourite" onPress={() => favorite.mutate({ userId: friend.user.id, isFavorite: !friend.isFavorite })} style={{ padding: spacing.sm }}>
                  <Icon name="star" size={20} color={friend.isFavorite ? colors.gold : colors.textFaint} fill={friend.isFavorite ? colors.gold : 'none'} />
                </Pressable>
                <Button
                  small
                  variant="ghost"
                  title="⋯"
                  onPress={() =>
                    Alert.alert(friend.user.displayName, undefined, [
                      { text: 'Remove friend', style: 'destructive', onPress: () => remove.mutate(friend.user.id) },
                      { text: 'Block', style: 'destructive', onPress: () => block.mutate(friend.user.id) },
                      { text: 'Report', onPress: () => router.push({ pathname: '/report', params: { targetType: 'USER', targetId: friend.user.id } }) },
                      { text: 'Cancel', style: 'cancel' },
                    ])
                  }
                />
              </Row>
            </Card>
          ))}
        </>
      ) : null}

      {tab === 'requests' ? (
        <>
          <Section title="Received" style={{ marginTop: 0 }}>
            {incoming.data?.length === 0 ? <T color={colors.textMuted}>No pending requests.</T> : null}
            {incoming.data?.map((item) => (
              <Card key={item.id} style={{ marginBottom: spacing.sm }}>
                <Row gap={spacing.md}>
                  <Avatar name={item.user.displayName} uri={item.user.avatarUrl} />
                  <View style={{ flex: 1 }}>
                    <T variant="label">{item.user.displayName}</T>
                    {item.message ? <T variant="caption" color={colors.textMuted}>“{item.message}”</T> : null}
                  </View>
                </Row>
                <Row style={{ marginTop: spacing.md }}>
                  <Button small title="Accept" onPress={() => respond.mutate({ requestId: item.id, action: 'ACCEPT' })} />
                  <Button small variant="secondary" title="Decline" onPress={() => respond.mutate({ requestId: item.id, action: 'DECLINE' })} />
                </Row>
              </Card>
            ))}
          </Section>
          <Section title="Sent">
            {outgoing.data?.map((item) => (
              <Row key={item.id} gap={spacing.md} style={{ paddingVertical: spacing.sm }}>
                <Avatar name={item.user.displayName} uri={item.user.avatarUrl} size={36} />
                <T style={{ flex: 1 }}>{item.user.displayName}</T>
                <Button small variant="ghost" title="Cancel" onPress={() => cancel.mutate(item.id)} />
              </Row>
            ))}
          </Section>
        </>
      ) : null}

      {tab === 'find' ? (
        <>
          <TextInput
            autoFocus
            value={q}
            onChangeText={setQ}
            placeholder="Name, @username, phone or email"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            style={{ minHeight: 48, borderRadius: radius.pill, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.lg, color: colors.text, marginBottom: spacing.md }}
          />
          <Row wrap style={{ marginBottom: spacing.md }}>
            <Button small variant="secondary" icon="send" title="Invite by link or QR" onPress={() => router.push('/invite')} />
            <Button small variant="secondary" icon="contacts" title="From contacts" onPress={() => router.push('/contacts-import')} />
          </Row>
          {results.isFetching ? <Loading /> : null}
          {results.data?.length === 0 ? <T color={colors.textMuted}>No one found. Try inviting them instead.</T> : null}
          {results.data?.map((person) => (
            <Card key={person.id} onPress={() => router.push(`/person/${person.id}`)} style={{ marginBottom: spacing.sm }}>
              <Row gap={spacing.md}>
                <Avatar name={person.displayName} uri={person.avatarUrl} />
                <View style={{ flex: 1 }}>
                  <T variant="label">{person.displayName}</T>
                  <T variant="caption" color={colors.textMuted}>@{person.username}</T>
                </View>
                {person.friendship?.status === 'ACCEPTED' ? <Badge label="Friends" tone="success" /> : person.friendship?.status === 'PENDING' ? <Badge label="Pending" tone="gold" /> : <Button small title="Add" onPress={() => request.mutate(person.id)} />}
              </Row>
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}
