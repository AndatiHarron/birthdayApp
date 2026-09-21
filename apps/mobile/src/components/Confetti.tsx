import { useEffect, useMemo, useRef } from 'react';
import { Animated, Dimensions, Easing, StyleSheet, View } from 'react-native';

/**
 * Lightweight confetti for the birthday-day experience (spec §22): paper
 * strips and dots in the brand palette, built on the core Animated API so it
 * needs no native module.
 */

const COLORS = ['#4F46E5', '#6366F1', '#EA580C', '#F59E0B', '#0EA5E9', '#10B981', '#FFFFFF'];

export function Confetti({ count = 36, loop = true }: { count?: number; loop?: boolean }) {
  const { width, height } = Dimensions.get('window');
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, index) => {
        const round = index % 3 === 0;
        const size = 6 + Math.random() * 6;
        return {
          key: index,
          color: COLORS[index % COLORS.length]!,
          x: Math.random() * width,
          delay: Math.random() * 2500,
          duration: 3500 + Math.random() * 3000,
          width: size,
          length: round ? size : size * 2.2,
          round,
          drift: (Math.random() - 0.5) * 80,
          spin: Math.random() > 0.5 ? 1 : -1,
        };
      }),
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

function Piece({
  color,
  x,
  delay,
  duration,
  width,
  length,
  round,
  drift,
  spin,
  height,
  loop,
}: {
  color: string;
  x: number;
  delay: number;
  duration: number;
  width: number;
  length: number;
  round: boolean;
  drift: number;
  spin: number;
  height: number;
  loop: boolean;
}) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, { toValue: 1, duration, delay, easing: Easing.linear, useNativeDriver: true });
    const run = loop ? Animated.loop(animation) : animation;
    run.start();
    return () => run.stop();
  }, [progress, duration, delay, loop]);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: x,
        top: -30,
        width,
        height: length,
        borderRadius: round ? width / 2 : 2,
        backgroundColor: color,
        opacity: 0.9,
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [0, height + 60] }) },
          { translateX: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0, drift, 0] }) },
          { rotate: progress.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${spin * 540}deg`] }) },
        ],
      }}
    />
  );
}
