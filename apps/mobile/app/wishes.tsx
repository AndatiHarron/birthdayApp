import type { BirthdayMessageDto, Paginated } from '@bday/shared';
import { useQuery } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { Stack, router } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Animated, Dimensions, FlatList, Platform, Pressable, Share, View, type ViewToken } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Confetti } from '../src/components/Confetti';
import { Icon } from '../src/components/Icon';
import { VoicePlayer } from '../src/components/VoiceRecorder';
import { WishVideo } from '../src/components/WishVideo';
import { Avatar, Badge, Button, EmptyState, Loading, Row, T } from '../src/components/ui';
import { api } from '../src/lib/api';
import { colors, gradients, radius, spacing } from '../src/theme';

const REACTIONS = ['❤️', '😂', '🥹', '🎉'] as const;

/**
 * The wish wall: your birthday wishes one per screen, swiped like a story.
 * Tap to mute a video, double-tap anywhere to react, swipe up for the next.
 */
export default function WishWall() {
  const { height } = Dimensions.get('window');
  const [index, setIndex] = useState(0);
  const [muted, setMuted] = useState(false);
  const read = useRef(new Set<string>());

  const wishes = useQuery({
    queryKey: ['wishes-received'],
    queryFn: () => api.get<Paginated<BirthdayMessageDto>>('/birthday-messages/received', { limit: 50 }),
  });
  const items = wishes.data?.items ?? [];

  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index == null) return;
    setIndex(first.index);
    const wish = first.item as BirthdayMessageDto;
    // Reading is what the recipient did, so mark it as they arrive at each wish.
    if (!wish.readAt && !read.current.has(wish.id)) {
      read.current.add(wish.id);
      void api.post('/birthday-messages/read', { ids: [wish.id] }).catch(() => undefined);
    }
  }, []);

  if (wishes.isLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.text }}>
        <Loading label="Opening your wishes…" />
      </View>
    );
  }

  if (items.length === 0) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <Stack.Screen options={{ title: 'Wishes' }} />
        <EmptyState
          icon="mail"
          title="No wishes yet"
          message="When friends send birthday wishes, they play here one after another."
          action={<Button title="Back" variant="secondary" onPress={() => router.back()} />}
        />
      </SafeAreaView>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <Stack.Screen options={{ headerShown: false }} />
      <FlatList
        data={items}
        keyExtractor={(item) => item.id}
        pagingEnabled
        showsVerticalScrollIndicator={false}
        snapToInterval={height}
        snapToAlignment="start"
        decelerationRate="fast"
        getItemLayout={(_, position) => ({ length: height, offset: height * position, index: position })}
        onViewableItemsChanged={onViewable}
        viewabilityConfig={{ itemVisiblePercentThreshold: 60 }}
        renderItem={({ item, index: position }) => (
          <WishSlide wish={item} height={height} active={position === index} muted={muted} onToggleMute={() => setMuted((value) => !value)} />
        )}
      />

      <SafeAreaView style={{ position: 'absolute', top: 0, left: 0, right: 0 }} pointerEvents="box-none">
        <Row style={{ justifyContent: 'space-between', paddingHorizontal: spacing.lg }}>
          <View style={{ backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 5 }}>
            <T variant="label" color={colors.white}>
              {index + 1} / {items.length}
            </T>
          </View>
          <Pressable onPress={() => router.back()} accessibilityLabel="Close" style={{ padding: spacing.sm }}>
            <Icon name="close" size={24} color={colors.white} />
          </Pressable>
        </Row>
      </SafeAreaView>
    </View>
  );
}

function WishSlide({
  wish,
  height,
  active,
  muted,
  onToggleMute,
}: {
  wish: BirthdayMessageDto;
  height: number;
  active: boolean;
  muted: boolean;
  onToggleMute: () => void;
}) {
  const [reactions, setReactions] = useState(wish.reactions);
  const [burst, setBurst] = useState(false);
  const heart = useRef(new Animated.Value(0)).current;
  const lastTap = useRef(0);

  const react = (emoji: string) => {
    const mine = reactions.find((entry) => entry.emoji === emoji)?.mine ?? false;
    setReactions((current) => {
      const existing = current.find((entry) => entry.emoji === emoji);
      if (!existing) return [...current, { emoji, count: 1, mine: true }];
      return current.map((entry) =>
        entry.emoji === emoji ? { ...entry, mine: !mine, count: Math.max(0, entry.count + (mine ? -1 : 1)) } : entry,
      );
    });
    if (Platform.OS !== 'web') void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void (mine
      ? api.delete(`/birthday-messages/${wish.id}/reactions/${encodeURIComponent(emoji)}`)
      : api.post(`/birthday-messages/${wish.id}/reactions`, { emoji })
    ).catch(() => undefined);
  };

  /** Double-tap anywhere sends a heart, the way people already expect. */
  const onTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      lastTap.current = 0;
      if (!reactions.find((entry) => entry.emoji === '❤️')?.mine) react('❤️');
      setBurst(true);
      heart.setValue(0);
      Animated.sequence([
        Animated.spring(heart, { toValue: 1, useNativeDriver: true, friction: 4 }),
        Animated.timing(heart, { toValue: 0, duration: 450, delay: 350, useNativeDriver: true }),
      ]).start(() => setBurst(false));
      return;
    }
    lastTap.current = now;
    if (wish.kind === 'VIDEO') onToggleMute();
  };

  const senderName = wish.sender?.displayName ?? 'Someone';
  const caption = wish.body ?? wish.card?.body ?? null;

  return (
    <Pressable onPress={onTap} style={{ height, width: '100%', backgroundColor: '#000' }}>
      {/* the wish itself */}
      {wish.kind === 'VIDEO' && wish.mediaUrl ? (
        <WishVideo url={wish.mediaUrl} active={active} muted={muted} style={{ flex: 1 }} />
      ) : (wish.kind === 'IMAGE' || wish.kind === 'GIF') && wish.mediaUrl ? (
        <Image source={{ uri: wish.mediaUrl }} style={{ flex: 1 }} contentFit="cover" transition={200} />
      ) : wish.card ? (
        <LinearGradient colors={gradients.celebration} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
          {wish.card.backgroundUrl ? (
            <Image source={{ uri: wish.card.backgroundUrl }} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: 0.4 }} contentFit="cover" />
          ) : null}
          <T variant="display" center color={colors.white}>
            {wish.card.headline}
          </T>
          <T center color={colors.white} style={{ marginTop: spacing.lg, fontSize: 18, lineHeight: 26 }}>
            {wish.card.body}
          </T>
          <Row gap={spacing.sm} style={{ marginTop: spacing.xl }}>
            {wish.card.photos.map((photo) => (
              <Image key={photo.url} source={{ uri: photo.url }} style={{ width: 88, height: 88, borderRadius: radius.md }} />
            ))}
          </Row>
        </LinearGradient>
      ) : (
        <LinearGradient colors={gradients.celebration} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl }}>
          {wish.kind === 'VOICE' && wish.mediaUrl ? (
            <>
              <Avatar name={senderName} uri={wish.sender?.avatarUrl} size={110} />
              <View style={{ marginTop: spacing.xl, width: '100%' }}>
                <VoicePlayer url={wish.mediaUrl} />
              </View>
            </>
          ) : (
            <T variant="display" center color={colors.white} style={{ fontSize: 30, lineHeight: 40 }}>
              {caption ?? 'Happy birthday!'}
            </T>
          )}
        </LinearGradient>
      )}

      {/* who it is from, and the caption */}
      <LinearGradient
        colors={['transparent', 'rgba(0,0,0,0.75)']}
        style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl + spacing.lg, paddingTop: spacing.xxl }}
      >
        <Row gap={spacing.md}>
          <Avatar name={senderName} uri={wish.sender?.avatarUrl} size={40} />
          <View style={{ flex: 1 }}>
            <T variant="heading" color={colors.white}>
              {senderName}
            </T>
            {wish.fromStranger ? <Badge tone="accent" icon="globe" label="From around the world" /> : null}
          </View>
          <Pressable
            accessibilityLabel="Share this wish"
            onPress={() => void Share.share({ message: caption ? `“${caption}” — ${senderName}` : `A birthday wish from ${senderName}` })}
            style={{ padding: spacing.sm }}
          >
            <Icon name="share" size={22} color={colors.white} />
          </Pressable>
        </Row>

        {caption && (wish.kind === 'IMAGE' || wish.kind === 'GIF' || wish.kind === 'VIDEO' || wish.kind === 'VOICE') ? (
          <T color={colors.white} style={{ marginTop: spacing.md, fontSize: 16 }}>
            {caption}
          </T>
        ) : null}

        <Row gap={spacing.sm} wrap style={{ marginTop: spacing.lg }}>
          {REACTIONS.map((emoji) => {
            const entry = reactions.find((item) => item.emoji === emoji);
            return (
              <Pressable
                key={emoji}
                onPress={() => react(emoji)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                  borderRadius: radius.pill,
                  backgroundColor: entry?.mine ? colors.white : 'rgba(255,255,255,0.18)',
                }}
              >
                <T color={entry?.mine ? colors.text : colors.white}>
                  {emoji} {entry?.count ? entry.count : ''}
                </T>
              </Pressable>
            );
          })}
        </Row>
      </LinearGradient>

      {/* double-tap feedback */}
      {burst ? (
        <>
          <Confetti count={18} loop={false} />
          <Animated.Text
            style={{
              position: 'absolute',
              alignSelf: 'center',
              top: height / 2 - 60,
              fontSize: 96,
              opacity: heart,
              transform: [{ scale: heart.interpolate({ inputRange: [0, 1], outputRange: [0.4, 1.15] }) }],
            }}
          >
            ❤️
          </Animated.Text>
        </>
      ) : null}

      {wish.kind === 'VIDEO' ? (
        <View style={{ position: 'absolute', top: 64, right: spacing.lg, backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: radius.pill, padding: 8 }}>
          <Icon name={muted ? 'mute' : 'sound'} size={16} color={colors.white} />
        </View>
      ) : null}
    </Pressable>
  );
}
