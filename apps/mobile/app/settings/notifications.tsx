import { ALLOWED_REMINDER_OFFSETS_DAYS, type CurrentUser, type NotificationType } from '@bday/shared';
import { useMutation } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Button, Card, Chip, Divider, InlineError, Row, Screen, Section, T, Toggle } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { requestPushPermission, syncPushToken } from '../../src/lib/push';
import { colors, spacing } from '../../src/theme';

const TYPES: Array<{ type: NotificationType; label: string }> = [
  { type: 'BIRTHDAY_REMINDER', label: '🎂 Birthday reminders' },
  { type: 'WISHLIST_UPDATED', label: '💝 Wishlist updates' },
  { type: 'GROUP_GIFT_CONTRIBUTION', label: '👥 Group gift contributions' },
  { type: 'BIRTHDAY_WISH_RECEIVED', label: '💌 Birthday wishes' },
  { type: 'FRIEND_REQUEST', label: '👫 Friend requests' },
  { type: 'CHAT_MESSAGE', label: '💬 Chat messages' },
  { type: 'DELIVERY_UPDATE', label: '🚚 Delivery updates' },
  { type: 'EVENT_INVITE', label: '🎉 Event invites' },
];

/** Reminder schedule, channels, muted types and quiet hours (spec §21, §58 rule 7). */
export default function NotificationSettings() {
  const { user, setUser } = useAuth();
  const prefs = user?.notificationPreferences;
  const [offsets, setOffsets] = useState<number[]>([]);
  const [push, setPush] = useState(true);
  const [email, setEmail] = useState(true);
  const [sms, setSms] = useState(false);
  const [muted, setMuted] = useState<NotificationType[]>([]);
  const [quiet, setQuiet] = useState(false);

  useEffect(() => {
    if (!prefs) return;
    setOffsets(prefs.reminderOffsetsDays);
    setPush(prefs.channels.push);
    setEmail(prefs.channels.email);
    setSms(prefs.channels.sms);
    setMuted(prefs.mutedTypes);
    setQuiet(prefs.quietHoursStart != null);
  }, [prefs]);

  const save = useMutation({
    mutationFn: () =>
      api.put<CurrentUser>('/users/me/notification-preferences', {
        reminderOffsetsDays: offsets,
        channels: { push, email, sms },
        mutedTypes: muted,
        quietHoursStart: quiet ? 22 : null,
        quietHoursEnd: quiet ? 7 : null,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    onSuccess: setUser,
  });

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Reminders & notifications' }} />
      <InlineError error={save.error} />
      <Section title="🎂 When to remind me" style={{ marginTop: 0 }}>
        <T color={colors.textMuted} style={{ marginBottom: spacing.md }}>Default for everyone. You can override it per person.</T>
        <Row wrap>
          {ALLOWED_REMINDER_OFFSETS_DAYS.map((days) => (
            <Chip key={days} label={days === 0 ? 'Birthday morning' : `${days} days before`} selected={offsets.includes(days)} onPress={() => setOffsets(offsets.includes(days) ? offsets.filter((value) => value !== days) : [...offsets, days])} />
          ))}
        </Row>
      </Section>
      <Section title="Channels">
        <Card>
          <Toggle label="Push notifications" value={push} onChange={(value) => { setPush(value); if (value) void requestPushPermission().then(async (ok) => { if (ok) await syncPushToken(); }); }} />
          <Divider />
          <Toggle label="Email" value={email} onChange={setEmail} />
          <Divider />
          <Toggle label="SMS" description="For important updates only." value={sms} onChange={setSms} />
          <Divider />
          <Toggle label="Quiet hours" description="No push between 10pm and 7am." value={quiet} onChange={setQuiet} />
        </Card>
      </Section>
      <Section title="What to notify me about">
        <Card>
          {TYPES.map((item) => (
            <Toggle key={item.type} label={item.label} value={!muted.includes(item.type)} onChange={(on) => setMuted(on ? muted.filter((type) => type !== item.type) : [...muted, item.type])} />
          ))}
        </Card>
      </Section>
      <Button title="Save" loading={save.isPending} onPress={() => save.mutate()} style={{ marginTop: spacing.xl }} />
    </Screen>
  );
}
