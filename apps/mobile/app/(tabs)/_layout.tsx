import { useQuery } from '@tanstack/react-query';
import { Tabs } from 'expo-router';
import type { ColorValue } from 'react-native';
import { Icon, type IconName } from '../../src/components/Icon';
import { api } from '../../src/lib/api';
import { colors } from '../../src/theme';

function tabIcon(name: IconName) {
  // Vector icons at a fixed box size: unlike emoji glyphs they never overflow
  // the tab bar, and they take the active/inactive tint from the navigator.
  return ({ color, focused }: { color: ColorValue; focused: boolean }) => <Icon name={name} size={23} color={String(color)} strokeWidth={focused ? 2.3 : 1.9} />;
}

/** Bottom navigation (spec §44): Home | Birthdays | Gifts | Wishlist | Profile. */
export default function TabsLayout() {
  const unread = useQuery({
    queryKey: ['unread-count'],
    queryFn: () => api.get<{ count: number }>('/notifications/unread-count'),
    refetchInterval: 60_000,
  });

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textFaint,
        // No fixed height: the navigator adds the device's bottom inset (home
        // indicator), which a hard-coded height cut off on newer iPhones.
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
        tabBarBadgeStyle: { backgroundColor: colors.accent, fontSize: 10 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('home'), tabBarBadge: unread.data?.count ? unread.data.count : undefined }} />
      <Tabs.Screen name="birthdays" options={{ title: 'Birthdays', tabBarIcon: tabIcon('calendar') }} />
      <Tabs.Screen name="gifts" options={{ title: 'Gifts', tabBarIcon: tabIcon('gift') }} />
      <Tabs.Screen name="wishlist" options={{ title: 'Wishlist', tabBarIcon: tabIcon('heart') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: tabIcon('user') }} />
    </Tabs>
  );
}
