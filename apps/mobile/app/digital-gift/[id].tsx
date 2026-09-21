import { DIGITAL_GIFT_META, type DigitalGiftDto } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { Alert } from 'react-native';
import { Confetti } from '../../src/components/Confetti';
import { money } from '../../src/components/gifting';
import { Button, ErrorState, IconTile, Loading, Screen, T } from '../../src/components/ui';
import { api, errorMessage } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { colors, gradients, radius, spacing } from '../../src/theme';
import { DIGITAL_GIFT_ICONS } from '../../src/lib/icons';

/** Unwrapping a digital gift: "🎉 You received a gift from John!" (spec §16). */
export default function DigitalGiftDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const gift = useQuery({ queryKey: ['digital-gift', id], queryFn: () => api.get<DigitalGiftDto>(`/digital-gifts/${id}`) });
  const open = useMutation({
    mutationFn: () => api.post<DigitalGiftDto>(`/digital-gifts/${id}/open`),
    onSuccess: (data) => queryClient.setQueryData(['digital-gift', id], data),
    onError: (error) => Alert.alert('Could not open', errorMessage(error)),
  });

  if (gift.isLoading) return <Loading />;
  if (!gift.data) return <ErrorState error={gift.error} />;
  const data = gift.data;
  const meta = DIGITAL_GIFT_META[data.type];
  const isRecipient = data.recipientId === user?.id;
  const opened = Boolean(data.openedAt) || !isRecipient;

  return (
    <Screen>
      <Stack.Screen options={{ title: meta.label }} />
      {opened ? <Confetti count={20} loop={false} /> : null}
      <LinearGradient colors={gradients.celebration} style={{ borderRadius: radius.xl, padding: spacing.xl, alignItems: 'center', minHeight: 320, justifyContent: 'center' }}>
        <IconTile name={opened ? DIGITAL_GIFT_ICONS[data.type] : 'gift'} size={96} tone="onDark" />
        <T variant="title" color={colors.white} center style={{ marginTop: spacing.md }}>
          {isRecipient ? `You received a gift${data.sender ? ` from ${data.sender.displayName}` : ''}!` : `${meta.label} for them`}
        </T>
        {opened && data.message ? <T color={colors.white} center style={{ marginTop: spacing.md, fontSize: 17 }}>“{data.message}”</T> : null}
        {opened && data.valueMinor ? <T variant="display" color={colors.white} style={{ marginTop: spacing.md }}>{money(data.valueMinor, data.currency ?? 'KES')}</T> : null}
        {!opened ? <Button title="Unwrap" loading={open.isPending} onPress={() => open.mutate()} style={{ marginTop: spacing.xl, backgroundColor: colors.white, borderRadius: radius.pill }} /> : null}
      </LinearGradient>
      {opened && data.redemptionCode ? (
        <Button variant="secondary" icon="list" title={`Code: ${data.redemptionCode}`} onPress={() => void Clipboard.setStringAsync(data.redemptionCode!).then(() => Alert.alert('Code copied'))} style={{ marginTop: spacing.lg }} />
      ) : null}
      {isRecipient && opened ? (
        <Button icon="heart" title="Send a thank you" onPress={() => router.push({ pathname: '/thank-you', params: { giftType: 'DIGITAL_GIFT', giftId: data.id, name: data.sender?.displayName ?? '' } })} style={{ marginTop: spacing.lg }} />
      ) : null}
      {!isRecipient ? <T color={colors.textMuted} center style={{ marginTop: spacing.lg }}>{data.deliveredAt ? `Delivered ${new Date(data.deliveredAt).toLocaleString()}${data.openedAt ? ' · opened' : ''}` : `Scheduled for ${data.deliverAt ? new Date(data.deliverAt).toLocaleString() : 'soon'}`}</T> : null}
    </Screen>
  );
}
