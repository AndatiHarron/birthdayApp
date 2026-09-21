import { RealtimeEvent, type EventDto, type RsvpStatus } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Calendar from 'expo-calendar';
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Alert, Linking, Platform, Share, View } from 'react-native';
import { Avatar, Badge, Button, Card, Chip, ErrorState, InfoRow, Loading, Row, Screen, Section, T } from '../../src/components/ui';
import { api, errorMessage } from '../../src/lib/api';
import { WEB_URL } from '../../src/lib/config';
import { useRealtimeRoom } from '../../src/lib/realtime';
import { colors, radius, spacing } from '../../src/theme';

/** Event detail, RSVP and host view (spec §30, §31). */
export default function EventDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const event = useQuery({ queryKey: ['event', id], queryFn: () => api.get<EventDto>(`/events/${id}`) });
  useRealtimeRoom('event', id, { [RealtimeEvent.EVENT_RSVP_UPDATED]: () => void queryClient.invalidateQueries({ queryKey: ['event', id] }) });

  const rsvp = useMutation({
    mutationFn: (status: RsvpStatus) => api.post<EventDto>(`/events/${id}/rsvp`, { status }),
    onSuccess: (data) => queryClient.setQueryData(['event', id], data),
    onError: (error) => Alert.alert('Couldn’t RSVP', errorMessage(error)),
  });
  const cancel = useMutation({ mutationFn: () => api.delete(`/events/${id}`), onSuccess: () => router.back(), onError: (error) => Alert.alert('Error', errorMessage(error)) });
  const shareLinks = useMutation({
    mutationFn: () => api.get<Array<{ guestId: string; name: string; token: string }>>(`/events/${id}/invite-links`),
    onSuccess: (links) => {
      const text = links.map((link) => `${link.name}: ${WEB_URL}/rsvp/${link.token}`).join('\n');
      void Share.share({ message: `RSVP links for ${event.data?.name}:\n${text}` });
    },
  });

  async function addToCalendar() {
    const data = event.data;
    if (!data) return;
    if (Platform.OS === 'web') return;
    const permission = await Calendar.requestCalendarPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Calendar access needed');
      return;
    }
    const calendar = await Calendar.getDefaultCalendarAsync().catch(async () => (await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT)).find((entry) => entry.allowsModifications));
    if (!calendar) {
      Alert.alert('No writable calendar found');
      return;
    }
    await Calendar.createEventAsync(calendar.id, {
      title: data.name,
      startDate: new Date(data.startsAt),
      endDate: data.endsAt ? new Date(data.endsAt) : new Date(new Date(data.startsAt).getTime() + 3 * 3_600_000),
      location: [data.venueName, data.venueAddress].filter(Boolean).join(', '),
      notes: data.description ?? undefined,
    });
    Alert.alert('Added to your calendar');
  }

  if (event.isLoading) return <Loading />;
  if (!event.data) return <ErrorState error={event.error} />;
  const data = event.data;

  return (
    <Screen refreshing={event.isRefetching} onRefresh={() => void event.refetch()}>
      <Stack.Screen options={{ title: data.name }} />
      {data.coverImageUrl ? <Image source={{ uri: data.coverImageUrl }} style={{ height: 180, borderRadius: radius.lg, marginBottom: spacing.lg }} contentFit="cover" /> : null}
      <T variant="title">{data.name}</T>
      <Row style={{ marginVertical: spacing.sm }} gap={spacing.sm}>
        <Avatar name={data.host.displayName} uri={data.host.avatarUrl} size={28} />
        <T color={colors.textMuted}>Hosted by {data.isHost ? 'you' : data.host.displayName}</T>
      </Row>
      <Card>
        <InfoRow icon="calendar">{new Date(data.startsAt).toLocaleString(undefined, { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}</InfoRow>
        {data.venueName || data.venueAddress ? (
          <T style={{ marginTop: 4 }} color={colors.brand} onPress={() => void Linking.openURL(`https://maps.google.com/?q=${encodeURIComponent([data.venueName, data.venueAddress].filter(Boolean).join(', '))}`)}>
            {[data.venueName, data.venueAddress].filter(Boolean).join(', ')}
          </T>
        ) : null}
        {data.description ? <T style={{ marginTop: spacing.sm }}>{data.description}</T> : null}
        <Row wrap style={{ marginTop: spacing.md }}>
          <Button small variant="secondary" icon="calendar" title="Add to calendar" onPress={() => void addToCalendar()} />
          {data.conversationId ? <Button small variant="secondary" icon="chat" title="Event chat" onPress={() => router.push(`/chat/${data.conversationId}`)} /> : null}
          {data.wishlistId ? <Button small variant="secondary" icon="gift" title="Gift registry" onPress={() => router.push(`/person/${data.hostId}`)} /> : null}
        </Row>
      </Card>

      {!data.isHost ? (
        <Section title="Are you going?">
          <Row wrap>
            {(['GOING', 'MAYBE', 'DECLINED'] as const).map((status) => (
              <Chip key={status} icon={({ GOING: 'checkCircle', MAYBE: 'help', DECLINED: 'close' } as const)[status]} label={{ GOING: 'Going', MAYBE: 'Maybe', DECLINED: 'Can’t attend' }[status]} selected={data.myRsvp === status} onPress={() => rsvp.mutate(status)} />
            ))}
          </Row>
        </Section>
      ) : null}

      <Section title="Guests">
        <Row wrap style={{ marginBottom: spacing.md }}>
          <Badge label={`${data.counts.invited} invited`} tone="muted" />
          <Badge label={`${data.counts.going} going`} tone="success" />
          <Badge label={`${data.counts.maybe} maybe`} tone="gold" />
          {data.isHost ? <Badge label={`${data.counts.declined} declined`} tone="danger" /> : null}
          {data.isHost ? <Badge label={`${data.counts.pending} no reply`} tone="muted" /> : null}
        </Row>
        {data.guests.map((guest) => (
          <Row key={guest.id} gap={spacing.md} style={{ paddingVertical: 6 }}>
            <Avatar name={guest.name} uri={guest.user?.avatarUrl} size={36} />
            <T style={{ flex: 1 }}>
              {guest.name}
              {guest.plusOnes ? ` +${guest.plusOnes}` : ''}
            </T>
            <Badge label={guest.rsvp.toLowerCase()} tone={guest.rsvp === 'GOING' ? 'success' : guest.rsvp === 'DECLINED' ? 'danger' : 'muted'} />
          </Row>
        ))}
      </Section>

      {data.isHost ? (
        <Section title="Host tools">
          <View style={{ gap: spacing.sm }}>
            <Button variant="secondary" icon="link" title="Share RSVP links" loading={shareLinks.isPending} onPress={() => shareLinks.mutate()} />
            <Button variant="danger" title="Cancel event" onPress={() => Alert.alert('Cancel this event?', 'Guests will be notified.', [{ text: 'Keep', style: 'cancel' }, { text: 'Cancel event', style: 'destructive', onPress: () => cancel.mutate() }])} />
          </View>
        </Section>
      ) : null}
    </Screen>
  );
}
