import type { InviteDto } from '@bday/shared';
import { useMutation } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { Alert, Linking, Share, View } from 'react-native';
import { Button, Card, InlineError, Loading, Screen, T } from '../src/components/ui';
import { api } from '../src/lib/api';
import { useAuth } from '../src/lib/auth';
import { colors, spacing } from '../src/theme';

/** Invitation link + QR code (spec §8). Accepting links the calendar entry. */
export default function Invite() {
  const { birthdayId } = useLocalSearchParams<{ birthdayId?: string }>();
  const { user } = useAuth();
  const create = useMutation({ mutationFn: () => api.post<InviteDto>('/invites', { trackedBirthdayId: birthdayId || undefined, expiresInDays: 30 }) });

  useEffect(() => {
    create.mutate();
    // Create once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const invite = create.data;
  const message = invite ? `${user?.displayName ?? 'A friend'} wants to celebrate your birthday! Join me on Birthday: ${invite.url}` : '';

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Invite a friend' }} />
      <InlineError error={create.error} />
      {!invite ? (
        <Loading />
      ) : (
        <Card style={{ alignItems: 'center' }}>
          <T variant="heading">Scan or share this invite</T>
          <Image source={{ uri: invite.qrDataUrl }} style={{ width: 220, height: 220, marginVertical: spacing.lg }} />
          <T variant="title" color={colors.brand}>{invite.code}</T>
          <T variant="caption" color={colors.textMuted} style={{ marginBottom: spacing.lg }}>
            Valid until {invite.expiresAt ? new Date(invite.expiresAt).toLocaleDateString() : 'forever'}
          </T>
          <View style={{ width: '100%', gap: spacing.sm }}>
            <Button icon="chat" title="Share on WhatsApp" onPress={() => void Linking.openURL(`whatsapp://send?text=${encodeURIComponent(message)}`).catch(() => Alert.alert('WhatsApp is not installed'))} />
            <Button variant="secondary" icon="chat" title="Send SMS" onPress={() => void Linking.openURL(`sms:?&body=${encodeURIComponent(message)}`)} />
            <Button variant="secondary" icon="list" title="Copy link" onPress={() => void Clipboard.setStringAsync(invite.url).then(() => Alert.alert('Copied'))} />
            <Button variant="secondary" icon="share" title="More…" onPress={() => void Share.share({ message })} />
          </View>
        </Card>
      )}
    </Screen>
  );
}
