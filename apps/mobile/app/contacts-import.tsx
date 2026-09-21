import type { ContactImportCandidate, RelationshipType } from '@bday/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Contact, ContactField, requestPermissionsAsync } from 'expo-contacts';
import { Stack, router } from 'expo-router';
import { useState } from 'react';
import { Alert, Platform, Pressable, View } from 'react-native';
import { MONTHS } from '../src/components/DatePicker';
import { Avatar, Badge, Button, Card, EmptyState, Icon, InlineError, Loading, Row, Screen, T } from '../src/components/ui';
import { api, errorMessage } from '../src/lib/api';
import { colors, spacing } from '../src/theme';

const FIELDS = [ContactField.FULL_NAME, ContactField.PHONES, ContactField.EMAILS, ContactField.BIRTHDAY] as const;

function normalisePhone(raw: string | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, '');
  // Kenyan local formats (07…, 01…) become +254…; other numbers need a +.
  if (/^0[17]\d{8}$/.test(digits)) digits = `+254${digits.slice(1)}`;
  if (/^254\d{9}$/.test(digits)) digits = `+${digits}`;
  return /^\+[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

function stableId(name: string, phone: string | null, email: string | null): string {
  const source = `${name}|${phone ?? ''}|${email ?? ''}`;
  let hash = 0;
  for (let index = 0; index < source.length; index += 1) hash = (hash * 31 + source.charCodeAt(index)) | 0;
  return `c${Math.abs(hash).toString(36)}${source.length}`;
}

/**
 * Import birthdays from the phone's contacts (spec §8). Only name, phone,
 * email and birthday leave the device — and only for the contacts the user
 * picks on the confirm step.
 */
export default function ContactsImport() {
  const queryClient = useQueryClient();
  const [candidates, setCandidates] = useState<ContactImportCandidate[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function scan() {
    if (Platform.OS === 'web') {
      Alert.alert('Contacts import needs the mobile app');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const permission = await requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Contacts access needed', 'Allow contacts access in Settings to import birthdays.');
        return;
      }
      const details = await Contact.getAllDetails(FIELDS, { limit: 2000 });
      const contacts = details
        .map((contact) => {
          const name = (contact.fullName ?? '').trim();
          const phone = normalisePhone(contact.phones?.[0]?.number);
          const email = contact.emails?.[0]?.address?.trim().toLowerCase() || null;
          const birthday = contact.birthday?.month && contact.birthday.day ? { month: contact.birthday.month, day: contact.birthday.day, year: contact.birthday.year ?? null } : null;
          return name ? { externalId: stableId(name, phone, email), name: name.slice(0, 60), phone, email, birthday } : null;
        })
        .filter((contact): contact is NonNullable<typeof contact> => contact !== null && (contact.birthday != null || contact.phone != null))
        .slice(0, 1000);

      if (contacts.length === 0) {
        setCandidates([]);
        return;
      }
      const preview = await api.post<ContactImportCandidate[]>('/birthdays/import/preview', { contacts });
      const importable = preview.filter((candidate) => !candidate.alreadyTracked);
      setCandidates(importable);
      setSelected(new Set(importable.filter((candidate) => candidate.birthday).map((candidate) => candidate.externalId)));
    } catch (caught) {
      setError(caught);
    } finally {
      setLoading(false);
    }
  }

  const confirm = useMutation({
    mutationFn: () =>
      api.post<{ imported: number; skipped: number }>('/birthdays/import/confirm', {
        selections: (candidates ?? [])
          .filter((candidate) => selected.has(candidate.externalId) && candidate.birthday)
          .map((candidate) => ({
            externalId: candidate.externalId,
            name: candidate.name,
            birthday: candidate.birthday!,
            phone: candidate.phone,
            email: candidate.email,
            relationship: 'FRIEND' as RelationshipType,
          })),
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['birthdays'] });
      void queryClient.invalidateQueries({ queryKey: ['home'] });
      Alert.alert('Imported', `${result.imported} birthdays added to your calendar.`);
      router.replace('/(tabs)/birthdays');
    },
    onError: (caught) => Alert.alert('Import failed', errorMessage(caught)),
  });

  const withBirthday = candidates?.filter((candidate) => candidate.birthday) ?? [];
  const onApp = candidates?.filter((candidate) => candidate.matchedUser) ?? [];

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Import from contacts' }} />
      {!candidates ? (
        <>
          <EmptyState icon="contacts" title="Find birthdays you already have" message="We’ll look for birthdays and friends already on the app. Nothing is saved until you choose." />
          <InlineError error={error} />
          {loading ? <Loading label="Reading contacts…" /> : <Button title="Scan my contacts" onPress={() => void scan()} />}
          <Button variant="ghost" title="Skip" onPress={() => router.replace('/(tabs)')} style={{ marginTop: spacing.md }} />
        </>
      ) : candidates.length === 0 ? (
        <EmptyState icon="help" title="No new birthdays found" message="Add birthdays manually or invite friends instead." action={<Button title="Done" onPress={() => router.replace('/(tabs)')} />} />
      ) : (
        <>
          {onApp.length ? (
            <Card style={{ marginBottom: spacing.md, backgroundColor: colors.brandSoft, borderColor: colors.brandSoft }}>
              <T variant="label" color={colors.brandDark}>{onApp.length} of your contacts are already on the app</T>
            </Card>
          ) : null}
          <T variant="heading" style={{ marginBottom: spacing.sm }}>{withBirthday.length} with birthdays</T>
          {withBirthday.map((candidate) => {
            const isSelected = selected.has(candidate.externalId);
            return (
              <Pressable
                key={candidate.externalId}
                onPress={() => {
                  const next = new Set(selected);
                  if (isSelected) next.delete(candidate.externalId);
                  else next.add(candidate.externalId);
                  setSelected(next);
                }}
                style={{ paddingVertical: spacing.sm }}
              >
                <Row gap={spacing.md}>
                  <Avatar name={candidate.name} uri={candidate.matchedUser?.avatarUrl} size={40} />
                  <View style={{ flex: 1 }}>
                    <T variant="label">{candidate.name}</T>
                    <T variant="caption" color={colors.textMuted}>{MONTHS[candidate.birthday!.month - 1]} {candidate.birthday!.day}</T>
                  </View>
                  {candidate.matchedUser ? <Badge label="On app" tone="success" /> : null}
                  <Icon name={isSelected ? 'checkCircle' : 'circle'} size={22} color={isSelected ? colors.brand : colors.textFaint} />
                </Row>
              </Pressable>
            );
          })}
          {onApp.filter((candidate) => !candidate.birthday).map((candidate) => (
            <Row key={candidate.externalId} gap={spacing.md} style={{ paddingVertical: spacing.sm }}>
              <Avatar name={candidate.name} uri={candidate.matchedUser?.avatarUrl} size={40} />
              <T style={{ flex: 1 }}>{candidate.name}</T>
              <Button small variant="secondary" title="View" onPress={() => router.push(`/person/${candidate.matchedUser!.id}`)} />
            </Row>
          ))}
          <Button title={`Import ${[...selected].filter((id) => withBirthday.some((candidate) => candidate.externalId === id)).length} birthdays`} loading={confirm.isPending} disabled={selected.size === 0} onPress={() => confirm.mutate()} style={{ marginTop: spacing.xl }} />
        </>
      )}
    </Screen>
  );
}
