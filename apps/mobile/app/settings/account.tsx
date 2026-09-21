import { useMutation } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useState } from 'react';
import { Alert, Linking, Platform, Share } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { Button, Card, Divider, Field, InlineError, Screen, Section, T } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { WEB_URL } from '../../src/lib/config';
import { colors, spacing } from '../../src/theme';

/** Password, data export, deactivation and deletion (spec §39). */
export default function AccountSettings() {
  const { user, signOut } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');

  const changePassword = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword: currentPassword || undefined, newPassword }),
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      Alert.alert('Password updated');
    },
  });

  const exportData = useMutation({
    mutationFn: () => api.get<Record<string, unknown>>('/users/me/export'),
    onSuccess: async (data) => {
      const json = JSON.stringify(data, null, 2);
      if (Platform.OS !== 'web' && (await Sharing.isAvailableAsync())) {
        const file = new File(Paths.cache, `birthday-app-data-${Date.now()}.json`);
        file.write(json);
        await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: 'Your data' });
      } else {
        await Share.share({ message: json });
      }
    },
  });

  const deactivate = useMutation({ mutationFn: () => api.post('/users/me/deactivate'), onSuccess: () => void signOut() });
  const remove = useMutation({ mutationFn: () => api.delete('/users/me', { confirmation }), onSuccess: () => void signOut() });

  return (
    <Screen>
      <Stack.Screen options={{ title: 'Account & data' }} />
      <Card>
        <T variant="label">Signed in as</T>
        <T>{user?.email ?? user?.phone ?? `@${user?.username}`}</T>
      </Card>

      <Section title="Password">
        <InlineError error={changePassword.error} />
        <Field label="Current password (leave empty if you never set one)" secureTextEntry value={currentPassword} onChangeText={setCurrentPassword} />
        <Field label="New password" secureTextEntry value={newPassword} onChangeText={setNewPassword} />
        <Button small title="Update password" loading={changePassword.isPending} disabled={newPassword.length < 8} onPress={() => changePassword.mutate()} />
      </Section>

      <Section title="Your data">
        <InlineError error={exportData.error} />
        <Button variant="secondary" icon="package" title="Download my data" loading={exportData.isPending} onPress={() => exportData.mutate()} />
        <Button variant="ghost" title="Privacy policy" onPress={() => void Linking.openURL(`${WEB_URL}/privacy`)} style={{ marginTop: spacing.sm }} />
        <Button variant="ghost" title="Terms of service" onPress={() => void Linking.openURL(`${WEB_URL}/terms`)} />
      </Section>

      <Section title="Danger zone">
        <Card>
          <T color={colors.textMuted}>Deactivating hides your profile and signs you out everywhere. Sign in again to come back.</T>
          <Button small variant="secondary" title="Deactivate account" loading={deactivate.isPending} onPress={() => Alert.alert('Deactivate account?', undefined, [{ text: 'Cancel', style: 'cancel' }, { text: 'Deactivate', style: 'destructive', onPress: () => deactivate.mutate() }])} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }} />
          <Divider />
          <T color={colors.danger} variant="label">Delete account permanently</T>
          <T color={colors.textMuted}>Your profile, wishlists and personal details are removed. Records of payments are kept as the law requires.</T>
          <InlineError error={remove.error} />
          <Field label={user?.email || user?.username ? 'Enter your password, or your username if you have no password' : 'Type your username to confirm'} secureTextEntry value={confirmation} onChangeText={setConfirmation} style={{ marginTop: spacing.sm }} />
          <Button small variant="danger" title="Delete my account" loading={remove.isPending} disabled={!confirmation} onPress={() => Alert.alert('Delete forever?', 'This cannot be undone.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Delete', style: 'destructive', onPress: () => remove.mutate() }])} style={{ alignSelf: 'flex-start' }} />
        </Card>
      </Section>
    </Screen>
  );
}
