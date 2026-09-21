import { toMinor, type SurpriseDto } from '@bday/shared';
import { useMutation } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FriendPicker } from '../../src/components/FriendPicker';
import { Avatar, Button, Card, EmptyState, Field, InlineError, Loading, Row, Screen, Section, T } from '../../src/components/ui';
import { api, fieldError } from '../../src/lib/api';
import { useRecipient } from '../../src/lib/recipient';
import { colors, spacing } from '../../src/theme';

/** Create Birthday Surprise (spec §14, §49). The birthday person never sees it. */
export default function NewSurprise() {
  const params = useLocalSearchParams<{ userId?: string; birthdayId?: string; name?: string }>();
  const { recipient, isLoading } = useRecipient(params);
  const [title, setTitle] = useState('');
  const [budget, setBudget] = useState('');
  const [members, setMembers] = useState<string[]>([]);

  const create = useMutation({
    mutationFn: () =>
      api.post<SurpriseDto>('/surprises', {
        title: title.trim() || `${recipient?.name.split(' ')[0]}'s birthday surprise`,
        ...(recipient?.birthdayId ? { trackedBirthdayId: recipient.birthdayId } : recipient?.userId ? { beneficiaryUserId: recipient.userId } : { beneficiaryName: recipient?.name }),
        memberIds: members,
        budgetMinor: budget ? toMinor(Number(budget.replace(/,/g, '')), 'KES') : null,
        currency: 'KES',
      }),
    onSuccess: (surprise) => router.replace(`/surprise/${surprise.id}`),
  });

  if (isLoading) return <Loading />;
  if (!recipient) return <EmptyState icon="secret" title="Choose who the surprise is for" message="Open someone’s birthday and tap “Plan a surprise”." />;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Plan a surprise' }} />
      <Card style={{ backgroundColor: colors.accentSoft, borderColor: colors.accentSoft }}>
        <Row gap={spacing.md}>
          <Avatar name={recipient.name} uri={recipient.avatarUrl} />
          <T variant="heading" style={{ flex: 1 }}>
            {recipient.name}’s birthday surprise
          </T>
        </Row>
        <T color={colors.textMuted} style={{ marginTop: spacing.sm }}>
          {recipient.name.split(' ')[0]} won’t be added, won’t get notifications, and can’t see the planning.
        </T>
      </Card>
      <InlineError error={create.error} />
      <Field label="Name" value={title} onChangeText={setTitle} placeholder={`${recipient.name.split(' ')[0]}'s birthday surprise`} style={{ marginTop: spacing.lg }} error={fieldError(create.error, 'title')} />
      <Field label="Budget (KES, optional)" keyboardType="decimal-pad" value={budget} onChangeText={setBudget} />
      <Section title="Who’s in on it?">
        <FriendPicker selected={members} onChange={setMembers} excludeIds={recipient.userId ? [recipient.userId] : []} />
      </Section>
      <Button title="Create private group" icon="secret" loading={create.isPending} onPress={() => create.mutate()} style={{ marginTop: spacing.xl }} />
    </Screen>
  );
}
