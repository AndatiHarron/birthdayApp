import {
  GLOBAL_BIRTHDAYS,
  formatBirthday,
  type BirthdayTwinsDto,
  type CheerResultDto,
  type GlobalCelebrantDto,
  type GlobalStatusDto,
  type GlobalTodayDto,
} from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, View } from 'react-native';
import { Confetti } from '../src/components/Confetti';
import { Avatar, Badge, Button, Card, Chip, EmptyState, ErrorState, Field, IconTile, InlineError, Row, Screen, Section, SkeletonCard, T, Toggle } from '../src/components/ui';
import { api } from '../src/lib/api';
import { colors, gradients, radius, spacing } from '../src/theme';

/** 🇰🇪 from "KE". */
function flag(countryCode: string): string {
  return /^[A-Z]{2}$/.test(countryCode) ? String.fromCodePoint(...countryCode.split('').map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : '';
}

const INELIGIBLE_COPY: Record<string, string> = {
  NO_BIRTH_YEAR: 'Add your full date of birth (including the year) in your profile to join. Global birthdays are for adults only.',
  UNDER_AGE: 'Global birthdays are for adults (18+). Celebrate with your friends and family for now!',
  NOT_VERIFIED: 'Verify your account to celebrate people around the world.',
};

/**
 * Global birthdays: everyone who opted in and is celebrating today, anywhere.
 * The least-celebrated come first — the point is that nobody's birthday goes
 * unnoticed. Strangers can cheer, wish and send digital gifts; never physical.
 */
export default function GlobalBirthdays() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'today' | 'twins'>('today');
  const [burst, setBurst] = useState(0);
  const status = useQuery({ queryKey: ['global', 'me'], queryFn: () => api.get<GlobalStatusDto>('/global/me') });
  const eligible = status.data?.eligible ?? false;
  const today = useQuery({
    queryKey: ['global', 'today'],
    queryFn: () => api.get<GlobalTodayDto>('/global/today', { limit: 50 }),
    enabled: eligible,
  });
  const twins = useQuery({ queryKey: ['global', 'twins'], queryFn: () => api.get<BirthdayTwinsDto>('/global/twins'), enabled: eligible && tab === 'twins' });

  const cheer = useMutation({
    mutationFn: (userId: string) => api.post<CheerResultDto>(`/global/${userId}/cheer`, { emoji: '🎉' }),
    onSuccess: (result, userId) => {
      const patch = (list: GlobalCelebrantDto[] | undefined) =>
        list?.map((item) => (item.userId === userId ? { ...item, cheerCount: result.cheerCount, cheeredByMe: true } : item));
      queryClient.setQueryData<GlobalTodayDto>(['global', 'today'], (data) => (data ? { ...data, items: patch(data.items)! } : data));
      queryClient.setQueryData<BirthdayTwinsDto>(['global', 'twins'], (data) => (data ? { ...data, items: patch(data.items)! } : data));
      void queryClient.invalidateQueries({ queryKey: ['global', 'me'] });
      setBurst((value) => value + 1);
      if (Platform.OS !== 'web') void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    },
  });

  const refresh = () => void Promise.all([status.refetch(), today.refetch(), tab === 'twins' ? twins.refetch() : null]);

  return (
    <View style={{ flex: 1 }}>
      <Screen refreshing={today.isRefetching} onRefresh={refresh}>
        <Stack.Screen options={{ title: 'Global birthdays' }} />

        <LinearGradient colors={gradients.celebration} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ borderRadius: radius.xl, padding: spacing.xl }}>
          <IconTile name="globe" size={52} tone="onDark" />
          <T variant="title" color={colors.white} style={{ marginTop: spacing.sm }}>
            {today.data ? `${today.data.totalCelebrating} ${today.data.totalCelebrating === 1 ? 'person is' : 'people are'} celebrating today` : 'Celebrate someone today'}
          </T>
          <T color={colors.white} style={{ marginTop: 4, opacity: 0.95 }}>
            {today.data && today.data.countries > 1 ? `Across ${today.data.countries} countries. ` : ''}
            Some have never had a birthday celebrated. A cheer, a wish or a small gift can make someone feel noticed.
          </T>
          {status.data && status.data.peopleCelebratedToday > 0 ? (
            <View style={{ marginTop: spacing.md, alignSelf: 'flex-start', backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: radius.pill, paddingHorizontal: spacing.md, paddingVertical: 6 }}>
              <T variant="label" color={colors.white}>
                You made {status.data.peopleCelebratedToday} {status.data.peopleCelebratedToday === 1 ? 'person' : 'people'} smile today
              </T>
            </View>
          ) : null}
        </LinearGradient>

        {status.error ? <ErrorState error={status.error} onRetry={() => void status.refetch()} /> : null}
        {status.data?.isMyBirthdayToday && status.data.celebrateGlobally ? <MyGlobalBirthday status={status.data} /> : null}
        {status.data ? <JoinCard status={status.data} /> : null}

        {status.data && !eligible ? (
          <Card style={{ marginTop: spacing.lg }}>
            <EmptyState icon="lock" title="Not available yet" message={INELIGIBLE_COPY[status.data.ineligibleReason ?? 'NOT_VERIFIED']} />
          </Card>
        ) : null}

        {eligible ? (
          <>
            <Row style={{ marginTop: spacing.xl }}>
              <Chip icon="cake" label="Celebrating today" selected={tab === 'today'} onPress={() => setTab('today')} />
              <Chip icon="users" label="Birthday twins" selected={tab === 'twins'} onPress={() => setTab('twins')} />
            </Row>
            <InlineError error={cheer.error} />

            {tab === 'today' ? (
              <Section title="Least celebrated first">
                {today.isLoading ? [0, 1, 2].map((key) => <SkeletonCard key={key} height={150} />) : null}
                {today.error ? <ErrorState error={today.error} onRetry={() => void today.refetch()} /> : null}
                {today.data?.items.length === 0 ? (
                  <Card>
                    <EmptyState icon="sun" title="No one yet today" message="As the day begins around the world, people celebrating will appear here. Check back soon!" />
                  </Card>
                ) : null}
                {today.data?.items.map((person) => (
                  <CelebrantCard key={person.userId} person={person} onCheer={() => cheer.mutate(person.userId)} cheering={cheer.isPending && cheer.variables === person.userId} />
                ))}
              </Section>
            ) : (
              <Section title={twins.data?.month ? `Born on ${formatBirthday({ month: twins.data.month, day: twins.data.day! })}` : 'Your birthday twins'}>
                {twins.isLoading ? [0, 1].map((key) => <SkeletonCard key={key} height={150} />) : null}
                {twins.error ? <ErrorState error={twins.error} onRetry={() => void twins.refetch()} /> : null}
                {twins.data && twins.data.month == null ? (
                  <Card>
                    <EmptyState icon="calendar" title="Add your birthday" message="Set your birthday in your profile to meet people who share it." />
                  </Card>
                ) : null}
                {twins.data?.month != null && twins.data.items.length === 0 ? (
                  <Card>
                    <EmptyState icon="users" title="No twins yet" message="Nobody who shares your birthday has joined global birthdays yet. Invite friends to the app!" />
                  </Card>
                ) : null}
                {twins.data && twins.data.total > 0 ? (
                  <T color={colors.textMuted} style={{ marginBottom: spacing.sm }}>
                    {twins.data.total} {twins.data.total === 1 ? 'person shares' : 'people share'} your birthday. On your big day, celebrate each other!
                  </T>
                ) : null}
                {twins.data?.items.map((person) => (
                  <CelebrantCard key={person.userId} person={person} twin onCheer={() => cheer.mutate(person.userId)} cheering={cheer.isPending && cheer.variables === person.userId} />
                ))}
              </Section>
            )}

            <T variant="caption" color={colors.textFaint} center style={{ marginTop: spacing.xl }}>
              Only adults who chose to join appear here. Physical gifts are only possible between people who are connected. Something wrong? Open a profile to report or block.
            </T>
          </>
        ) : null}
      </Screen>
      {burst > 0 ? <CheerBurst key={burst} /> : null}
    </View>
  );
}

/** A few seconds of confetti after each cheer. */
function CheerBurst() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 3500);
    return () => clearTimeout(timer);
  }, []);
  return visible ? <Confetti count={40} loop={false} /> : null;
}

function CelebrantCard({ person, onCheer, cheering, twin }: { person: GlobalCelebrantDto; onCheer: () => void; cheering: boolean; twin?: boolean }) {
  const recipient = { userId: person.userId, name: person.displayName };
  const place = [person.city, flag(person.countryCode)].filter(Boolean).join(' ');
  const celebrated = person.cheerCount + person.wishCount;

  return (
    <Card style={{ marginBottom: spacing.md }}>
      <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
        <Avatar name={person.displayName} uri={person.avatarUrl} size={56} />
        <View style={{ flex: 1 }}>
          <T variant="heading">{person.displayName}</T>
          <T variant="caption" color={colors.textMuted}>
            {place}
            {person.turningAge ? ` · turning ${person.turningAge}` : ''}
          </T>
          <Row wrap style={{ marginTop: 6 }}>
            {person.firstCelebration ? <Badge tone="accent" icon="sparkles" label="First celebration" /> : null}
            {person.isToday ? <Badge icon="cake" label="Today" /> : null}
            {person.isToday && celebrated === 0 ? <Badge tone="info" icon="star" label="Be the first to celebrate" /> : null}
          </Row>
        </View>
      </Row>

      {person.note ? (
        <T style={{ marginTop: spacing.md, fontStyle: 'italic' }} color={colors.text}>
          “{person.note}”
        </T>
      ) : null}

      {person.isToday && celebrated > 0 ? (
        <T variant="caption" color={colors.textMuted} style={{ marginTop: spacing.sm }}>
          {person.cheerCount} {person.cheerCount === 1 ? 'cheer' : 'cheers'} · {person.wishCount} {person.wishCount === 1 ? 'wish' : 'wishes'}
        </T>
      ) : null}

      <Row gap={spacing.sm} style={{ marginTop: spacing.md }}>
        <Button
          small
          icon={person.cheeredByMe ? 'heart' : 'party'}
          title={person.cheeredByMe ? 'Cheered' : person.isToday ? 'Cheer' : twin ? 'On the day' : 'Cheer'}
          disabled={person.cheeredByMe || !person.isToday}
          loading={cheering}
          onPress={onCheer}
          style={{ flex: 1 }}
        />
        <Button small variant="secondary" icon="mail" title="Wish" onPress={() => router.push({ pathname: '/wish/send', params: recipient })} style={{ flex: 1 }} />
        <Button small variant="secondary" icon="gift" title="Gift" onPress={() => router.push({ pathname: '/digital-gift/send', params: recipient })} style={{ flex: 1 }} />
      </Row>
    </Card>
  );
}

/** On my own birthday: how the world celebrated me. */
function MyGlobalBirthday({ status }: { status: GlobalStatusDto }) {
  const total = status.cheersReceived + status.strangerWishesReceived + status.strangerGiftsReceived;
  return (
    <Card style={{ marginTop: spacing.lg, backgroundColor: colors.goldSoft }}>
      <T variant="heading">Happy birthday! The world sees you.</T>
      <T style={{ marginTop: 4 }}>
        {total === 0
          ? 'Your card is live in the global feed. People around the world can celebrate you today.'
          : `${status.cheersReceived} ${status.cheersReceived === 1 ? 'person' : 'people'} cheered you, ${status.strangerWishesReceived} sent wishes and ${status.strangerGiftsReceived} sent gifts from around the world.`}
      </T>
      <Button small title="See my wishes" onPress={() => router.push('/celebration')} style={{ marginTop: spacing.md, alignSelf: 'flex-start' }} />
    </Card>
  );
}

/** Opt in or out, and choose what strangers see. */
function JoinCard({ status }: { status: GlobalStatusDto }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [joined, setJoined] = useState(status.celebrateGlobally);
  const [note, setNote] = useState(status.celebrationNote ?? '');
  const [first, setFirst] = useState(status.firstCelebration);
  const initial = useRef(status);

  useEffect(() => {
    if (initial.current !== status && !editing) {
      initial.current = status;
      setJoined(status.celebrateGlobally);
      setNote(status.celebrationNote ?? '');
      setFirst(status.firstCelebration);
    }
  }, [status, editing]);

  const save = useMutation({
    mutationFn: () => api.put<GlobalStatusDto>('/global/me', { celebrateGlobally: joined, celebrationNote: note.trim() || null, firstCelebration: first }),
    onSuccess: (updated) => {
      queryClient.setQueryData(['global', 'me'], updated);
      void queryClient.invalidateQueries({ queryKey: ['global', 'today'] });
      setEditing(false);
    },
  });

  if (!status.eligible) return null;

  if (status.celebrateGlobally && !editing) {
    return (
      <Card style={{ marginTop: spacing.lg }}>
        <Row style={{ justifyContent: 'space-between' }}>
          <View style={{ flex: 1 }}>
            <T variant="heading">You’re part of global birthdays</T>
            <T variant="caption" color={colors.textMuted}>On your birthday, people around the world can cheer, wish and send you digital gifts.</T>
          </View>
          <Button small variant="ghost" title="Edit" onPress={() => setEditing(true)} />
        </Row>
      </Card>
    );
  }

  const tooLong = note.length > GLOBAL_BIRTHDAYS.maxNoteLength;
  return (
    <Card style={{ marginTop: spacing.lg, borderWidth: 2, borderColor: colors.brandSoft }}>
      <T variant="heading">Let the world celebrate you</T>
      <T color={colors.textMuted} style={{ marginTop: 4, marginBottom: spacing.sm }}>
        On your birthday, you’ll appear here for people everywhere. They can cheer, send wishes and digital gifts (like airtime or wallet credit). Nobody sees your birth year, contacts or address, and only people you’re connected with can send physical gifts.
      </T>
      <Toggle label="Celebrate me globally" value={joined} onChange={setJoined} />
      {joined ? (
        <>
          <Field
            label="A line for people who don’t know you (optional)"
            placeholder="Turning 30 in Kisumu! I love football and music"
            value={note}
            onChangeText={setNote}
            maxLength={GLOBAL_BIRTHDAYS.maxNoteLength + 20}
            error={tooLong ? `Keep it under ${GLOBAL_BIRTHDAYS.maxNoteLength} characters` : undefined}
            hint={`${note.length}/${GLOBAL_BIRTHDAYS.maxNoteLength}`}
          />
          <Toggle
            label="I’ve rarely or never celebrated my birthday"
            description="We’ll gently show you first, so more people celebrate you. Only share this if you’re comfortable."
            value={first}
            onChange={setFirst}
          />
        </>
      ) : null}
      <InlineError error={save.error} />
      <Row gap={spacing.sm} style={{ marginTop: spacing.sm }}>
        <Button title={joined ? 'Save' : status.celebrateGlobally ? 'Leave global birthdays' : 'Save'} loading={save.isPending} disabled={tooLong} onPress={() => save.mutate()} style={{ flex: 1 }} />
        {editing ? <Button variant="secondary" title="Cancel" onPress={() => setEditing(false)} /> : null}
      </Row>
    </Card>
  );
}
