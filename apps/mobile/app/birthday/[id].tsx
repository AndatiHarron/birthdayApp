import { formatPreciseCountdown, getBirthdayCountdown, type TrackedBirthdayDto } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Alert, View } from 'react-native';
import { Avatar, Badge, Button, Card, ErrorState, InfoRow, Loading, Row, Screen, Section, T } from '../../src/components/ui';
import { api, errorMessage } from '../../src/lib/api';
import { colors, gradients, radius, spacing } from '../../src/theme';
import { interestIcon } from '../../src/lib/icons';

/** One birthday with precise countdown (spec §48) and every way to celebrate. */
export default function BirthdayDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const birthday = useQuery({ queryKey: ['birthdays', 'detail', id], queryFn: () => api.get<TrackedBirthdayDto>(`/birthdays/${id}`) });

  const favorite = useMutation({
    mutationFn: (isFavorite: boolean) => api.patch(`/birthdays/${id}`, { isFavorite }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['birthdays'] }),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/birthdays/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['birthdays'] });
      router.back();
    },
    onError: (error) => Alert.alert('Could not remove', errorMessage(error)),
  });

  if (birthday.isLoading) return <Loading />;
  if (!birthday.data) return <ErrorState error={birthday.error} onRetry={() => void birthday.refetch()} />;
  const data = birthday.data;
  const precise = formatPreciseCountdown(getBirthdayCountdown({ month: data.birthday.month, day: data.birthday.day, year: data.birthday.year }));

  return (
    <Screen>
      <Stack.Screen options={{ title: data.name }} />
      <LinearGradient colors={data.countdown.isToday ? gradients.celebration : gradients.brand} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius.xl, padding: spacing.xl, alignItems: 'center' }}>
        <Avatar name={data.name} uri={data.avatarUrl} size={88} />
        <T variant="title" color={colors.white} style={{ marginTop: spacing.md }}>
          {data.name}’s Birthday
        </T>
        <T variant="display" color={colors.white} style={{ marginTop: spacing.sm }}>
          {precise}
        </T>
        <T color="rgba(255,255,255,0.9)">
          {data.birthday.label}
          {data.countdown.turningAge ? ` · turning ${data.countdown.turningAge}` : ''}
        </T>
      </LinearGradient>

      <Row wrap style={{ marginTop: spacing.lg }}>
        {data.relationship ? <Badge label={data.relationship.replace('_', ' ').toLowerCase()} /> : null}
        {data.groups.map((group) => (
          <Badge key={group.id} label={group.name} tone="muted" />
        ))}
        {data.interests.map((interest) => (
          <Badge key={interest.slug} icon={interestIcon(interest.slug)} label={interest.label} tone="info" />
        ))}
      </Row>

      <Section title="Celebrate">
        <View style={{ gap: spacing.sm }}>
          {data.linkedUser ? <Button icon="gift" title={data.hasWishlist ? `See wishlist (${data.wishlistItemCount})` : 'View profile'} onPress={() => router.push(`/person/${data.linkedUser!.id}`)} /> : null}
          <Button variant="secondary" icon="mail" title="Send a birthday wish" onPress={() => router.push({ pathname: '/wish/send', params: { birthdayId: data.id } })} />
          <Button variant="secondary" icon="bag" title="Send a gift" onPress={() => router.push({ pathname: '/send-gift', params: { birthdayId: data.id } })} />
          <Button variant="secondary" icon="sparkles" title="Get gift ideas" onPress={() => router.push({ pathname: '/gift-finder', params: { birthdayId: data.id } })} />
          <Button variant="secondary" icon="secret" title="Plan a surprise" onPress={() => router.push({ pathname: '/surprise/new', params: { birthdayId: data.id } })} />
          {!data.linkedUser ? <Button variant="ghost" icon="send" title={`Invite ${data.name.split(' ')[0]} to the app`} onPress={() => router.push({ pathname: '/invite', params: { birthdayId: data.id } })} /> : null}
        </View>
      </Section>

      <Section title="Details">
        <Card>
          {data.phone ? <InfoRow icon="smartphone">{data.phone}</InfoRow> : null}
          {data.email ? <InfoRow icon="mail">{data.email}</InfoRow> : null}
          <InfoRow icon="bell" color={colors.textMuted}>
            Reminders: {data.reminderOffsetsDays?.length ? data.reminderOffsetsDays.map((days) => (days === 0 ? 'on the day' : `${days}d`)).join(', ') : 'your default schedule'}
          </InfoRow>
          {data.notes ? <InfoRow icon="edit">{data.notes}</InfoRow> : null}
        </Card>
        <Row style={{ marginTop: spacing.md }} wrap>
          <Button small variant="secondary" icon="star" title="Favorite" onPress={() => favorite.mutate(!data.isFavorite)} />
          <Button small variant="secondary" title="Edit" onPress={() => router.push({ pathname: '/birthday/new', params: { id: data.id } })} />
          <Button small variant="danger" title="Remove" onPress={() => Alert.alert(`Remove ${data.name}?`, 'They will be removed from your calendar and reminders.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => remove.mutate() }])} />
        </Row>
      </Section>
    </Screen>
  );
}
