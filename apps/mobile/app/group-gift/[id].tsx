import { RealtimeEvent, toMinor, type ContributionDto, type GroupGiftDto, type PaymentDto, type PaymentProvider, type SupportedCurrency } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { FriendPicker } from '../../src/components/FriendPicker';
import { PaymentMethodPicker, PaymentStatusBanner, usePaymentStatus } from '../../src/components/Payment';
import { money } from '../../src/components/gifting';
import { Avatar, Badge, Button, Card, Chip, ErrorState, Field, InlineError, Loading, ProgressBar, Row, Screen, Section, T, Toggle } from '../../src/components/ui';
import { api, errorMessage, idempotencyKey } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { useRealtimeRoom } from '../../src/lib/realtime';
import { colors, spacing } from '../../src/theme';

/** Group gift progress, contributions and reveal (spec §15, §49). */
export default function GroupGift() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const gift = useQuery({ queryKey: ['group-gift', id], queryFn: () => api.get<GroupGiftDto>(`/gifts/group/${id}`) });

  useRealtimeRoom('groupGift', id, {
    [RealtimeEvent.CONTRIBUTION_ADDED]: () => void queryClient.invalidateQueries({ queryKey: ['group-gift', id] }),
    [RealtimeEvent.GROUP_GIFT_UPDATED]: () => void queryClient.invalidateQueries({ queryKey: ['group-gift', id] }),
  });

  const [amount, setAmount] = useState('');
  const [message, setMessage] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [provider, setProvider] = useState<PaymentProvider | null>(null);
  const [phone, setPhone] = useState(user?.phone ?? '+254');
  const [pending, setPending] = useState<PaymentDto | null>(null);
  const [inviting, setInviting] = useState<string[]>([]);
  const [revealMessage, setRevealMessage] = useState('');
  const status = usePaymentStatus(pending);

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['group-gift', id] });

  const contribute = useMutation({
    mutationFn: () =>
      api.post<{ contributionId: string; payment: PaymentDto }>(`/gifts/group/${id}/contribute`, {
        amountMinor: toMinor(Number(amount.replace(/,/g, '')), (gift.data?.currency ?? 'KES') as SupportedCurrency),
        currency: gift.data?.currency ?? 'KES',
        isAnonymous: anonymous,
        message: message.trim() || null,
        provider,
        payerPhone: provider === 'MPESA' ? phone.replace(/\s/g, '') : undefined,
        idempotencyKey: idempotencyKey(),
      }),
    onSuccess: (result) => {
      setPending(result.payment);
      refresh();
    },
  });
  const invite = useMutation({ mutationFn: () => api.post(`/gifts/group/${id}/invite`, { userIds: inviting }), onSuccess: () => { setInviting([]); refresh(); Alert.alert('Invites sent'); }, onError: (error) => Alert.alert('Error', errorMessage(error)) });
  const purchased = useMutation({ mutationFn: () => api.post(`/gifts/group/${id}/purchased`), onSuccess: refresh, onError: (error) => Alert.alert('Error', errorMessage(error)) });
  const reveal = useMutation({ mutationFn: () => api.post(`/gifts/group/${id}/reveal`, { message: revealMessage || null, revealContributors: true }), onSuccess: () => { refresh(); Alert.alert('Revealed!', 'The birthday person can now see the gift and who chipped in.'); }, onError: (error) => Alert.alert('Error', errorMessage(error)) });

  if (gift.isLoading) return <Loading />;
  if (!gift.data) return <ErrorState error={gift.error} onRetry={() => void gift.refetch()} />;
  const data = gift.data;
  const isBeneficiary = data.beneficiary.id === user?.id;
  const open = data.status === 'OPEN' || data.status === 'FUNDED';
  const remaining = Math.max(0, data.targetMinor - data.raisedMinor);

  return (
    <Screen refreshing={gift.isRefetching} onRefresh={() => void gift.refetch()}>
      <Stack.Screen options={{ title: data.title }} />
      <Card>
        <T variant="caption" color={colors.brand}>
          {isBeneficiary ? 'A GIFT FOR YOU' : `FOR ${data.beneficiary.name.toUpperCase()}`}
        </T>
        <T variant="title" style={{ marginVertical: 4 }}>
          {data.title}
        </T>
        {data.description ? <T color={colors.textMuted}>{data.description}</T> : null}
        <T variant="heading" style={{ marginTop: spacing.md }}>
          {money(data.raisedMinor, data.currency)} <T color={colors.textMuted}>/ {money(data.targetMinor, data.currency)}</T>
        </T>
        <View style={{ marginVertical: spacing.sm }}>
          <ProgressBar percent={data.percentFunded} />
        </View>
        <Row style={{ justifyContent: 'space-between' }}>
          <T variant="caption" color={colors.textMuted}>
            {data.contributorCount} contributions · {data.percentFunded}%
          </T>
          <Badge label={data.status.toLowerCase()} tone={data.status === 'FUNDED' ? 'success' : 'brand'} />
        </Row>
        {data.deadline ? <T variant="caption" color={colors.textMuted}>Closes {new Date(data.deadline).toLocaleDateString()}</T> : null}
        {data.conversationId && !isBeneficiary ? <Button small variant="secondary" icon="chat" title="Planning chat" onPress={() => router.push(`/chat/${data.conversationId}`)} style={{ marginTop: spacing.md, alignSelf: 'flex-start' }} /> : null}
      </Card>

      {status.payment ? <PaymentStatusBanner payment={status.payment} timedOut={status.timedOut} onRetryCheck={() => void status.check().then(refresh)} successText="Thank you! Your contribution is in." /> : null}
      {status.payment?.status === 'SUCCESSFUL' ? <Button small variant="ghost" title="Done" onPress={() => { setPending(null); setAmount(''); refresh(); }} /> : null}

      {!isBeneficiary && open && !pending ? (
        <Section title="Contribute">
          <InlineError error={contribute.error} />
          <Row wrap style={{ marginBottom: spacing.sm }}>
            {[500, 1000, 2000, 5000].map((value) => (
              <Chip key={value} label={`${data.currency} ${value.toLocaleString()}`} selected={amount === String(value)} onPress={() => setAmount(String(value))} />
            ))}
            {remaining > 0 ? <Chip label="Finish it" onPress={() => setAmount(String(remaining / 100))} /> : null}
          </Row>
          <Field label={`Amount (${data.currency})`} keyboardType="decimal-pad" value={amount} onChangeText={setAmount} hint={`Minimum ${money(data.minContributionMinor, data.currency)}`} />
          <Field label="Message (optional)" value={message} onChangeText={setMessage} />
          <Toggle label="Contribute anonymously" value={anonymous} onChange={setAnonymous} />
          <PaymentMethodPicker currency={data.currency} value={provider} onChange={setProvider} phone={phone} onPhoneChange={setPhone} />
          <Button title="Contribute" loading={contribute.isPending} disabled={!Number(amount) || !provider} onPress={() => contribute.mutate()} />
        </Section>
      ) : null}

      {data.contributions.length > 0 ? (
        <Section title="Contributors">
          {data.contributions.map((contribution: ContributionDto) => (
            <Row key={contribution.id} gap={spacing.md} style={{ paddingVertical: spacing.sm }}>
              <Avatar name={contribution.contributor?.displayName ?? ''} uri={contribution.contributor?.avatarUrl} size={36} />
              <View style={{ flex: 1 }}>
                <T>{contribution.contributor?.displayName ?? 'Anonymous'}</T>
                {contribution.message ? <T variant="caption" color={colors.textMuted}>“{contribution.message}”</T> : null}
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <T variant="label">{money(contribution.amountMinor, contribution.currency)}</T>
                {contribution.status !== 'SUCCESSFUL' ? <Badge label={contribution.status.toLowerCase()} tone="gold" /> : null}
              </View>
            </Row>
          ))}
        </Section>
      ) : null}

      {data.isOrganizer ? (
        <Section title="Organiser tools">
          {open ? (
            <>
              <T variant="label" color={colors.textMuted} style={{ marginBottom: spacing.sm }}>
                Invite more friends
              </T>
              <FriendPicker selected={inviting} onChange={setInviting} excludeIds={data.beneficiary.id ? [data.beneficiary.id] : []} />
              {inviting.length ? <Button small title={`Invite ${inviting.length}`} loading={invite.isPending} onPress={() => invite.mutate()} /> : null}
            </>
          ) : null}
          <Row wrap style={{ marginTop: spacing.md }}>
            {open ? <Button small variant="secondary" title="Mark as bought" loading={purchased.isPending} onPress={() => purchased.mutate()} /> : null}
          </Row>
          {data.status !== 'REVEALED' && data.status !== 'CANCELLED' ? (
            <View style={{ marginTop: spacing.md }}>
              <Field label="Reveal message" value={revealMessage} onChangeText={setRevealMessage} placeholder="Happy birthday from all of us!" />
              <Button icon="party" title="Reveal the surprise" loading={reveal.isPending} onPress={() => Alert.alert('Reveal now?', `${data.beneficiary.name} will be told about the gift and who contributed.`, [{ text: 'Not yet', style: 'cancel' }, { text: 'Reveal', onPress: () => reveal.mutate() }])} />
            </View>
          ) : null}
        </Section>
      ) : null}
    </Screen>
  );
}
