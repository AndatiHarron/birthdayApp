import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { Platform } from 'react-native';
import { api } from './api';
import { EAS_PROJECT_ID } from './config';

/**
 * Push notifications (spec §28). Permission is only requested when the user
 * opts in during onboarding or in settings — never silently at launch.
 */

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

let registeredToken: string | null = null;

export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Birthdays and gifts',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: '#7C3AED',
  });
}

export async function requestPushPermission(): Promise<boolean> {
  if (Platform.OS === 'web' || !Device.isDevice) return false;
  await ensureAndroidChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

/** Registers this device's Expo push token with the API if permission exists. */
export async function syncPushToken(): Promise<void> {
  if (Platform.OS === 'web' || !Device.isDevice) return;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;
  await ensureAndroidChannel();
  try {
    const token = await Notifications.getExpoPushTokenAsync(EAS_PROJECT_ID ? { projectId: EAS_PROJECT_ID } : undefined);
    if (token.data === registeredToken) return;
    await api.post('/users/me/push-tokens', { token: token.data, platform: Platform.OS === 'ios' ? 'ios' : 'android' });
    registeredToken = token.data;
  } catch (error) {
    // Missing EAS project id in development builds is the usual cause; the
    // in-app notification list still works without push.
    if (__DEV__) console.warn('Push token registration skipped:', error);
  }
}

export async function unregisterPushToken(): Promise<void> {
  if (!registeredToken) return;
  await api.delete('/users/me/push-tokens', { token: registeredToken }).catch(() => undefined);
  registeredToken = null;
}

/** Maps API deep links (`bday://orders/123`) to app routes. */
export function routeForDeepLink(link: string | null | undefined): string | null {
  if (!link) return null;
  const path = link.replace(/^[a-z]+:\/\//i, '').replace(/^\/+/, '');
  const [head, ...rest] = path.split('/');
  const id = rest.join('/');
  switch (head) {
    case 'birthdays':
      return id ? `/birthday/${id}` : '/birthdays';
    case 'group-gift':
      return `/group-gift/${id}`;
    case 'orders':
      return id ? `/order/${id}` : '/orders';
    case 'chat':
      return id ? `/chat/${id}` : '/chats';
    case 'events':
      return id ? `/event/${id}` : '/events';
    case 'profile':
      return `/person/${id}`;
    case 'wishlist':
      return rest[0] === 'user' ? `/person/${rest[1]}` : '/wishlist';
    case 'wishes':
    case 'celebration':
      return '/celebration';
    case 'gifts':
      return rest[0] === 'digital' ? `/digital-gift/${rest[1]}` : '/gift-history';
    case 'thank-yous':
      return '/gift-history';
    case 'wallet':
      return '/wallet';
    default:
      return '/notifications';
  }
}

export function listenForNotificationTaps(): () => void {
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const data = response.notification.request.content.data as { deepLink?: string } | undefined;
    const target = routeForDeepLink(data?.deepLink);
    if (target) router.push(target as never);
  });
  return () => subscription.remove();
}
