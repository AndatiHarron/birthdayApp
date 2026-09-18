import type { GiftHistoryEntryDto, ThankYouDto } from '@bday/shared';
import { useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, router } from 'expo-router';
import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { VoicePlayer } from '../src/components/VoiceRecorder';
import { money } from '../src/components/gifting';
import { Avatar, Button, Card, Chip, EmptyState, ErrorState, Loading, Row, Screen, Section, T } from '../src/components/ui';
import { api } from '../src/lib/api';
import { colors, radius, spacing } from '../src/theme';

/** Private gift history (spec §26) and thank-yous (spec §27). */
export default function GiftHistory() {
  const [direction, setDirection] = useState<'RECEIVED' | 'SENT'>('RECEIVED');
  const history = useQuery({ queryKey: ['gift-history', direction], queryFn: () => api.get<GiftHistoryEntryDto[]>('/gift-history', { direction }) });
  const thanks = useQuery({ queryKey: ['thank-yous'], queryFn: () => api.get<ThankYouDto[]>('/thank-yous', { direction: 'RECEIVED' }) });

  const byYear = useMemo(() => {
    const groups = new Map<number, GiftHistoryEntryDto[]>();
    for (const entry of history.data ?? []) {
      const year = entry.celebrationYear ?? new Date(entry.occurredAt).getFullYear();
      groups.set(year, [...(groups.get(year) ?? []), entry]);
    }
    return [...groups.entries()].sort((a, b) => b[0] - a[0]);
  }, [history.data]);

  return (
    <Screen refreshing={history.isRefetching} onRefresh={() => void history.refetch()}>
      <Stack.Screen options={{ title: 'Gift history' }} />
      <Row style={{ marginBottom: spacing.lg }}>
        <Chip label="🎁 Received" selected={direction === 'RECEIVED'} onPress={() => setDirection('RECEIVED')} />
        <Chip label="💝 Given" selected={direction === 'SENT'} onPress={() => setDirection('SENT')} />
      </Row>
      <T variant="caption" color={colors.textMuted} style={{ marginBottom: spacing.md }}>
        🔒 Only you can see this, unless you share it in privacy settings. It helps you avoid giving the same thing twice.
      </T>
      {history.isLoading ? <Loading /> : null}
      {history.error ? <ErrorState error={history.error} /> : null}
      {history.data?.length === 0 ? <EmptyState emoji="📜" title="No gifts recorded yet" message="Completed gifts are added automatically." /> : null}
      {byYear.map(([year, entries]) => (
        <View key={year} style={{ marginBottom: spacing.lg }}>
          <T variant="heading" style={{ marginBottom: spacing.sm }}>{year}</T>
          {entries.map((entry) => (
            <Card key={entry.id} style={{ marginBottom: spacing.sm }}>
              <Row gap={spacing.md}>
                {entry.imageUrl ? <Image source={{ uri: entry.imageUrl }} style={{ width: 52, height: 52, borderRadius: radius.md }} /> : <Avatar name={entry.counterparty?.displayName ?? '🎁'} uri={entry.counterparty?.avatarUrl} size={52} />}
                <View style={{ flex: 1 }}>
                  <T variant="label">{entry.title}</T>
                  <T variant="caption" color={colors.textMuted}>
                    {direction === 'RECEIVED' ? 'From' : 'To'} {entry.counterparty?.displayName ?? 'someone'} · {entry.occasion}
                    {!entry.priceHidden && entry.priceMinor ? ` · ${money(entry.priceMinor, entry.currency ?? 'KES')}` : ''}
                  </T>
                  {entry.message ? <T variant="caption">“{entry.message}”</T> : null}
                </View>
                {direction === 'RECEIVED' && !entry.thankedAt && entry.source !== 'MANUAL' ? <T variant="caption" color={colors.pink}>Say thanks</T> : null}
              </Row>
            </Card>
          ))}
        </View>
      ))}

      <Section title="❤️ Thank-yous you received">
        {thanks.data?.length === 0 ? <T color={colors.textMuted}>None yet.</T> : null}
        {thanks.data?.map((thank) => (
          <Card key={thank.id} style={{ marginBottom: spacing.sm }}>
            <Row gap={spacing.md}>
              <Avatar name={thank.sender.displayName} uri={thank.sender.avatarUrl} size={36} />
              <T variant="label" style={{ flex: 1 }}>{thank.sender.displayName}</T>
            </Row>
            {thank.body ? <T style={{ marginTop: spacing.sm }}>{thank.body}</T> : null}
            {thank.kind === 'VOICE' && thank.mediaUrl ? <VoicePlayer url={thank.mediaUrl} /> : null}
            {thank.kind === 'IMAGE' && thank.mediaUrl ? <Image source={{ uri: thank.mediaUrl }} style={{ height: 200, borderRadius: radius.md, marginTop: spacing.sm }} contentFit="cover" /> : null}
          </Card>
        ))}
      </Section>
      <Button variant="ghost" title="📸 Birthday memories" onPress={() => router.push('/memories')} style={{ marginTop: spacing.lg }} />
    </Screen>
  );
}
