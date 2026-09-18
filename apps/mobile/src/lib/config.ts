import Constants from 'expo-constants';
import { Platform } from 'react-native';

function resolveApiUrl(): string {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  const fromConfig = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;
  let url = (fromEnv || fromConfig || 'http://localhost:4000').replace(/\/$/, '');
  // The Android emulator reaches the host machine on 10.0.2.2, not localhost.
  if (__DEV__ && Platform.OS === 'android' && /localhost|127\.0\.0\.1/.test(url) && !Constants.isDevice) {
    url = url.replace(/localhost|127\.0\.0\.1/, '10.0.2.2');
  }
  return url;
}

export const API_URL = resolveApiUrl();
export const WEB_URL = (process.env.EXPO_PUBLIC_WEB_URL ?? API_URL).replace(/\/$/, '');
export const EAS_PROJECT_ID = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId || undefined;
