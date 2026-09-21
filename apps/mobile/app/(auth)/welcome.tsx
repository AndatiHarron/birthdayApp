import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Confetti } from '../../src/components/Confetti';
import { Button, IconTile, T } from '../../src/components/ui';
import { colors, gradients, spacing } from '../../src/theme';

/** Onboarding screen 1 (spec §4). */
export default function Welcome() {
  return (
    <LinearGradient colors={gradients.celebration} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1 }}>
      <Confetti count={24} />
      <SafeAreaView style={{ flex: 1, padding: spacing.xl, justifyContent: 'space-between' }}>
        <View style={{ marginTop: spacing.xxl * 2, gap: spacing.md }}>
          <IconTile name="cake" size={72} tone="onDark" />
          <T variant="display" color={colors.white} style={{ fontSize: 40, lineHeight: 46 }}>
            Celebrate the people who matter.
          </T>
          <T color="rgba(255,255,255,0.9)" style={{ fontSize: 17, lineHeight: 24 }}>
            Never forget a birthday. Never guess the perfect gift. Make every birthday memorable.
          </T>
        </View>
        <View style={{ gap: spacing.md }}>
          <View style={{ backgroundColor: colors.white, borderRadius: 999 }}>
            <Button title="Get Started" variant="ghost" onPress={() => router.push('/(auth)/sign-up')} />
          </View>
          <Button title="Sign In" variant="ghost" onPress={() => router.push('/(auth)/sign-in')} style={{ borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.7)' }} />
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}
