import { Stack, router, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/lib/auth';
import { listenForNotificationTaps, syncPushToken } from '../src/lib/push';
import { QueryProvider } from '../src/lib/query';
import { connectRealtime, disconnectRealtime } from '../src/lib/realtime';
import { colors } from '../src/theme';

function Gate() {
  const { status, needsOnboarding } = useAuth();
  const segments = useSegments();

  useEffect(() => {
    if (status === 'loading') return;
    const group = segments[0];
    const inAuth = group === '(auth)';
    const inOnboarding = group === 'onboarding';
    // Public screens reachable from shared links without an account.
    const isPublic = group === 'wishlist-share' || group === 'invite';

    if (status === 'signed-out' && !inAuth && !isPublic) router.replace('/(auth)/welcome');
    else if (status === 'signed-in' && needsOnboarding && !inOnboarding) router.replace('/onboarding/birthday');
    else if (status === 'signed-in' && !needsOnboarding && (inAuth || inOnboarding)) router.replace('/(tabs)');
  }, [status, needsOnboarding, segments]);

  useEffect(() => {
    if (status !== 'signed-in') {
      disconnectRealtime();
      return;
    }
    connectRealtime();
    void syncPushToken();
    return listenForNotificationTaps();
  }, [status]);

  return (
    <Stack
      screenOptions={{
        headerTintColor: colors.brand,
        headerTitleStyle: { color: colors.text, fontWeight: '700' },
        headerShadowVisible: false,
        headerStyle: { backgroundColor: colors.bg },
        contentStyle: { backgroundColor: colors.bg },
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      <Stack.Screen name="celebration" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
    </Stack>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <QueryProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <Gate />
        </AuthProvider>
      </QueryProvider>
    </SafeAreaProvider>
  );
}
