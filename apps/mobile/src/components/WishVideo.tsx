import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';

/**
 * A video wish. Loops silently by default (a preview) and plays with sound
 * when `active`, which is how the wish wall plays one wish at a time.
 */
export function WishVideo({
  url,
  active = true,
  muted = false,
  loop = true,
  contentFit = 'cover',
  style,
}: {
  url: string;
  active?: boolean;
  muted?: boolean;
  loop?: boolean;
  contentFit?: 'cover' | 'contain';
  style?: StyleProp<ViewStyle>;
}) {
  const player = useVideoPlayer(url, (instance) => {
    instance.loop = loop;
    instance.muted = muted;
  });

  useEffect(() => {
    player.muted = muted;
    if (active) player.play();
    else player.pause();
  }, [active, muted, player]);

  return <VideoView player={player} style={style} contentFit={contentFit} nativeControls={false} />;
}
