import { useEffect, useMemo, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';

/**
 * Lightweight confetti and balloons for the birthday-day experience (spec §22),
 * built on the core Animated API so it needs no native module.
 */

const PIECES = ['🎉', '🎊', '🎈', '✨', '🎂', '🎁', '💜', '⭐'];

export function Confetti({ count = 36, loop = true }: { count?: number; loop?: boolean }) {
  const { width, height } = Dimensions.get('window');
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, index) => ({
        key: index,
        emoji: PIECES[index % PIECES.length]!,
        x: Math.random() * width,
        delay: Math.random() * 2500,
        duration: 3500 + Math.random() * 3000,
        size: 16 + Math.random() * 18,
        drift: (Math.random() - 0.5) * 80,
        spin: Math.random() > 0.5 ? 1 : -1,
      })),
    [count, width],
  );

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map(({ key, ...piece }) => (
        <Piece key={key} {...piece} height={height} loop={loop} />
      ))}
    </View>
  );
}

function Piece({ emoji, x, delay, duration, size, drift, spin, height, loop }: { emoji: string; x: number; delay: number; duration: number; size: number; drift: number; spin: number; height: number; loop: boolean }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, { toValue: 1, duration, delay, easing: Easing.linear, useNativeDriver: true });
    const run = loop ? Animated.loop(animation) : animation;
    run.start();
    return () => run.stop();
  }, [progress, duration, delay, loop]);

  return (
    <Animated.Text
      style={{
        position: 'absolute',
        left: x,
        top: -40,
        fontSize: size,
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, height + 80] }) },
          { translateX: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, drift, 0] }) },
          { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${spin * 360}deg`] }) },
        ],
      }}
    >
      {emoji}
    </Animated.Text>
  );
}
