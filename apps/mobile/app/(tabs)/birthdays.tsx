import type { CalendarMonthResponse, FriendGroupDto, TrackedBirthdayDto, UpcomingBirthdaysResponse } from '@bday/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { MONTHS } from '../../src/components/DatePicker';
import { BirthdayCard } from '../../src/components/gifting';
import { Button, Card, Chip, EmptyState, ErrorState, Row, Screen, SkeletonCard, T } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { colors, radius, spacing } from '../../src/theme';

type View_ = 'upcoming' | 'month' | 'list';
type Filter = { relationship?: string; groupId?: string; favoritesOnly?: boolean };

/** Birthday calendar (spec §7): month, list and upcoming views with filters. */
export default function Birthdays() {
  const [view, setView] = useState<View_>('upcoming');
  const [filter, setFilter] = useState<Filter>({});
  const groups = useQuery({ queryKey: ['friend-groups'], queryFn: () => api.get<FriendGroupDto[]>('/friend-groups') });

  const filters = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.sm, paddingVertical: spacing.sm }}>
      <Chip label="All" selected={!filter.relationship && !filter.groupId && !filter.favoritesOnly} onPress={() => setFilter({})} />
      <Chip label="⭐ Favorites" selected={filter.favoritesOnly} onPress={() => setFilter({ favoritesOnly: true })} />
      <Chip label="Family" selected={filter.relationship === 'FAMILY'} onPress={() => setFilter({ relationship: 'FAMILY' })} />
      <Chip label="Friends" selected={filter.relationship === 'FRIEND'} onPress={() => setFilter({ relationship: 'FRIEND' })} />
      <Chip label="Work" selected={filter.relationship === 'COLLEAGUE'} onPress={() => setFilter({ relationship: 'COLLEAGUE' })} />
      {groups.data?.filter((group) => !group.isSystem).map((group) => (
        <Chip key={group.id} label={group.name} selected={filter.groupId === group.id} onPress={() => setFilter({ groupId: group.id })} />
      ))}
    </ScrollView>
  );

  return (
    <Screen edges={['top']}>
      <Row style={{ justifyContent: 'space-between' }}>
        <T variant="title">Birthdays</T>
        <Row>
          <Button small variant="secondary" icon="📇" title="Import" onPress={() => router.push('/contacts-import')} />
          <Button small icon="＋" title="Add" onPress={() => router.push('/birthday/new')} />
        </Row>
      </Row>
      <Row style={{ marginTop: spacing.md }}>
        <Chip label="Upcoming" selected={view === 'upcoming'} onPress={() => setView('upcoming')} />
        <Chip label="Month" selected={view === 'month'} onPress={() => setView('month')} />
        <Chip label="All" selected={view === 'list'} onPress={() => setView('list')} />
      </Row>
      {filters}
      {view === 'upcoming' ? <UpcomingView filter={filter} /> : view === 'month' ? <MonthView filter={filter} /> : <ListView filter={filter} />}
    </Screen>
  );
}

function UpcomingView({ filter }: { filter: Filter }) {
  const query = useQuery({
    queryKey: ['birthdays', 'upcoming', filter],
    queryFn: () => api.get<UpcomingBirthdaysResponse>('/birthdays/upcoming', { withinDays: 366, limit: 100, ...filter }),
  });
  if (query.isLoading) return <SkeletonCard height={120} />;
  if (query.error && !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  const all = [...(query.data?.today ?? []), ...(query.data?.upcoming ?? [])];
  return (
    <View>
      {query.data?.mine ? (
        <Card style={{ marginBottom: spacing.md, backgroundColor: colors.brandSoft, borderColor: colors.brandSoft }}>
          <T variant="label" color={colors.brandDark}>
            🎈 Your birthday: {query.data.mine.label}
          </T>
        </Card>
      ) : null}
      {all.length === 0 ? <EmptyState emoji="📅" title="No upcoming birthdays" message="Add people or import from your contacts." /> : null}
      {all.map((birthday) => (
        <BirthdayCard key={birthday.id} birthday={birthday} />
      ))}
    </View>
  );
}

function MonthView({ filter }: { filter: Filter }) {
  const now = new Date();
  const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() + 1 });
  const [selectedDay, setSelectedDay] = useState<number | null>(null);
  const query = useQuery({
    queryKey: ['birthdays', 'calendar', cursor, filter],
    queryFn: () => api.get<CalendarMonthResponse>('/birthdays/calendar', { ...cursor, relationship: filter.relationship, groupId: filter.groupId }),
  });

  const firstWeekday = new Date(cursor.year, cursor.month - 1, 1).getDay();
  const days = query.data?.days ?? [];
  const selected = days.find((day) => day.day === selectedDay);
  const shift = (delta: number) => {
    setSelectedDay(null);
    setCursor((current) => {
      const date = new Date(current.year, current.month - 1 + delta, 1);
      return { year: date.getFullYear(), month: date.getMonth() + 1 };
    });
  };

  return (
    <View>
      <Card>
        <Row style={{ justifyContent: 'space-between', marginBottom: spacing.md }}>
          <Pressable onPress={() => shift(-1)} accessibilityLabel="Previous month" style={{ padding: 8 }}>
            <T variant="heading">‹</T>
          </Pressable>
          <T variant="heading">
            {MONTHS[cursor.month - 1]} {cursor.year}
          </T>
          <Pressable onPress={() => shift(1)} accessibilityLabel="Next month" style={{ padding: 8 }}>
            <T variant="heading">›</T>
          </Pressable>
        </Row>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, index) => (
            <View key={index} style={{ width: `${100 / 7}%`, alignItems: 'center', paddingBottom: 6 }}>
              <T variant="caption" color={colors.textMuted}>
                {label}
              </T>
            </View>
          ))}
          {Array.from({ length: firstWeekday }, (_, index) => (
            <View key={`pad-${index}`} style={{ width: `${100 / 7}%`, height: 46 }} />
          ))}
          {days.map((day) => {
            const has = day.birthdays.length > 0 || day.events.length > 0;
            const isToday = cursor.year === now.getFullYear() && cursor.month === now.getMonth() + 1 && day.day === now.getDate();
            return (
              <Pressable key={day.day} onPress={() => setSelectedDay(day.day)} style={{ width: `${100 / 7}%`, height: 46, alignItems: 'center', justifyContent: 'center' }}>
                <View
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: radius.pill,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: selectedDay === day.day ? colors.brand : isToday ? colors.brandSoft : 'transparent',
                  }}
                >
                  <T variant="label" color={selectedDay === day.day ? colors.white : colors.text}>
                    {day.day}
                  </T>
                </View>
                {has ? <View style={{ width: 5, height: 5, borderRadius: 3, backgroundColor: day.birthdays.length ? colors.pink : colors.gold, marginTop: -4 }} /> : null}
              </Pressable>
            );
          })}
        </View>
      </Card>
      <View style={{ marginTop: spacing.lg }}>
        {selected ? (
          <>
            {selected.birthdays.length === 0 && selected.events.length === 0 ? <T color={colors.textMuted}>Nothing on this day.</T> : null}
            {selected.birthdays.map((birthday: TrackedBirthdayDto) => (
              <BirthdayCard key={birthday.id} birthday={birthday} />
            ))}
            {selected.events.map((event) => (
              <Card key={event.id} onPress={() => router.push(`/event/${event.id}`)} style={{ marginBottom: spacing.md }}>
                <T variant="heading">🎉 {event.name}</T>
                <T color={colors.textMuted}>
                  {new Date(event.startsAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} {event.venueName ? `· ${event.venueName}` : ''}
                </T>
              </Card>
            ))}
          </>
        ) : (
          <T color={colors.textMuted}>Tap a day to see who’s celebrating.</T>
        )}
      </View>
    </View>
  );
}

function ListView({ filter }: { filter: Filter }) {
  const query = useQuery({
    queryKey: ['birthdays', 'all', filter],
    queryFn: () => api.get<TrackedBirthdayDto[]>('/birthdays', { relationship: filter.relationship, groupId: filter.groupId }),
  });
  const grouped = useMemo(() => {
    const byMonth = new Map<number, TrackedBirthdayDto[]>();
    for (const birthday of query.data ?? []) {
      if (filter.favoritesOnly && !birthday.isFavorite) continue;
      const bucket = byMonth.get(birthday.birthday.month) ?? [];
      bucket.push(birthday);
      byMonth.set(birthday.birthday.month, bucket);
    }
    return [...byMonth.entries()].sort((a, b) => a[0] - b[0]);
  }, [query.data, filter.favoritesOnly]);

  if (query.isLoading) return <SkeletonCard />;
  if (query.error && !query.data) return <ErrorState error={query.error} onRetry={() => void query.refetch()} />;
  if (grouped.length === 0) return <EmptyState emoji="📅" title="Your calendar is empty" />;
  return (
    <View>
      {grouped.map(([month, birthdays]) => (
        <View key={month} style={{ marginBottom: spacing.md }}>
          <T variant="label" color={colors.textMuted} style={{ marginVertical: spacing.sm }}>
            {MONTHS[month - 1]?.toUpperCase()}
          </T>
          {birthdays.map((birthday) => (
            <BirthdayCard key={birthday.id} birthday={birthday} compact />
          ))}
        </View>
      ))}
    </View>
  );
}
