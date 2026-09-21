import type { PaymentDto, PaymentProvider } from '@bday/shared';
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { api } from '../lib/api';
import { colors, spacing } from '../theme';
import { Button, Chip, Field, Loading, Row, T } from './ui';

interface ProviderOption {
  provider: PaymentProvider;
  label: string;
  requiresPhone: boolean;
}

/** Payment method picker; phone number is asked for M-Pesa only. */
export function PaymentMethodPicker({
  currency = 'KES',
  value,
  onChange,
  phone,
  onPhoneChange,
}: {
  currency?: string;
  value: PaymentProvider | null;
  onChange: (provider: PaymentProvider) => void;
  phone: string;
  onPhoneChange: (phone: string) => void;
}) {
  const providers = useQuery({ queryKey: ['providers', currency], queryFn: () => api.get<ProviderOption[]>('/payments/providers', { currency }) });

  useEffect(() => {
    if (!value && providers.data?.[0]) onChange(providers.data[0].provider);
  }, [providers.data, value, onChange]);

  const selected = providers.data?.find((option) => option.provider === value);
  return (
    <View>
      <T variant="label" color={colors.textMuted} style={{ marginBottom: 6 }}>
        Pay with
      </T>
      {providers.isLoading ? <Loading /> : null}
      <Row wrap style={{ marginBottom: spacing.md }}>
        {providers.data?.map((option) => (
          <Chip
            key={option.provider}
            label={option.label}
            icon={option.provider === 'MPESA' ? 'smartphone' : option.provider === 'WALLET' ? 'wallet' : 'card'}
            selected={value === option.provider}
            onPress={() => onChange(option.provider)}
          />
        ))}
      </Row>
      {selected?.requiresPhone ? (
        <Field label="M-Pesa phone number" keyboardType="phone-pad" value={phone} onChangeText={onPhoneChange} hint="You’ll get a prompt on this phone to enter your M-Pesa PIN." />
      ) : null}
    </View>
  );
}

/**
 * Waits for a payment to settle.
 *
 * The app never decides a payment succeeded (spec §58 rule 5): it asks the API
 * to verify with the provider, which is the only thing that can mark it paid.
 */
export function usePaymentStatus(initial: PaymentDto | null) {
  const [payment, setPayment] = useState<PaymentDto | null>(initial);
  const [timedOut, setTimedOut] = useState(false);
  const attempts = useRef(0);

  useEffect(() => {
    setPayment(initial);
    setTimedOut(false);
    attempts.current = 0;
  }, [initial]);

  const check = useCallback(async () => {
    if (!payment) return;
    const updated = await api.post<PaymentDto>(`/payments/${payment.id}/verify`);
    setPayment(updated);
  }, [payment]);

  useEffect(() => {
    if (!payment || payment.status !== 'PENDING') return;
    const delay = payment.action?.type === 'AWAIT_STK_PUSH' ? Math.max(3, payment.action.pollAfterSeconds) * 1000 : 3000;
    const timer = setTimeout(() => {
      attempts.current += 1;
      if (attempts.current > 40) {
        setTimedOut(true);
        return;
      }
      void check().catch(() => undefined);
    }, delay);
    return () => clearTimeout(timer);
  }, [payment, check]);

  return { payment, timedOut, check };
}

export function PaymentStatusBanner({ payment, timedOut, onRetryCheck, successText }: { payment: PaymentDto; timedOut: boolean; onRetryCheck: () => void; successText: string }) {
  if (payment.status === 'SUCCESSFUL') {
    return (
      <View style={{ backgroundColor: colors.successSoft, padding: spacing.lg, borderRadius: 16, marginVertical: spacing.md }}>
        <T variant="heading" color={colors.success}>
          {successText}
        </T>
      </View>
    );
  }
  if (payment.status === 'FAILED' || payment.status === 'CANCELLED') {
    return (
      <View style={{ backgroundColor: colors.dangerSoft, padding: spacing.lg, borderRadius: 16, marginVertical: spacing.md }}>
        <T variant="heading" color={colors.danger}>
          Payment didn’t go through
        </T>
        <T color={colors.danger}>{payment.failureReason ?? 'Please try again or use another method.'}</T>
      </View>
    );
  }
  return (
    <View style={{ backgroundColor: colors.goldSoft, padding: spacing.lg, borderRadius: 16, marginVertical: spacing.md, gap: spacing.sm }}>
      <T variant="heading">Waiting for confirmation…</T>
      <T color={colors.textMuted}>{payment.action?.type === 'AWAIT_STK_PUSH' ? payment.action.message : 'Complete the payment to continue.'}</T>
      {timedOut ? <Button small variant="secondary" title="Check again" onPress={onRetryCheck} /> : <Loading />}
    </View>
  );
}
