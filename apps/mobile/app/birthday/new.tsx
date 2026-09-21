import { ALLOWED_REMINDER_OFFSETS_DAYS, INTEREST_CATALOG, type FriendGroupDto, type RelationshipType, type TrackedBirthdayDto } from '@bday/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { BirthdayPicker } from '../../src/components/DatePicker';
import { Avatar, Button, Card, Chip, Field, InlineError, Row, Screen, Section, T, Toggle } from '../../src/components/ui';
import { api, fieldError } from '../../src/lib/api';
import { pickAndUploadImage } from '../../src/lib/media';
import { colors, spacing } from '../../src/theme';
import { interestIcon } from '../../src/lib/icons';

const RELATIONSHIPS: Array<{ value: RelationshipType; label: string }> = [
  { value: 'FAMILY', label: 'Family' },
  { value: 'CLOSE_FRIEND', label: 'Close friend' },
  { value: 'FRIEND', label: 'Friend' },
  { value: 'PARTNER', label: 'Partner' },
  { value: 'COLLEAGUE', label: 'Colleague' },
  { value: 'OTHER', label: 'Other' },
];

/** Add or edit a birthday manually (spec §8). */
export default function BirthdayForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const queryClient = useQueryClient();
  const existing = useQuery({ queryKey: ['birthdays', 'detail', id], queryFn: () => api.get<TrackedBirthdayDto>(`/birthdays/${id}`), enabled: Boolean(id) });
  const groups = useQuery({ queryKey: ['friend-groups'], queryFn: () => api.get<FriendGroupDto[]>('/friend-groups') });

  const [name, setName] = useState('');
  const [birthday, setBirthday] = useState<{ month: number; day: number; year: number | null }>({ month: new Date().getMonth() + 1, day: 1, year: null });
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState<RelationshipType>('FRIEND');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [interests, setInterests] = useState<string[]>([]);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [isFavorite, setFavorite] = useState(false);
  const [customReminders, setCustomReminders] = useState<number[] | null>(null);

  useEffect(() => {
    const data = existing.data;
    if (!data) return;
    setName(data.name);
    setBirthday({ month: data.birthday.month, day: data.birthday.day, year: data.birthday.year });
    setPhone(data.phone ?? '');
    setEmail(data.email ?? '');
    setRelationship(data.relationship ?? 'FRIEND');
    setAvatarUrl(data.avatarUrl);
    setInterests(data.interests.map((interest) => interest.slug));
    setGroupIds(data.groups.map((group) => group.id));
    setNotes(data.notes ?? '');
    setFavorite(data.isFavorite);
    setCustomReminders(data.reminderOffsetsDays?.length ? data.reminderOffsetsDays : null);
  }, [existing.data]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        birthday: { month: birthday.month, day: birthday.day, year: birthday.year },
        phone: phone.trim() ? phone.replace(/\s/g, '') : null,
        email: email.trim() ? email.trim().toLowerCase() : null,
        relationship,
        avatarUrl,
        interests,
        groupIds,
        notes: notes.trim() || null,
        isFavorite,
        ...(customReminders ? { reminderOffsetsDays: customReminders } : id ? { reminderOffsetsDays: [] } : {}),
      };
      return id ? api.patch<TrackedBirthdayDto>(`/birthdays/${id}`, body) : api.post<TrackedBirthdayDto>('/birthdays', body);
    },
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['birthdays'] });
      void queryClient.invalidateQueries({ queryKey: ['home'] });
      router.replace(`/birthday/${saved.id}`);
    },
  });

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  return (
    <Screen>
      <Stack.Screen options={{ title: id ? 'Edit birthday' : 'Add a birthday' }} />
      <InlineError error={save.error} />
      <Row gap={spacing.lg} style={{ marginBottom: spacing.lg }}>
        <Pressable onPress={() => void pickAndUploadImage('avatar').then((url) => url && setAvatarUrl(url))}>
          <Avatar name={name || '?'} uri={avatarUrl} size={72} />
          <T variant="caption" color={colors.brand} center>
            Photo
          </T>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Field label="Name" value={name} onChangeText={setName} error={fieldError(save.error, 'name')} />
        </View>
      </Row>

      <Card>
        <BirthdayPicker value={birthday} onChange={setBirthday} />
      </Card>

      <Section title="Relationship">
        <Row wrap>
          {RELATIONSHIPS.map((option) => (
            <Chip key={option.value} label={option.label} selected={relationship === option.value} onPress={() => setRelationship(option.value)} />
          ))}
        </Row>
        {groups.data?.length ? (
          <Row wrap style={{ marginTop: spacing.md }}>
            {groups.data.map((group) => (
              <Chip key={group.id} label={group.name} selected={groupIds.includes(group.id)} onPress={() => setGroupIds(toggle(groupIds, group.id))} />
            ))}
          </Row>
        ) : null}
      </Section>

      <Section title="Contact (optional)">
        <Field label="Phone" keyboardType="phone-pad" value={phone} onChangeText={setPhone} placeholder="+254…" error={fieldError(save.error, 'phone')} />
        <Field label="Email" keyboardType="email-address" autoCapitalize="none" value={email} onChangeText={setEmail} error={fieldError(save.error, 'email')} />
      </Section>

      <Section title="Interests">
        <Row wrap>
          {INTEREST_CATALOG.map((interest) => (
            <Chip key={interest.slug} label={interest.label} icon={interestIcon(interest.slug)} selected={interests.includes(interest.slug)} onPress={() => setInterests(toggle(interests, interest.slug))} />
          ))}
        </Row>
      </Section>

      <Section title="Reminders">
        <Toggle label="Custom reminder schedule" description="Otherwise your default reminders from Settings apply." value={customReminders != null} onChange={(on) => setCustomReminders(on ? [14, 7, 1, 0] : null)} />
        {customReminders ? (
          <Row wrap>
            {ALLOWED_REMINDER_OFFSETS_DAYS.map((days) => (
              <Chip key={days} label={days === 0 ? 'On the day' : `${days} days before`} selected={customReminders.includes(days)} onPress={() => setCustomReminders(toggle(customReminders, days))} />
            ))}
          </Row>
        ) : null}
      </Section>

      <Section title="Notes">
        <Field label="Private notes" multiline value={notes} onChangeText={setNotes} placeholder="Shoe size 42, loves dark chocolate…" />
        <Toggle label="Favorite" value={isFavorite} onChange={setFavorite} />
      </Section>

      <Button title={id ? 'Save changes' : 'Add birthday'} loading={save.isPending} disabled={!name.trim()} onPress={() => save.mutate()} style={{ marginTop: spacing.xl }} />
    </Screen>
  );
}
