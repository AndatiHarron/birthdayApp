import type { OtpChallenge } from '@bday/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, View } from 'react-native';
import { Button, Chip, Field, InlineError, Row, Screen, T } from '../../src/components/ui';
import { api, fieldError } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { colors, spacing } from '../../src/theme';

export default function SignIn() {
  const { signIn } = useAuth();
  const [mode, setMode] = useState<'password' | 'phone'>('password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [phone, setPhone] = useState('+254');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submitPassword() {
    setBusy(true);
    setError(null);
    try {
      const value = identifier.trim();
      const key = value.includes('@') ? 'email' : /^\+?\d{7,}$/.test(value.replace(/\s/g, '')) ? 'phone' : 'username';
      await signIn({ [key]: key === 'phone' ? value.replace(/\s/g, '') : value.toLowerCase() }, password);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  async function submitPhone() {
    setBusy(true);
    setError(null);
    try {
      const challenge = await api.post<OtpChallenge & { debugCode?: string }>('/auth/request-otp', { phone: phone.replace(/\s/g, ''), purpose: 'LOGIN' });
      router.push({ pathname: '/(auth)/verify', params: { challengeId: challenge.challengeId, destination: challenge.destination, debugCode: challenge.debugCode ?? '' } });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <T variant="display">Welcome back 👋</T>
        <T color={colors.textMuted} style={{ marginTop: 6, marginBottom: spacing.xl }}>
          Sign in to see who’s celebrating soon.
        </T>
        <Row style={{ marginBottom: spacing.lg }}>
          <Chip label="Password" selected={mode === 'password'} onPress={() => setMode('password')} />
          <Chip label="Phone code" selected={mode === 'phone'} onPress={() => setMode('phone')} />
        </Row>
        <InlineError error={error} />
        {mode === 'password' ? (
          <>
            <Field label="Email, phone or username" autoCapitalize="none" autoComplete="username" value={identifier} onChangeText={setIdentifier} error={fieldError(error, 'email')} />
            <Field label="Password" secureTextEntry autoComplete="password" value={password} onChangeText={setPassword} error={fieldError(error, 'password')} />
            <Button title="Sign in" loading={busy} disabled={!identifier || !password} onPress={submitPassword} />
            <Pressable onPress={() => router.push('/(auth)/forgot-password')} style={{ marginTop: spacing.lg, alignSelf: 'center' }}>
              <T variant="label" color={colors.brand}>
                Forgot password?
              </T>
            </Pressable>
          </>
        ) : (
          <>
            <Field label="Phone number" keyboardType="phone-pad" autoComplete="tel" value={phone} onChangeText={setPhone} hint="We’ll text you a 6-digit code." error={fieldError(error, 'phone')} />
            <Button title="Send code" loading={busy} disabled={phone.length < 10} onPress={submitPhone} />
          </>
        )}
        <View style={{ marginTop: spacing.xxl, alignItems: 'center' }}>
          <Pressable onPress={() => router.replace('/(auth)/sign-up')}>
            <T color={colors.textMuted}>
              New here? <T variant="label" color={colors.brand}>Create an account</T>
            </T>
          </Pressable>
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}
