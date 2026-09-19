import type { BirthdayMessageDto, CurrentUser, DigitalGiftDto, GlobalStatusDto, Paginated } from '@bday/shared';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { useEffect } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Confetti } from '../src/components/Confetti';
import { VoicePlayer } from '../src/components/VoiceRecorder';
import { Avatar, Button, Card, Row, T } from '../src/components/ui';
import { api, errorMessage } from '../src/lib/api';
import { useAuth } from '../src/lib/auth';
import { colors, gradients, radius, spacing } from '../src/theme';

/** The birthday-day experience (spec §22): confetti, wishes, gifts, surprises. */
export default function Celebration() {
  const { user } = useAuth();
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get<CurrentUser>('/users/me') });
  const today = useQuery({ queryKey: ['my-birthday-today'], queryFn: () => api.get<{ wishCount: number; giftCount: number; hasSurprise: boolean } | null>('/birthdays/today/me') });
  const wishes = useQuery({ queryKey: ['wishes-received'], queryFn: () => api.get<Paginated<BirthdayMessageDto>>('/birthday-messages/received', { limit: 50 }) });
  const gifts = useQuery({ queryKey: ['digital-received'], queryFn: () => api.get<DigitalGiftDto[]>('/digital-gifts/received') });
  const global = useQuery({ queryKey: ['global', 'me'], queryFn: () => api.get<GlobalStatusDto>('/global/me') });
  const knowThem = useMutation({
    mutationFn: (userId: string) => api.post('/friends/request', { userId }),
    onSuccess: () => Alert.alert('Request sent', 'Once they accept, you’re connected, and they can send you physical gifts too.'),
    onError: (error) => Alert.alert('Could not connect', errorMessage(error)),
  });

  useEffect(() => {
    if (wishes.data?.items.some((wish) => !wish.readAt)) void api.post('/birthday-messages/read', { all: true }).catch(() => undefined);
  }, [wishes.data]);

  const isToday = me.data?.birthday?.countdown.isToday ?? false;
  const firstName = (me.data?.displayName ?? user?.displayName ?? '').split(' ')[0]?.toUpperCase();
  const unopened = gifts.data?.filter((gift) => !gift.openedAt) ?? [];

  return (
    <LinearGradient colors={gradients.celebration} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
      {isToday ? <Confetti /> : null}
      <SafeAreaView style={{ flex: 1 }}>
        <Row style={{ justifyContent: 'flex-end', paddingHorizontal: spacing.lg }}>
          <Pressable onPress={() => router.back()} accessibilityLabel="Close" style={{ padding: spacing.sm }}>
            <T variant="title" color={colors.white}>✕</T>
          </Pressable>
        </Row>
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: spacing.xxl * 2 }}>
          <View style={{ alignItems: 'center', marginVertical: spacing.xl }}>
            <T style={{ fontSize: 72 }}>🎂🎈🎉</T>
            <T variant="display" color={colors.white} center style={{ marginTop: spacing.md }}>
              {isToday ? `HAPPY BIRTHDAY, ${firstName}!` : 'Your birthday wishes'}
            </T>
            {today.data ? (
              <View style={{ marginTop: spacing.lg, gap: 6 }}>
                <T color={colors.white} center style={{ fontSize: 17 }}>You have received {today.data.wishCount} birthday wishes.</T>
                <T color={colors.white} center style={{ fontSize: 17 }}>You have {today.data.giftCount} gifts waiting.</T>
                {today.data.hasSurprise ? <T color={colors.white} center style={{ fontSize: 17 }}>✨ Your friends have something special planned.</T> : null}
                {global.data && global.data.cheersReceived > 0 ? (
                  <T color={colors.white} center style={{ fontSize: 17 }}>
                    🌍 {global.data.cheersReceived} {global.data.cheersReceived === 1 ? 'person' : 'people'} around the world celebrated you.
                  </T>
                ) : null}
              </View>
            ) : null}
          </View>

          {unopened.length > 0 ? (
            <Card style={{ marginBottom: spacing.lg }}>
              <T variant="heading">🎁 Gifts to unwrap</T>
              {unopened.map((gift) => (
                <Row key={gift.id} style={{ justifyContent: 'space-between', paddingVertical: spacing.sm }}>
                  <T>{gift.sender ? `From ${gift.sender.displayName}` : 'A secret admirer'}</T>
                  <Button small title="Open" onPress={() => router.push(`/digital-gift/${gift.id}`)} />
                </Row>
              ))}
            </Card>
          ) : null}

          <T variant="heading" color={colors.white} style={{ marginBottom: spacing.md }}>
            💌 Wishes
          </T>
          {wishes.data?.items.length === 0 ? <T color={colors.white}>Wishes will appear here as friends send them.</T> : null}
          {wishes.data?.items.map((wish) => (
            <Card key={wish.id} style={{ marginBottom: spacing.md }}>
              <Row gap={spacing.md} style={{ marginBottom: spacing.sm }}>
                <Avatar name={wish.sender?.displayName ?? '🤫'} uri={wish.sender?.avatarUrl} size={36} />
                <View style={{ flex: 1 }}>
                  <T variant="label">{wish.sender?.displayName ?? 'Someone special'}</T>
                  {wish.fromStranger ? <T variant="caption" color={colors.textMuted}>🌍 Celebrating you from around the world</T> : null}
                </View>
              </Row>
              {wish.card ? (
                <View style={{ borderRadius: radius.lg, padding: spacing.xl, backgroundColor: wish.card.backgroundColor ?? colors.brandSoft, alignItems: 'center', overflow: 'hidden' }}>
                  {wish.card.backgroundUrl ? <Image source={{ uri: wish.card.backgroundUrl }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.35 }} contentFit="cover" /> : null}
                  <T variant="title" center color={wish.card.style === 'ELEGANT' ? '#F5D48A' : colors.text}>{wish.card.headline}</T>
                  <T center style={{ marginTop: spacing.sm }} color={wish.card.style === 'ELEGANT' ? '#F5D48A' : colors.text}>{wish.card.body}</T>
                  <Row style={{ marginTop: spacing.md }}>
                    {wish.card.photos.map((photo) => (
                      <Image key={photo.url} source={{ uri: photo.url }} style={{ width: 72, height: 72, borderRadius: 8 }} />
                    ))}
                  </Row>
                </View>
              ) : null}
              {wish.kind === 'IMAGE' && wish.mediaUrl ? <Image source={{ uri: wish.mediaUrl }} style={{ width: '100%', height: 220, borderRadius: radius.md }} contentFit="cover" /> : null}
              {wish.kind === 'VOICE' && wish.mediaUrl ? <VoicePlayer url={wish.mediaUrl} /> : null}
              {wish.body && !wish.card ? <T style={{ marginTop: spacing.sm }}>{wish.body}</T> : null}
              <Row wrap style={{ marginTop: spacing.sm }}>
                {['❤️', '😂', '🥹', '🎉'].map((emoji) => {
                  const reaction = wish.reactions.find((entry) => entry.emoji === emoji);
                  return (
                    <Pressable
                      key={emoji}
                      onPress={() => void (reaction?.mine ? api.delete(`/birthday-messages/${wish.id}/reactions/${encodeURIComponent(emoji)}`) : api.post(`/birthday-messages/${wish.id}/reactions`, { emoji })).then(() => wishes.refetch())}
                      style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: reaction?.mine ? colors.brandSoft : colors.surfaceMuted }}
                    >
                      <T>{emoji} {reaction?.count ?? ''}</T>
                    </Pressable>
                  );
                })}
              </Row>
              {wish.fromStranger && wish.sender ? (
                <Row gap={spacing.sm} style={{ marginTop: spacing.sm }}>
                  <Button small variant="secondary" icon="🤝" title="I know them" loading={knowThem.isPending && knowThem.variables === wish.sender.id} onPress={() => knowThem.mutate(wish.sender!.id)} />
                  <Button small variant="ghost" title="Report" onPress={() => router.push({ pathname: '/report', params: { targetType: 'USER', targetId: wish.sender!.id } })} />
                </Row>
              ) : null}
            </Card>
          ))}
        </ScrollView>
      </SafeAreaView>
    </LinearGradient>
  );
}
