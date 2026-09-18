import { useQuery } from '@tanstack/react-query';
import { Tabs } from 'expo-router';
import { Text } from 'react-native';
import { api } from '../../src/lib/api';
import { colors } from '../../src/theme';

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text style={{ fontSize: 22, opacity: focused ? 1 : 0.55 }}>{emoji}</Text>;
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
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border, height: 62, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600', marginBottom: 6 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ focused }) => <TabIcon emoji="🏠" focused={focused} />, tabBarBadge: unread.data?.count ? unread.data.count : undefined }} />
      <Tabs.Screen name="birthdays" options={{ title: 'Birthdays', tabBarIcon: ({ focused }) => <TabIcon emoji="🎂" focused={focused} /> }} />
      <Tabs.Screen name="gifts" options={{ title: 'Gifts', tabBarIcon: ({ focused }) => <TabIcon emoji="🎁" focused={focused} /> }} />
      <Tabs.Screen name="wishlist" options={{ title: 'Wishlist', tabBarIcon: ({ focused }) => <TabIcon emoji="💝" focused={focused} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} /> }} />
    </Tabs>
  );
}
