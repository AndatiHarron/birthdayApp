import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Token storage. The refresh token is a long-lived credential, so on devices it
 * goes in the OS keychain/keystore via SecureStore. SecureStore does not exist
 * on web; the web build (a development convenience) falls back to AsyncStorage.
 */

const REFRESH_KEY = 'bday.refreshToken';

export async function saveRefreshToken(token: string | null): Promise<void> {
  if (Platform.OS === 'web') {
    if (token) await AsyncStorage.setItem(REFRESH_KEY, token);
    else await AsyncStorage.removeItem(REFRESH_KEY);
    return;
  }
  if (token) await SecureStore.setItemAsync(REFRESH_KEY, token);
  else await SecureStore.deleteItemAsync(REFRESH_KEY);
}

export async function loadRefreshToken(): Promise<string | null> {
  if (Platform.OS === 'web') return AsyncStorage.getItem(REFRESH_KEY);
  return SecureStore.getItemAsync(REFRESH_KEY);
}
