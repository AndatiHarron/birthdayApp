import type { GroupGiftDto, SurpriseDto } from '@bday/shared';
import { useQuery } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { money } from '../src/components/gifting';
import { Badge, Card, EmptyState, ErrorState, Loading, ProgressBar, Row, Screen, Section, T } from '../src/components/ui';
import { api } from '../src/lib/api';
import { colors, spacing } from '../src/theme';

export default function Surprises() {
  const surprises = useQuery({ queryKey: ['surprises'], queryFn: () => api.get<SurpriseDto[]>('/surprises') });
  const gifts = useQuery({ queryKey: ['group-gifts'], queryFn: () => api.get<GroupGiftDto[]>('/gifts/group') });

  return (
    <Screen refreshing={surprises.isRefetching} onRefresh={() => { void surprises.refetch(); void gifts.refetch(); }}>
      <Stack.Screen options={{ title: 'Surprises & group gifts' }} />
      <Section icon="secret" title="Surprises" style={{ marginTop: 0 }}>
        {surprises.isLoading ? <Loading /> : null}
        {surprises.error ? <ErrorState error={surprises.error} /> : null}
        {surprises.data?.length === 0 ? <EmptyState icon="secret" title="No surprises yet" message="Open a friend’s birthday and tap “Plan a surprise”." /> : null}
        {surprises.data?.map((surprise) => (
          <Card key={surprise.id} onPress={() => router.push(`/surprise/${surprise.id}`)} style={{ marginBottom: spacing.md }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T variant="heading">{surprise.title}</T>
              {surprise.revealedAt ? <Badge label="Revealed" tone="success" /> : <Badge label="Planning" tone="gold" />}
            </Row>
            <T color={colors.textMuted}>For {surprise.beneficiary.name} · {surprise.memberCount} planners</T>
          </Card>
        ))}
      </Section>
      <Section icon="users" title="Group gifts">
        {gifts.data?.length === 0 ? <T color={colors.textMuted}>No group gifts yet.</T> : null}
        {gifts.data?.map((gift) => (
          <Card key={gift.id} onPress={() => router.push(`/group-gift/${gift.id}`)} style={{ marginBottom: spacing.md }}>
            <Row style={{ justifyContent: 'space-between' }}>
              <T variant="heading">{gift.title}</T>
              <Badge label={gift.status.toLowerCase()} />
            </Row>
            <T color={colors.textMuted} style={{ marginBottom: spacing.sm }}>
              For {gift.beneficiary.name} · {money(gift.raisedMinor, gift.currency)} / {money(gift.targetMinor, gift.currency)}
            </T>
            <ProgressBar percent={gift.percentFunded} />
          </Card>
        ))}
      </Section>
    </Screen>
  );
}
