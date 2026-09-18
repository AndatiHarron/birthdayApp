import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioPlayer, useAudioRecorder, useAudioRecorderState } from 'expo-audio';
import { useEffect, useState } from 'react';
import { Alert, Platform, View } from 'react-native';
import { errorMessage } from '../lib/api';
import { uploadFile } from '../lib/media';
import { colors, radius, spacing } from '../theme';
import { Button, Row, T } from './ui';

/** Records a voice note and uploads it (spec §23 voice wishes, §29 voice notes). */
export function VoiceRecorder({ onRecorded, maxSeconds = 120 }: { onRecorded: (voice: { url: string; durationSeconds: number } | null) => void; maxSeconds?: number }) {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const state = useAudioRecorderState(recorder, 250);
  const [uploading, setUploading] = useState(false);
  const [recorded, setRecorded] = useState<{ url: string; durationSeconds: number } | null>(null);

  const seconds = Math.floor((state.durationMillis ?? 0) / 1000);
  useEffect(() => {
    if (state.isRecording && seconds >= maxSeconds) void stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.isRecording, seconds, maxSeconds]);

  async function start() {
    if (Platform.OS === 'web') {
      Alert.alert('Voice notes need the mobile app');
      return;
    }
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Microphone access needed', 'Allow microphone access in Settings to record a voice wish.');
      return;
    }
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    setRecorded(null);
    onRecorded(null);
    await recorder.prepareToRecordAsync();
    recorder.record();
  }

  async function stop() {
    const durationSeconds = Math.max(1, Math.round((state.durationMillis ?? 0) / 1000));
    await recorder.stop();
    await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
    const uri = recorder.uri;
    if (!uri) return;
    setUploading(true);
    try {
      const url = await uploadFile('voice', { uri, name: `voice-${Date.now()}.m4a`, type: 'audio/mp4' });
      const voice = { url, durationSeconds };
      setRecorded(voice);
      onRecorded(voice);
    } catch (error) {
      Alert.alert('Upload failed', errorMessage(error));
    } finally {
      setUploading(false);
    }
  }

  return (
    <View style={{ backgroundColor: colors.surfaceMuted, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.md, alignItems: 'center' }}>
      <T variant="title">{state.isRecording ? `🔴 ${seconds}s` : recorded ? `🎤 ${recorded.durationSeconds}s recorded` : '🎤 Record a voice wish'}</T>
      <Row>
        {state.isRecording ? (
          <Button title="Stop" variant="danger" onPress={() => void stop()} />
        ) : (
          <Button title={recorded ? 'Record again' : 'Start recording'} loading={uploading} onPress={() => void start()} />
        )}
      </Row>
      {recorded ? <VoicePlayer url={recorded.url} /> : null}
    </View>
  );
}

export function VoicePlayer({ url, durationSeconds }: { url: string; durationSeconds?: number | null }) {
  const player = useAudioPlayer({ uri: url });
  return (
    <Button
      small
      variant="secondary"
      icon="▶️"
      title={durationSeconds ? `Play (${durationSeconds}s)` : 'Play'}
      onPress={() => {
        void player.seekTo(0);
        player.play();
      }}
    />
  );
}
