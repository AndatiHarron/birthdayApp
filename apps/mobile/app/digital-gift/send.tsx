import { toMinor, type DigitalGiftCatalogItem, type DigitalGiftDto, type DigitalGiftType, type PaymentDto, type PaymentProvider } from '@bday/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { PaymentMethodPicker, PaymentStatusBanner, usePaymentStatus } from '../../src/components/Payment';
import { money } from '../../src/components/gifting';
import { Button, Card, Chip, EmptyState, Field, InlineError, Loading, Row, Screen, Section, T, Toggle } from '../../src/components/ui';
import { api, idempotencyKey } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { useRecipient } from '../../src/lib/recipient';
import { colors, radius, spacing } from '../../src/theme';

/** Instant or scheduled digital gifts (spec §16, §18). */
export default function SendDigitalGift() {
  const params = useLocalSearchParams<{ userId?: string; birthdayId?: string; name?: string }>();
  const { user } = useAuth();
  const { recipient, isLoading } = useRecipient(params);
  const catalog = useQuery({ queryKey: ['digital-catalog'], queryFn: () => api.get<DigitalGiftCatalogItem[]>('/digital-gifts/catalog') });

  const [type, setType] = useState<DigitalGiftType>('FLOWERS');
  const [message, setMessage] = useState('');
  const [value, setValue] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [scheduleDays, setScheduleDays] = useState<number | null>(null);
  const [provider, setProvider] = useState<PaymentProvider | null>(null);
  const [phone, setPhone] = useState(user?.phone ?? '+254');
  const [key] = useState(idempotencyKey);
  const [sent, setSent] = useState<{ gift: DigitalGiftDto; payment: PaymentDto | null } | null>(null);
  const status = usePaymentStatus(sent?.payment ?? null);

  const item = useMemo(() => catalog.data?.find((entry) => entry.type === type), [catalog.data, type]);
  const needsPayment = Boolean(item?.requiresValue || (item?.feeMinor ?? 0) > 0);

  const send = useMutation({
    mutationFn: () =>
      api.post<{ gift: DigitalGiftDto; payment: PaymentDto | null }>('/digital-gifts', {
        type,
        recipientUserId: recipient?.userId,
        message: message.trim() || null,
        valueMinor: item?.requiresValue ? toMinor(Number(value), 'KES') : undefined,
        currency: item?.requiresValue ? 'KES' : undefined,
        isAnonymous: anonymous,
        deliverAt: scheduleDays ? new Date(Date.now() + scheduleDays * 86_400_000).toISOString() : undefined,
        provider: needsPayment ? provider : undefined,
        payerPhone: needsPayment && provider === 'MPESA' ? phone.replace(/\s/g, '') : undefined,
        idempotencyKey: key,
      }),
    onSuccess: setSent,
  });

  if (isLoading || catalog.isLoading) return <Loading />;
  if (!recipient?.userId) return <EmptyState emoji="📨" title="They need the app to receive digital gifts" />;

  const done = sent && (!sent.payment || status.payment?.status === 'SUCCESSFUL');

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Digital gift' }} />
      {done ? (
        <EmptyState emoji="🎉" title={scheduleDays ? 'Scheduled!' : 'Gift sent!'} message={scheduleDays ? `It will arrive in ${scheduleDays} days.` : `${recipient.name.split(' ')[0]} just got a surprise.`} action={<Button title="Done" onPress={() => router.back()} />} />
      ) : sent?.payment && status.payment ? (
        <PaymentStatusBanner payment={status.payment} timedOut={status.timedOut} onRetryCheck={() => void status.check()} successText="Paid" />
      ) : (
        <>
          <T variant="title">For {recipient.name.split(' ')[0]} 🎁</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md, marginTop: spacing.lg }}>
            {catalog.data?.map((entry) => (
              <Pressable key={entry.type} onPress={() => setType(entry.type)} style={{ width: '30%', padding: spacing.md, borderRadius: radius.lg, alignItems: 'center', backgroundColor: type === entry.type ? colors.brandSoft : colors.surface, borderWidth: 1, borderColor: type === entry.type ? colors.brand : colors.border }}>
                <T style={{ fontSize: 32 }}>{entry.emoji}</T>
                <T variant="caption" center>
                  {entry.label}
                </T>
                {entry.isPremium ? <T variant="caption" color={colors.gold}>✨ Premium</T> : null}
              </Pressable>
            ))}
          </View>
          <InlineError error={send.error} />
          {item?.requiresValue ? (
            <Section title="Value">
              <Row wrap style={{ marginBottom: spacing.sm }}>
                {item.suggestedValuesMinor.map((suggested) => (
                  <Chip key={suggested} label={money(suggested)} selected={value === String(suggested / 100)} onPress={() => setValue(String(suggested / 100))} />
                ))}
              </Row>
              <Field label="Amount (KES)" keyboardType="decimal-pad" value={value} onChangeText={setValue} />
            </Section>
          ) : null}
          <Field label="Message" multiline value={message} onChangeText={setMessage} placeholder="Happy birthday! 🎉" style={{ marginTop: spacing.lg }} />
          <T variant="label" color={colors.textMuted} style={{ marginBottom: 6 }}>
            When
          </T>
          <Row wrap>
            <Chip label="Now" selected={scheduleDays == null} onPress={() => setScheduleDays(null)} />
            {[1, 3, 7].map((days) => (
              <Chip key={days} label={`In ${days} day${days > 1 ? 's' : ''}`} selected={scheduleDays === days} onPress={() => setScheduleDays(days)} />
            ))}
          </Row>
          <Toggle label="Send anonymously" value={anonymous} onChange={setAnonymous} />
          {needsPayment ? (
            <Card style={{ marginVertical: spacing.md }}>
              {item?.feeMinor ? <T color={colors.textMuted}>Fee: {money(item.feeMinor)}</T> : null}
              <PaymentMethodPicker value={provider} onChange={setProvider} phone={phone} onPhoneChange={setPhone} />
            </Card>
          ) : null}
          <Button title={needsPayment ? 'Pay & send' : 'Send gift'} loading={send.isPending} disabled={(item?.requiresValue && !Number(value)) || (needsPayment && !provider)} onPress={() => send.mutate()} />
        </>
      )}
    </Screen>
  );
}
