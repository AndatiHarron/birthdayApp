import type { GroupGiftDto, SurpriseDto } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { FriendPicker } from '../../src/components/FriendPicker';
import { money } from '../../src/components/gifting';
import { Avatar, Badge, Button, Card, ErrorState, Loading, ProgressBar, Row, Screen, Section, T } from '../../src/components/ui';
import { api, errorMessage } from '../../src/lib/api';
import { colors, spacing } from '../../src/theme';

/** Surprise steps (spec §49): group → budget → gift → contributions → delivery → reveal. */
export default function SurpriseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const surprise = useQuery({ queryKey: ['surprise', id], queryFn: () => api.get<SurpriseDto>(`/surprises/${id}`) });
  const gift = useQuery({
    queryKey: ['group-gift', surprise.data?.groupGiftId],
    queryFn: () => api.get<GroupGiftDto>(`/gifts/group/${surprise.data!.groupGiftId}`),
    enabled: Boolean(surprise.data?.groupGiftId),
  });
  const [adding, setAdding] = useState<string[]>([]);

  const addMembers = useMutation({
    mutationFn: () => api.post(`/surprises/${id}/members`, { memberIds: adding }),
    onSuccess: () => { setAdding([]); void queryClient.invalidateQueries({ queryKey: ['surprise', id] }); },
    onError: (error) => Alert.alert('Error', errorMessage(error)),
  });
  const leave = useMutation({ mutationFn: () => api.post(`/surprises/${id}/leave`), onSuccess: () => router.back(), onError: (error) => Alert.alert('Error', errorMessage(error)) });
  const markRevealed = useMutation({ mutationFn: () => api.post(`/surprises/${id}/reveal`), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['surprise', id] }), onError: (error) => Alert.alert('Error', errorMessage(error)) });

  if (surprise.isLoading) return <Loading />;
  if (!surprise.data) return <ErrorState error={surprise.error} />;
  const data = surprise.data;

  return (
    <Screen refreshing={surprise.isRefetching} onRefresh={() => void surprise.refetch()}>
      <Stack.Screen options={{ title: data.title }} />
      <Card>
        <Row gap={spacing.md}>
          <Avatar name={data.beneficiary.name} uri={data.beneficiary.avatarUrl} size={52} />
          <Row style={{ flex: 1 }} wrap>
            <T variant="heading">🎁 {data.title}</T>
            {data.revealedAt ? <Badge label="Revealed" tone="success" /> : <Badge label="🤫 Secret" tone="gold" />}
          </Row>
        </Row>
        <T color={colors.textMuted} style={{ marginTop: spacing.sm }}>
          {data.memberCount} planners{data.budgetMinor ? ` · budget ${money(data.budgetMinor, data.currency)}` : ''}
        </T>
        <Button icon="💬" title="Open planning chat" onPress={() => router.push(`/chat/${data.conversationId}`)} style={{ marginTop: spacing.md }} />
      </Card>

      <Section title="The gift">
        {gift.data ? (
          <Card onPress={() => router.push(`/group-gift/${gift.data!.id}`)}>
            <T variant="heading">{gift.data.title}</T>
            <T color={colors.textMuted} style={{ marginVertical: 4 }}>
              {money(gift.data.raisedMinor, gift.data.currency)} of {money(gift.data.targetMinor, gift.data.currency)}
            </T>
            <ProgressBar percent={gift.data.percentFunded} />
          </Card>
        ) : (
          <Card>
            <T color={colors.textMuted}>Choose a gift and collect contributions from the group.</T>
            <Row wrap style={{ marginTop: spacing.md }}>
              <Button small title="Start group gift" onPress={() => router.push({ pathname: '/group-gift/new', params: { surpriseId: data.id, beneficiaryUserId: data.beneficiary.id ?? '', name: data.beneficiary.name, target: data.budgetMinor ? String(data.budgetMinor) : '' } })} />
              <Button small variant="secondary" title="✨ Ideas" onPress={() => router.push({ pathname: '/gift-finder', params: { userId: data.beneficiary.id ?? '', name: data.beneficiary.name } })} />
              {data.beneficiary.id ? <Button small variant="secondary" title="Their wishlist" onPress={() => router.push(`/person/${data.beneficiary.id}`)} /> : null}
            </Row>
          </Card>
        )}
      </Section>

      <Section title="Add planners">
        <FriendPicker selected={adding} onChange={setAdding} excludeIds={data.beneficiary.id ? [data.beneficiary.id] : []} />
        {adding.length ? <Button small title={`Add ${adding.length}`} loading={addMembers.isPending} onPress={() => addMembers.mutate()} /> : null}
      </Section>

      <Row wrap style={{ marginTop: spacing.xl }}>
        {!data.revealedAt ? <Button small variant="secondary" title="Mark as revealed" onPress={() => markRevealed.mutate()} /> : null}
        <Button small variant="danger" title="Leave" onPress={() => Alert.alert('Leave this surprise?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Leave', style: 'destructive', onPress: () => leave.mutate() }])} />
      </Row>
    </Screen>
  );
}
