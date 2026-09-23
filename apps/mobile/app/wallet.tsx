import { LIMITS, toMinor, type PaymentDto, type PaymentProvider, type PayoutDto, type WalletDto } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { PaymentMethodPicker, PaymentStatusBanner, usePaymentStatus } from '../src/components/Payment';
import { money } from '../src/components/gifting';
import { Alert, View } from 'react-native';
import { Badge, Button, Card, Chip, Field, InfoRow, InlineError, Loading, Row, Screen, Section, T } from '../src/components/ui';
import { api, idempotencyKey } from '../src/lib/api';
import { useAuth } from '../src/lib/auth';
import { colors, gradients, radius, spacing } from '../src/theme';

/** Birthday wallet, top-ups and payment history (spec §32, §33). */
export default function Wallet() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const wallet = useQuery({ queryKey: ['wallet'], queryFn: () => api.get<WalletDto>('/wallet') });
  const payments = useQuery({ queryKey: ['payments'], queryFn: () => api.get<PaymentDto[]>('/payments') });
  const premium = useQuery({ queryKey: ['premium-price'], queryFn: () => api.get<{ amountMinor: number; currency: string; periodDays: number }>('/payments/premium/price') });
  const [amount, setAmount] = useState('');
  const [provider, setProvider] = useState<PaymentProvider | null>(null);
  const [phone, setPhone] = useState(user?.phone ?? '+254');
  const [pending, setPending] = useState<PaymentDto | null>(null);
  const status = usePaymentStatus(pending);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const withdrawals = useQuery({ queryKey: ['withdrawals'], queryFn: () => api.get<PayoutDto[]>('/wallet/withdrawals') });

  const withdraw = useMutation({
    mutationFn: () =>
      api.post<PayoutDto>('/wallet/withdraw', {
        amountMinor: toMinor(Number(withdrawAmount), 'KES'),
        destination: (user?.phone ?? '').replace(/\s/g, ''),
        idempotencyKey: idempotencyKey(),
      }),
    onSuccess: (payout) => {
      setWithdrawAmount('');
      void queryClient.invalidateQueries({ queryKey: ['withdrawals'] });
      refresh();
      Alert.alert(
        payout.status === 'PAID' ? 'Sent' : 'On its way',
        payout.status === 'PAID'
          ? 'The money is on its way to your phone.'
          : 'We are sending it to your M-Pesa number. You will get a notification when it arrives.',
      );
    },
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['wallet'] });
    void queryClient.invalidateQueries({ queryKey: ['payments'] });
    void queryClient.invalidateQueries({ queryKey: ['me'] });
  };

  const topup = useMutation({
    mutationFn: () => api.post<PaymentDto>('/payments/wallet-topup', { amountMinor: toMinor(Number(amount), 'KES'), currency: 'KES', provider, payerPhone: provider === 'MPESA' ? phone.replace(/\s/g, '') : undefined, idempotencyKey: idempotencyKey() }),
    onSuccess: setPending,
  });
  const upgrade = useMutation({
    mutationFn: () => api.post<PaymentDto>('/payments', { provider, amountMinor: premium.data!.amountMinor, currency: premium.data!.currency, purpose: 'PREMIUM_SUBSCRIPTION', referenceType: 'SUBSCRIPTION', payerPhone: provider === 'MPESA' ? phone.replace(/\s/g, '') : undefined, idempotencyKey: idempotencyKey() }),
    onSuccess: setPending,
  });

  if (wallet.isLoading) return <Loading />;

  return (
    <Screen refreshing={wallet.isRefetching} onRefresh={refresh}>
      <Stack.Screen options={{ title: 'Wallet & payments' }} />
      <LinearGradient colors={gradients.brand} style={{ borderRadius: radius.xl, padding: spacing.xl }}>
        <T color="rgba(255,255,255,0.85)">Birthday wallet</T>
        <T variant="display" color={colors.white}>{money(wallet.data?.balanceMinor ?? 0, wallet.data?.currency)}</T>
        <T color="rgba(255,255,255,0.85)">Use it for gifts and group contributions.</T>
      </LinearGradient>

      {status.payment ? <PaymentStatusBanner payment={status.payment} timedOut={status.timedOut} onRetryCheck={() => void status.check().then(refresh)} successText="Payment confirmed" /> : null}
      {status.payment && status.payment.status !== 'PENDING' ? <Button small variant="ghost" title="Done" onPress={() => { setPending(null); setAmount(''); refresh(); }} /> : null}

      {!pending ? (
        <Section title="Top up">
          <InlineError error={topup.error ?? upgrade.error} />
          <Row wrap style={{ marginBottom: spacing.sm }}>
            {[500, 1000, 2500, 5000].map((value) => <Chip key={value} label={`KES ${value.toLocaleString()}`} selected={amount === String(value)} onPress={() => setAmount(String(value))} />)}
          </Row>
          <Field label="Amount (KES)" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
          <PaymentMethodPicker value={provider === 'WALLET' ? null : provider} onChange={(value) => setProvider(value === 'WALLET' ? null : value)} phone={phone} onPhoneChange={setPhone} />
          <Button title="Top up" loading={topup.isPending} disabled={!Number(amount) || !provider || provider === 'WALLET'} onPress={() => topup.mutate()} />
        </Section>
      ) : null}

      {!user?.isPremium && premium.data && !pending ? (
        <Card style={{ marginTop: spacing.xl, backgroundColor: colors.goldSoft, borderColor: colors.goldSoft }}>
          <T variant="heading">Premium</T>
          <T color={colors.textMuted} style={{ marginVertical: spacing.sm }}>
            More AI gift ideas, more wishlists, premium cards and animations, larger group gifts.
          </T>
          <Button title={`Upgrade · ${money(premium.data.amountMinor, premium.data.currency)} / ${premium.data.periodDays} days`} loading={upgrade.isPending} disabled={!provider} onPress={() => upgrade.mutate()} />
        </Card>
      ) : null}

      <Section title="Withdraw to M-Pesa" icon="cash">
        <Card>
          {user?.phoneVerified && user.phone ? (
            <>
              <T color={colors.textMuted}>
                Money people sent you goes to your own M-Pesa number, {user.phone}. The smallest withdrawal is {money(LIMITS.minPayoutMinor, wallet.data?.currency ?? 'KES')}.
              </T>
              <Row wrap style={{ marginTop: spacing.md }}>
                {[100, 500, 1000, 2500].map((value) => (
                  <Chip key={value} label={`KES ${value.toLocaleString()}`} selected={withdrawAmount === String(value)} onPress={() => setWithdrawAmount(String(value))} />
                ))}
                {(wallet.data?.balanceMinor ?? 0) >= LIMITS.minPayoutMinor ? (
                  <Chip label="Everything" selected={false} onPress={() => setWithdrawAmount(String((wallet.data!.balanceMinor / 100).toFixed(0)))} />
                ) : null}
              </Row>
              <Field label="Amount (KES)" keyboardType="number-pad" value={withdrawAmount} onChangeText={setWithdrawAmount} style={{ marginTop: spacing.md }} />
              <InlineError error={withdraw.error} />
              <Button
                icon="cash"
                title={withdrawAmount ? `Withdraw KES ${Number(withdrawAmount).toLocaleString()}` : 'Withdraw'}
                loading={withdraw.isPending}
                disabled={!Number(withdrawAmount) || toMinor(Number(withdrawAmount), 'KES') > (wallet.data?.balanceMinor ?? 0)}
                onPress={() => withdraw.mutate()}
              />
            </>
          ) : (
            <InfoRow icon="alert">Verify your phone number in Settings → Account first. Money only ever leaves to a number you have proved is yours.</InfoRow>
          )}
        </Card>

        {withdrawals.data?.length ? (
          <View style={{ marginTop: spacing.md }}>
            {withdrawals.data.slice(0, 5).map((payout) => (
              <Row key={payout.id} style={{ justifyContent: 'space-between', paddingVertical: spacing.sm }}>
                <View style={{ flex: 1 }}>
                  <T variant="label">{money(payout.amountMinor, payout.currency)}</T>
                  <T variant="caption" color={colors.textMuted}>
                    To {payout.destination} · {new Date(payout.requestedAt).toLocaleDateString()}
                  </T>
                  {payout.failureReason ? (
                    <T variant="caption" color={colors.danger}>
                      {payout.failureReason}
                    </T>
                  ) : null}
                </View>
                <Badge
                  tone={payout.status === 'PAID' ? 'success' : payout.status === 'FAILED' ? 'danger' : 'muted'}
                  label={payout.status === 'PAID' ? 'Sent' : payout.status === 'FAILED' ? 'Returned' : 'In progress'}
                />
              </Row>
            ))}
          </View>
        ) : null}
      </Section>

      <Section title="Wallet activity">
        {wallet.data?.transactions.length === 0 ? <T color={colors.textMuted}>No transactions yet.</T> : null}
        {wallet.data?.transactions.map((txn) => (
          <Row key={txn.id} style={{ justifyContent: 'space-between', paddingVertical: spacing.sm }}>
            <T style={{ flex: 1 }}>{txn.description ?? txn.reason.toLowerCase()}</T>
            <T variant="label" color={txn.type === 'CREDIT' ? colors.success : colors.text}>{txn.type === 'CREDIT' ? '+' : '−'}{money(txn.amountMinor, txn.currency)}</T>
          </Row>
        ))}
      </Section>

      <Section title="Payments">
        {payments.data?.map((payment) => (
          <Row key={payment.id} style={{ justifyContent: 'space-between', paddingVertical: spacing.sm }}>
            <T style={{ flex: 1 }}>{payment.purpose.replace(/_/g, ' ').toLowerCase()} · {payment.provider.toLowerCase()}</T>
            <T variant="label">{money(payment.amountMinor, payment.currency)}</T>
            <T variant="caption" color={payment.status === 'SUCCESSFUL' ? colors.success : payment.status === 'PENDING' ? colors.gold : colors.danger} style={{ width: 80, textAlign: 'right' }}>{payment.status.toLowerCase()}</T>
          </Row>
        ))}
      </Section>
    </Screen>
  );
}
