import { useMutation } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable } from 'react-native';
import { VoiceRecorder } from '../src/components/VoiceRecorder';
import { Button, Chip, Field, InlineError, Row, Screen, T } from '../src/components/ui';
import { api } from '../src/lib/api';
import { pickAndUploadImage } from '../src/lib/media';
import { colors, radius, spacing } from '../src/theme';

/** Thank-you messages (spec §27): text, voice or image. */
export default function ThankYou() {
  const params = useLocalSearchParams<{ giftType: 'RESERVATION' | 'DIGITAL_GIFT' | 'ORDER' | 'GROUP_GIFT'; giftId: string; name?: string }>();
  const [kind, setKind] = useState<'TEXT' | 'VOICE' | 'IMAGE'>('TEXT');
  const [body, setBody] = useState('');
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);

  const send = useMutation({
    mutationFn: () => api.post('/thank-yous', { giftType: params.giftType, giftId: params.giftId, kind, body: body.trim() || null, mediaUrl }),
    onSuccess: () => {
      Alert.alert('Sent', 'Your thank you is on its way.');
      router.back();
    },
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Say thank you' }} />
      <T variant="title">Send a thank you</T>
      {params.name ? <T color={colors.textMuted}>To {params.name}</T> : null}
      <Row style={{ marginVertical: spacing.lg }}>
        <Chip icon="edit" label="Text" selected={kind === 'TEXT'} onPress={() => { setKind('TEXT'); setMediaUrl(null); }} />
        <Chip icon="mic" label="Voice" selected={kind === 'VOICE'} onPress={() => { setKind('VOICE'); setMediaUrl(null); }} />
        <Chip icon="camera" label="Photo" selected={kind === 'IMAGE'} onPress={() => { setKind('IMAGE'); setMediaUrl(null); }} />
      </Row>
      <InlineError error={send.error} />
      {kind === 'VOICE' ? <VoiceRecorder onRecorded={(voice) => setMediaUrl(voice?.url ?? null)} /> : null}
      {kind === 'IMAGE' ? (
        <Pressable onPress={() => void pickAndUploadImage('memory').then((url) => url && setMediaUrl(url))} style={{ height: 220, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', marginBottom: spacing.md }}>
          {mediaUrl ? <Image source={{ uri: mediaUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <T color={colors.textMuted}>Photo of you with the gift</T>}
        </Pressable>
      ) : null}
      <Field label="Message" multiline value={body} onChangeText={setBody} placeholder="Thank you so much! I absolutely love it" style={{ marginTop: spacing.md }} />
      <Button title="Send thank you" loading={send.isPending} disabled={!body.trim() && !mediaUrl} onPress={() => send.mutate()} />
    </Screen>
  );
}
