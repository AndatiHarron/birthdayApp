import type { MemoryDto } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Field, InlineError, Loading, Row, Screen, T } from '../src/components/ui';
import { api, errorMessage } from '../src/lib/api';
import { pickAndUploadImage } from '../src/lib/media';
import { colors, radius, spacing } from '../src/theme';

/** Yearly birthday history with photos (spec §25). */
export default function Memories() {
  const queryClient = useQueryClient();
  const memories = useQuery({ queryKey: ['memories'], queryFn: () => api.get<MemoryDto[]>('/memories') });
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(String(thisYear));
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [composing, setComposing] = useState(false);

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['memories'] });
  const save = useMutation({
    mutationFn: () => api.post<MemoryDto>('/memories', { celebrationYear: Number(year), title: title.trim() || null, note: note.trim() || null, media: photos.map((url) => ({ url, kind: 'IMAGE' })) }),
    onSuccess: () => {
      setComposing(false);
      setTitle('');
      setNote('');
      setPhotos([]);
      invalidate();
    },
  });
  const removeMedia = useMutation({ mutationFn: (mediaId: string) => api.delete(`/memories/media/${mediaId}`), onSuccess: invalidate, onError: (error) => Alert.alert('Error', errorMessage(error)) });

  return (
    <Screen refreshing={memories.isRefetching} onRefresh={() => void memories.refetch()}>
      <Stack.Screen options={{ title: 'Birthday memories' }} />
      {!composing ? <Button icon="camera" title="Save a memory" onPress={() => setComposing(true)} style={{ marginBottom: spacing.lg }} /> : (
        <Card style={{ marginBottom: spacing.lg }}>
          <InlineError error={save.error} />
          <Field label="Year" keyboardType="number-pad" value={year} onChangeText={setYear} />
          <Field label="Title" value={title} onChangeText={setTitle} placeholder="My 30th in Diani" />
          <Field label="Note" multiline value={note} onChangeText={setNote} />
          <ScrollView horizontal contentContainerStyle={{ gap: spacing.sm, marginBottom: spacing.md }}>
            {photos.map((url) => <Image key={url} source={{ uri: url }} style={{ width: 80, height: 80, borderRadius: radius.md }} />)}
            <Pressable onPress={() => void pickAndUploadImage('memory').then((url) => url && setPhotos([...photos, url]))} style={{ width: 80, height: 80, borderRadius: radius.md, backgroundColor: colors.surfaceMuted, alignItems: 'center', justifyContent: 'center' }}>
              <T style={{ fontSize: 26 }}>＋</T>
            </Pressable>
          </ScrollView>
          <Row>
            <Button small title="Save" loading={save.isPending} disabled={!Number(year)} onPress={() => save.mutate()} />
            <Button small variant="ghost" title="Cancel" onPress={() => setComposing(false)} />
          </Row>
        </Card>
      )}
      {memories.isLoading ? <Loading /> : null}
      {memories.error ? <ErrorState error={memories.error} /> : null}
      {memories.data?.length === 0 ? <EmptyState icon="camera" title="No memories yet" message="After your birthday, save photos, wishes and gifts here." /> : null}
      {memories.data?.map((memory) => (
        <Card key={memory.id} style={{ marginBottom: spacing.md }}>
          <T variant="title">{memory.celebrationYear}</T>
          {memory.title ? <T variant="heading">{memory.title}</T> : null}
          <T color={colors.textMuted}>{memory.giftCount} gifts · {memory.wishCount} wishes · {memory.media.length} photos</T>
          {memory.note ? <T style={{ marginTop: spacing.sm }}>{memory.note}</T> : null}
          {memory.media.length ? (
            <ScrollView horizontal contentContainerStyle={{ gap: spacing.sm, marginTop: spacing.md }}>
              {memory.media.map((media) => (
                <Pressable key={media.id} onLongPress={() => Alert.alert('Remove photo?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => removeMedia.mutate(media.id) }])}>
                  <Image source={{ uri: media.url }} style={{ width: 120, height: 120, borderRadius: radius.md }} contentFit="cover" />
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <View style={{ marginTop: spacing.sm }}>
            <Button small variant="ghost" title="Add photos" onPress={() => void pickAndUploadImage('memory').then((url) => url && api.post('/memories', { celebrationYear: memory.celebrationYear, media: [{ url, kind: 'IMAGE' }] }).then(invalidate))} />
          </View>
        </Card>
      ))}
    </Screen>
  );
}
