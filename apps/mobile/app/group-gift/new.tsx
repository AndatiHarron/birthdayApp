import { toMajor, toMinor, type GroupGiftDto, type SupportedCurrency } from '@bday/shared';
import { useMutation } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { FriendPicker } from '../../src/components/FriendPicker';
import { Button, Card, Field, InlineError, Screen, Section, T, Toggle } from '../../src/components/ui';
import { api, fieldError } from '../../src/lib/api';
import { colors, spacing } from '../../src/theme';

/** Start a group gift (spec §15). */
export default function NewGroupGift() {
  const params = useLocalSearchParams<{ wishlistItemId?: string; title?: string; target?: string; currency?: string; beneficiaryUserId?: string; birthdayId?: string; name?: string; surpriseId?: string }>();
  const currency = (params.currency as SupportedCurrency) || 'KES';
  const [title, setTitle] = useState(params.title ?? '');
  const [description, setDescription] = useState('');
  const [target, setTarget] = useState(params.target ? String(toMajor(Number(params.target), currency)) : '');
  const [minimum, setMinimum] = useState('50');
  const [deadlineDays, setDeadlineDays] = useState('');
  const [invitees, setInvitees] = useState<string[]>([]);
  const [chat, setChat] = useState(true);

  const create = useMutation({
    mutationFn: () =>
      api.post<GroupGiftDto>('/gifts/group', {
        title: title.trim(),
        description: description.trim() || null,
        targetMinor: toMinor(Number(target.replace(/,/g, '')), currency),
        currency,
        minContributionMinor: toMinor(Number(minimum || 0), currency),
        ...(params.beneficiaryUserId ? { beneficiaryUserId: params.beneficiaryUserId } : params.birthdayId ? { trackedBirthdayId: params.birthdayId } : { beneficiaryName: params.name ?? 'Birthday person' }),
        wishlistItemId: params.wishlistItemId || undefined,
        deadline: deadlineDays ? new Date(Date.now() + Number(deadlineDays) * 86_400_000).toISOString() : undefined,
        inviteUserIds: invitees,
        createSurpriseGroup: chat,
      }),
    onSuccess: async (gift) => {
      if (params.surpriseId) await api.post(`/surprises/${params.surpriseId}/group-gift`, { groupGiftId: gift.id }).catch(() => undefined);
      router.replace(`/group-gift/${gift.id}`);
    },
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Group gift' }} />
      <Card style={{ backgroundColor: colors.brandSoft, borderColor: colors.brandSoft, marginBottom: spacing.lg }}>
        <T variant="heading" color={colors.brandDark}>
          For {params.name ?? 'the birthday person'}
        </T>
        <T color={colors.brandDark}>They won’t see who contributed until you reveal the gift.</T>
      </Card>
      <InlineError error={create.error} />
      <Field label="Gift" value={title} onChangeText={setTitle} placeholder="MacBook Pro" error={fieldError(create.error, 'title')} />
      <Field label={`Goal (${currency})`} keyboardType="decimal-pad" value={target} onChangeText={setTarget} placeholder="250000" error={fieldError(create.error, 'targetMinor')} />
      <Field label={`Minimum contribution (${currency})`} keyboardType="decimal-pad" value={minimum} onChangeText={setMinimum} />
      <Field label="Close after (days, optional)" keyboardType="number-pad" value={deadlineDays} onChangeText={setDeadlineDays} />
      <Field label="Note to contributors" multiline value={description} onChangeText={setDescription} />
      <Toggle label="Create a private planning chat" description="The birthday person is never added." value={chat} onChange={setChat} />
      <Section title="Invite friends">
        <FriendPicker selected={invitees} onChange={setInvitees} excludeIds={params.beneficiaryUserId ? [params.beneficiaryUserId] : []} />
      </Section>
      <Button title="Start group gift" loading={create.isPending} disabled={!title.trim() || !Number(target)} onPress={() => create.mutate()} style={{ marginTop: spacing.xl }} />
    </Screen>
  );
}
