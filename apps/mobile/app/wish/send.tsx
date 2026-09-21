import { CARD_TEMPLATE_META, type CardTemplateDto } from '@bday/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { VoiceRecorder } from '../../src/components/VoiceRecorder';
import { WishVideo } from '../../src/components/WishVideo';
import { Avatar, Button, Card, Chip, EmptyState, Field, InlineError, Loading, Row, Screen, Section, T, Toggle } from '../../src/components/ui';
import { api, fieldError } from '../../src/lib/api';
import { pickAndUploadImage, pickAndUploadWishMedia, type PickedMedia } from '../../src/lib/media';
import { useRecipient } from '../../src/lib/recipient';
import { colors, radius, spacing } from '../../src/theme';

type Kind = 'TEXT' | 'CARD' | 'IMAGE' | 'GIF' | 'VIDEO' | 'VOICE';

/** Birthday wishes and personalised cards (spec §23, §24). */
export default function SendWish() {
  const params = useLocalSearchParams<{ userId?: string; birthdayId?: string; name?: string }>();
  const { recipient, isLoading } = useRecipient(params);
  const templates = useQuery({ queryKey: ['card-templates'], queryFn: () => api.get<CardTemplateDto[]>('/cards/templates') });

  const [kind, setKind] = useState<Kind>('CARD');
  const [body, setBody] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [headline, setHeadline] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [mediaUrl, setMediaUrl] = useState<string | null>(null);
  const [media, setMedia] = useState<PickedMedia | null>(null);
  const [voice, setVoice] = useState<{ url: string; durationSeconds: number } | null>(null);
  const [anonymous, setAnonymous] = useState(false);

  const template = templates.data?.find((item) => item.id === templateId) ?? null;

  const send = useMutation({
    mutationFn: () => {
      const target = recipient?.birthdayId ? { trackedBirthdayId: recipient.birthdayId } : { recipientUserId: recipient?.userId };
      return api.post('/birthday-messages', {
        ...target,
        kind,
        body: body.trim() || null,
        mediaUrl: kind === 'IMAGE' ? mediaUrl : kind === 'GIF' || kind === 'VIDEO' ? media?.url : kind === 'VOICE' ? voice?.url : null,
        durationSeconds: kind === 'VOICE' ? voice?.durationSeconds : kind === 'VIDEO' ? media?.durationSeconds : null,
        isAnonymous: anonymous,
        card:
          kind === 'CARD' && template
            ? {
                templateId: template.id,
                style: template.style,
                backgroundUrl: template.backgroundUrl,
                backgroundColor: template.backgroundColor,
                headline: headline.trim() || template.defaultHeadline,
                body: body.trim() || template.defaultBody,
                photos: photos.map((url, index) => ({ url, x: 0.1 + index * 0.3, y: 0.62, scale: 0.28, rotation: index % 2 ? 6 : -6 })),
              }
            : undefined,
      });
    },
    onSuccess: () => {
      Alert.alert('Sent!', `${recipient?.name.split(' ')[0]} will love it.`);
      router.back();
    },
  });

  if (isLoading) return <Loading />;
  if (!recipient) return <EmptyState icon="help" title="Choose who to wish" />;
  if (!recipient.userId) {
    return (
      <Screen>
        <EmptyState icon="send" title={`${recipient.name} isn’t on the app yet`} message="Invite them so they can receive wishes and gifts." action={<Button title="Invite" onPress={() => router.replace({ pathname: '/invite', params: { birthdayId: recipient.birthdayId ?? '' } })} />} />
      </Screen>
    );
  }

  const ready = kind === 'CARD' ? Boolean(template) : kind === 'IMAGE' ? Boolean(mediaUrl) : kind === 'VOICE' ? Boolean(voice) : body.trim().length > 0;

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Send a wish' }} />
      <Row gap={spacing.md} style={{ marginBottom: spacing.lg }}>
        <Avatar name={recipient.name} uri={recipient.avatarUrl} />
        <T variant="heading">To {recipient.name}</T>
      </Row>
      <Row wrap>
        <Chip icon="mail" label="Card" selected={kind === 'CARD'} onPress={() => setKind('CARD')} />
        <Chip icon="edit" label="Message" selected={kind === 'TEXT'} onPress={() => setKind('TEXT')} />
        <Chip icon="camera" label="Photo" selected={kind === 'IMAGE'} onPress={() => setKind('IMAGE')} />
        <Chip icon="video" label="Video" selected={kind === 'VIDEO'} onPress={() => setKind('VIDEO')} />
        <Chip icon="sparkles" label="GIF" selected={kind === 'GIF'} onPress={() => setKind('GIF')} />
        <Chip icon="mic" label="Voice" selected={kind === 'VOICE'} onPress={() => setKind('VOICE')} />
      </Row>
      <InlineError error={send.error} />

      {kind === 'CARD' ? (
        <Section title="Pick a design">
          {templates.isLoading ? <Loading /> : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: spacing.md }}>
            {templates.data?.map((item) => (
              <Pressable key={item.id} onPress={() => { setTemplateId(item.id); setHeadline(item.defaultHeadline ?? ''); setBody(item.defaultBody ?? ''); }} style={{ width: 110 }}>
                <View style={{ height: 150, borderRadius: radius.md, overflow: 'hidden', borderWidth: 3, borderColor: templateId === item.id ? colors.brand : 'transparent', backgroundColor: item.backgroundColor ?? colors.surfaceMuted }}>
                  <Image source={{ uri: item.previewUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
                </View>
                <T variant="caption" center style={{ marginTop: 4 }}>
                  {item.isPremium ? '' : ''}
                  {CARD_TEMPLATE_META[item.style].label}
                </T>
              </Pressable>
            ))}
          </ScrollView>
          {template ? (
            <Card style={{ marginTop: spacing.lg, backgroundColor: template.backgroundColor ?? colors.surface, alignItems: 'center', paddingVertical: spacing.xxl }}>
              <T variant="title" center color={template.style === 'ELEGANT' ? '#F5D48A' : colors.text}>
                {headline || template.defaultHeadline}
              </T>
              <T center style={{ marginTop: spacing.sm }} color={template.style === 'ELEGANT' ? '#F5D48A' : colors.text}>
                {body || template.defaultBody}
              </T>
              <Row style={{ marginTop: spacing.md }}>
                {photos.map((url) => (
                  <Image key={url} source={{ uri: url }} style={{ width: 70, height: 70, borderRadius: 8 }} />
                ))}
              </Row>
            </Card>
          ) : null}
          {template ? (
            <>
              <Field label="Headline" value={headline} onChangeText={setHeadline} style={{ marginTop: spacing.md }} />
              <Field label="Message" multiline value={body} onChangeText={setBody} error={fieldError(send.error, 'body')} />
              <Button small variant="secondary" icon="image" title="Add a photo" disabled={photos.length >= 3} onPress={() => void pickAndUploadImage('card').then((url) => url && setPhotos([...photos, url]))} />
            </>
          ) : null}
        </Section>
      ) : null}

      {kind === 'TEXT' ? <Field label="Your message" multiline value={body} onChangeText={setBody} placeholder="Happy birthday!" style={{ marginTop: spacing.lg }} /> : null}

      {kind === 'IMAGE' ? (
        <View style={{ marginTop: spacing.lg }}>
          <Pressable onPress={() => void pickAndUploadImage('card').then((url) => url && setMediaUrl(url))} style={{ height: 220, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
            {mediaUrl ? <Image source={{ uri: mediaUrl }} style={{ width: '100%', height: '100%' }} contentFit="cover" /> : <T color={colors.textMuted}>Choose a photo</T>}
          </Pressable>
          <Field label="Caption" value={body} onChangeText={setBody} style={{ marginTop: spacing.md }} />
        </View>
      ) : null}

      {kind === 'VIDEO' || kind === 'GIF' ? (
        <View style={{ marginTop: spacing.lg }}>
          <View style={{ height: 240, borderRadius: radius.lg, backgroundColor: colors.surfaceMuted, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' }}>
            {media ? (
              media.kind === 'VIDEO' ? (
                <WishVideo url={media.url} style={{ width: '100%', height: '100%' }} />
              ) : (
                <Image source={{ uri: media.url }} style={{ width: '100%', height: '100%' }} contentFit="cover" />
              )
            ) : (
              <T color={colors.textMuted}>{kind === 'VIDEO' ? 'Record or choose a video (up to 60s)' : 'Choose a GIF from your photos'}</T>
            )}
          </View>
          <Row gap={spacing.sm} style={{ marginTop: spacing.md }}>
            {kind === 'VIDEO' ? (
              <Button
                small
                icon="camera"
                title="Record"
                variant="secondary"
                onPress={() => void pickAndUploadWishMedia({ video: true, camera: true }).then((picked) => picked && setMedia(picked))}
                style={{ flex: 1 }}
              />
            ) : null}
            <Button
              small
              icon="image"
              title={kind === 'VIDEO' ? 'Choose a video' : 'Choose a GIF'}
              variant="secondary"
              onPress={() => void pickAndUploadWishMedia({ video: kind === 'VIDEO' }).then((picked) => picked && setMedia(picked))}
              style={{ flex: 1 }}
            />
          </Row>
          <Field label="Caption (optional)" value={body} onChangeText={setBody} style={{ marginTop: spacing.md }} />
        </View>
      ) : null}

      {kind === 'VOICE' ? (
        <View style={{ marginTop: spacing.lg }}>
          <VoiceRecorder onRecorded={setVoice} />
          <Field label="Add a note (optional)" value={body} onChangeText={setBody} style={{ marginTop: spacing.md }} />
        </View>
      ) : null}

      <View style={{ marginTop: spacing.lg }}>
        <Toggle label="Send anonymously" value={anonymous} onChange={setAnonymous} />
      </View>
      <Button title="Send wish" icon="mail" loading={send.isPending} disabled={!ready} onPress={() => send.mutate()} style={{ marginTop: spacing.md }} />
    </Screen>
  );
}
