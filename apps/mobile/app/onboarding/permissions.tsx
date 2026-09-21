import type { CurrentUser } from '@bday/shared';
import * as Calendar from 'expo-calendar';
import * as Contacts from 'expo-contacts';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, View } from 'react-native';
import { Button, Card, type IconName, IconTile, InlineError, Row, Screen, T } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { requestPushPermission, syncPushToken } from '../../src/lib/push';
import { colors, spacing } from '../../src/theme';
import { onboardingDraft } from '../../src/lib/onboardingDraft';

type PermissionKey = 'notifications' | 'contacts' | 'calendar';

const EXPLANATIONS: Record<PermissionKey, { icon: IconName; title: string; body: string }> = {
  notifications: { icon: 'bell' as IconName, title: 'Birthday reminders', body: 'A heads-up 30, 14 and 7 days before — and on the morning itself. You choose the schedule.' },
  contacts: { icon: 'contacts' as IconName, title: 'Find birthdays in contacts', body: 'Import birthdays you already have. Nothing is uploaded until you pick who to add.' },
  calendar: { icon: 'calendar' as IconName, title: 'Add to your calendar', body: 'Put birthdays and party invites in your phone’s calendar.' },
};

/** Onboarding screen 4 (spec §4): every permission optional and explained. */
export default function OnboardingPermissions() {
  const { setUser } = useAuth();
  const [granted, setGranted] = useState<Record<PermissionKey, boolean>>({ notifications: false, contacts: false, calendar: false });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function ask(key: PermissionKey) {
    let ok = false;
    if (key === 'notifications') ok = await requestPushPermission();
    if (key === 'contacts' && Platform.OS !== 'web') ok = (await Contacts.requestPermissionsAsync()).status === 'granted';
    if (key === 'calendar' && Platform.OS !== 'web') ok = (await Calendar.requestCalendarPermissionsAsync()).status === 'granted';
    setGranted((current) => ({ ...current, [key]: ok }));
  }

  async function finish() {
    if (!onboardingDraft.birthday) {
      router.replace('/onboarding/birthday');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await api.post<CurrentUser>('/users/me/onboarding', {
        birthday: onboardingDraft.birthday,
        showBirthYear: onboardingDraft.showBirthYear,
        interests: onboardingDraft.interests,
        permissionsGranted: granted,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
      if (granted.notifications) void syncPushToken();
      setUser(user);
      router.replace(granted.contacts ? '/contacts-import' : '/(tabs)');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <T variant="caption" color={colors.brand}>
        STEP 3 OF 3
      </T>
      <T variant="display" style={{ marginVertical: spacing.sm }}>
        Never miss a moment
      </T>
      <T color={colors.textMuted} style={{ marginBottom: spacing.xl }}>
        All optional. You can change these any time in Settings.
      </T>
      <InlineError error={error} />
      {(Object.keys(EXPLANATIONS) as PermissionKey[]).map((key) => (
        <Card key={key} style={{ marginBottom: spacing.md }}>
          <Row gap={spacing.md} style={{ alignItems: 'flex-start' }}>
            <IconTile name={EXPLANATIONS[key].icon} size={40} />
            <View style={{ flex: 1 }}>
              <T variant="heading">{EXPLANATIONS[key].title}</T>
              <T color={colors.textMuted} style={{ marginVertical: 4 }}>
                {EXPLANATIONS[key].body}
              </T>
              {granted[key] ? (
                <T variant="label" color={colors.success}>
                  ✓ Allowed
                </T>
              ) : (
                <Button small variant="secondary" title="Allow" onPress={() => void ask(key)} style={{ alignSelf: 'flex-start', marginTop: 4 }} />
              )}
            </View>
          </Row>
        </Card>
      ))}
      <Button title="Finish" loading={busy} onPress={finish} style={{ marginTop: spacing.lg }} />
    </Screen>
  );
}
