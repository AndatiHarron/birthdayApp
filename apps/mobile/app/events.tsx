import type { EventSummaryDto } from '@bday/shared';
import { useQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Badge, Button, Card, Chip, EmptyState, ErrorState, Loading, Row, Screen, T } from '../src/components/ui';
import { api } from '../src/lib/api';
import { colors, spacing } from '../src/theme';

export default function Events() {
  const [scope, setScope] = useState<'UPCOMING' | 'HOSTING' | 'PAST'>('UPCOMING');
  const events = useQuery({ queryKey: ['events', scope], queryFn: () => api.get<EventSummaryDto[]>('/events', { scope }) });

  return (
    <Screen refreshing={events.isRefetching} onRefresh={() => void events.refetch()}>
      <Stack.Screen options={{ title: 'Events', headerRight: () => <Button small title="＋ New" onPress={() => router.push('/event/new')} /> }} />
      <Row style={{ marginBottom: spacing.lg }}>
        <Chip label="Upcoming" selected={scope === 'UPCOMING'} onPress={() => setScope('UPCOMING')} />
        <Chip label="Hosting" selected={scope === 'HOSTING'} onPress={() => setScope('HOSTING')} />
        <Chip label="Past" selected={scope === 'PAST'} onPress={() => setScope('PAST')} />
      </Row>
      {events.isLoading ? <Loading /> : null}
      {events.error ? <ErrorState error={events.error} /> : null}
      {events.data?.length === 0 ? <EmptyState emoji="🎉" title="No events" message="Throw a birthday party and invite friends." action={<Button title="Create event" onPress={() => router.push('/event/new')} />} /> : null}
      {events.data?.map((event) => (
        <Card key={event.id} onPress={() => router.push(`/event/${event.id}`)} style={{ marginBottom: spacing.md }}>
          <Row style={{ justifyContent: 'space-between' }}>
            <T variant="heading" style={{ flex: 1 }}>🎉 {event.name}</T>
            {event.myRsvp ? <Badge label={event.myRsvp.toLowerCase()} tone={event.myRsvp === 'GOING' ? 'success' : 'muted'} /> : <Badge label="Host" />}
          </Row>
          <T color={colors.textMuted}>
            {new Date(event.startsAt).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
            {event.venueName ? ` · ${event.venueName}` : ''} · {event.guestCount} invited
          </T>
        </Card>
      ))}
    </Screen>
  );
}
