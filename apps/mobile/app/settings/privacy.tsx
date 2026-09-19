import type { CurrentUser, PrivacySettings, Visibility } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { Avatar, Button, Card, Chip, Divider, InlineError, Row, Screen, Section, T, Toggle } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { colors, spacing } from '../../src/theme';

function VisibilityRow({ label, value, onChange }: { label: string; value: Visibility; onChange: (value: Visibility) => void }) {
  return (
    <View style={{ paddingVertical: spacing.sm }}>
      <T variant="label" style={{ marginBottom: 6 }}>{label}</T>
      <Row wrap>
        <Chip label="🌍 Public" selected={value === 'PUBLIC'} onPress={() => onChange('PUBLIC')} />
        <Chip label="👥 Friends" selected={value === 'FRIENDS'} onPress={() => onChange('FRIENDS')} />
        <Chip label="🔒 Only me" selected={value === 'PRIVATE'} onPress={() => onChange('PRIVATE')} />
      </Row>
    </View>
  );
}

/** Privacy controls (spec §5, §39). */
export default function PrivacySettingsScreen() {
  const { user, setUser } = useAuth();
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<PrivacySettings | null>(user?.privacy ?? null);
  const blocked = useQuery({ queryKey: ['blocked'], queryFn: () => api.get<Array<{ user: { id: string; displayName: string; avatarUrl: string | null } }>>('/users/blocked') });

  useEffect(() => setSettings(user?.privacy ?? null), [user?.privacy]);
  const save = useMutation({ mutationFn: () => api.put<CurrentUser>('/users/me/privacy', settings), onSuccess: (updated) => { setUser(updated); Alert.alert('Saved'); } });
  const unblock = useMutation({ mutationFn: (id: string) => api.delete(`/users/block/${id}`), onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['blocked'] }) });

  if (!settings) return null;
  const set = <K extends keyof PrivacySettings>(key: K, value: PrivacySettings[K]) => setSettings({ ...settings, [key]: value });

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Privacy' }} />
      <InlineError error={save.error} />
      <Card>
        <VisibilityRow label="Profile" value={settings.profileVisibility} onChange={(value) => set('profileVisibility', value)} />
        <Divider />
        <VisibilityRow label="Birthday" value={settings.birthdayVisibility} onChange={(value) => set('birthdayVisibility', value)} />
        <Divider />
        <VisibilityRow label="Wishlist" value={settings.wishlistVisibility} onChange={(value) => set('wishlistVisibility', value)} />
        <Divider />
        <VisibilityRow label="Gift history" value={settings.giftHistoryVisibility} onChange={(value) => set('giftHistoryVisibility', value)} />
      </Card>
      <Section title="Age">
        <Card>
          <Toggle label="Show my age" value={settings.showAge} onChange={(value) => set('showAge', value)} />
          <Divider />
          <Toggle label="Show my birth year" value={settings.showBirthYear} onChange={(value) => set('showBirthYear', value)} />
        </Card>
      </Section>
      <Section title="Who can find me">
        <Card>
          <Toggle label="By username" value={settings.discoverableByUsername} onChange={(value) => set('discoverableByUsername', value)} />
          <Divider />
          <Toggle label="By phone number" value={settings.discoverableByPhone} onChange={(value) => set('discoverableByPhone', value)} />
          <Divider />
          <Toggle label="By email" value={settings.discoverableByEmail} onChange={(value) => set('discoverableByEmail', value)} />
        </Card>
      </Section>
      <Section title="Global birthdays">
        <Card onPress={() => router.push('/global')}>
          <Row style={{ justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <T variant="label">🌍 {settings.celebrateGlobally ? 'You’re celebrated globally' : 'Let people around the world celebrate you'}</T>
              <T variant="caption" color={colors.textMuted}>Strangers can cheer, wish and send digital gifts on your birthday. Never physical gifts. Adults only.</T>
            </View>
            <T color={colors.brand}>›</T>
          </Row>
        </Card>
      </Section>
      <Button title="Save privacy settings" loading={save.isPending} onPress={() => save.mutate()} style={{ marginTop: spacing.xl }} />
      <Section title="Blocked people">
        {blocked.data?.length === 0 ? <T color={colors.textMuted}>You haven’t blocked anyone.</T> : null}
        {blocked.data?.map((entry) => (
          <Row key={entry.user.id} gap={spacing.md} style={{ paddingVertical: spacing.sm }}>
            <Avatar name={entry.user.displayName} uri={entry.user.avatarUrl} size={36} />
            <T style={{ flex: 1 }}>{entry.user.displayName}</T>
            <Button small variant="secondary" title="Unblock" onPress={() => unblock.mutate(entry.user.id)} />
          </Row>
        ))}
      </Section>
    </Screen>
  );
}
