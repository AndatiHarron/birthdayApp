import { useMutation } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { Button, Chip, Field, InlineError, Row, Screen, T } from '../src/components/ui';
import { api } from '../src/lib/api';
import { colors, spacing } from '../src/theme';

const REASONS = [
  ['SPAM', 'Spam'],
  ['HARASSMENT', 'Harassment'],
  ['IMPERSONATION', 'Impersonation'],
  ['INAPPROPRIATE_CONTENT', 'Inappropriate content'],
  ['FRAUD', 'Fraud or scam'],
  ['OTHER', 'Something else'],
] as const;

/** Report a person, shop, product or message (spec §39). */
export default function Report() {
  const params = useLocalSearchParams<{ targetType: 'USER' | 'PRODUCT' | 'VENDOR' | 'MESSAGE' | 'WISHLIST_ITEM' | 'ORDER'; targetId: string }>();
  const [reason, setReason] = useState<(typeof REASONS)[number][0]>('SPAM');
  const [details, setDetails] = useState('');
  const submit = useMutation({
    mutationFn: () => api.post('/reports', { targetType: params.targetType, targetId: params.targetId, reason, details: details.trim() || null }),
    onSuccess: () => {
      Alert.alert('Thanks for telling us', 'Our team will review this.');
      router.back();
    },
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Report' }} />
      <T color={colors.textMuted} style={{ marginBottom: spacing.lg }}>Reports are confidential.</T>
      <InlineError error={submit.error} />
      <Row wrap style={{ marginBottom: spacing.lg }}>
        {REASONS.map(([value, label]) => <Chip key={value} label={label} selected={reason === value} onPress={() => setReason(value)} />)}
      </Row>
      <Field label="What happened?" multiline value={details} onChangeText={setDetails} />
      <Button title="Send report" loading={submit.isPending} onPress={() => submit.mutate()} />
    </Screen>
  );
}
