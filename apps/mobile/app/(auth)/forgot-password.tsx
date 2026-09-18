import type { OtpChallenge } from '@bday/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { Button, Field, InlineError, Screen, T } from '../../src/components/ui';
import { api, fieldError } from '../../src/lib/api';
import { colors, spacing } from '../../src/theme';

export default function ForgotPassword() {
  const [identifier, setIdentifier] = useState('');
  const [challenge, setChallenge] = useState<(OtpChallenge & { debugCode?: string }) | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function requestCode() {
    setBusy(true);
    setError(null);
    try {
      const value = identifier.trim();
      const result = await api.post<OtpChallenge & { debugCode?: string }>('/auth/forgot-password', value.includes('@') ? { email: value.toLowerCase() } : { phone: value.replace(/\s/g, '') });
      setChallenge(result);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/reset-password', { challengeId: challenge.challengeId, code, password });
      Alert.alert('Password updated', 'Sign in with your new password.');
      router.replace('/(auth)/sign-in');
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <T variant="title">Reset your password</T>
      <T color={colors.textMuted} style={{ marginVertical: spacing.md }}>
        {challenge ? `Enter the code sent to ${challenge.destination} and choose a new password.` : 'We’ll send a code to your email or phone.'}
      </T>
      <InlineError error={error} />
      {!challenge ? (
        <>
          <Field label="Email or phone" autoCapitalize="none" value={identifier} onChangeText={setIdentifier} />
          <Button title="Send code" loading={busy} disabled={!identifier} onPress={requestCode} />
        </>
      ) : (
        <>
          {__DEV__ && challenge.debugCode ? <T variant="caption" color={colors.textMuted}>Development code: {challenge.debugCode}</T> : null}
          <Field label="Code" keyboardType="number-pad" maxLength={6} value={code} onChangeText={setCode} error={fieldError(error, 'code')} />
          <Field label="New password" secureTextEntry value={password} onChangeText={setPassword} error={fieldError(error, 'password')} />
          <Button title="Update password" loading={busy} disabled={code.length !== 6 || password.length < 8} onPress={reset} />
        </>
      )}
    </Screen>
  );
}
