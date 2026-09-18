import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable } from 'react-native';
import { Button, Chip, Field, InlineError, Row, Screen, T } from '../../src/components/ui';
import { fieldError } from '../../src/lib/api';
import { useAuth } from '../../src/lib/auth';
import { WEB_URL } from '../../src/lib/config';
import { colors, spacing } from '../../src/theme';

export default function SignUp() {
  const { register } = useAuth();
  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('+254');
  const [password, setPassword] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const result = await register(
        mode === 'email'
          ? { displayName: displayName.trim(), email: email.trim().toLowerCase(), password }
          : { displayName: displayName.trim(), phone: phone.replace(/\s/g, '') },
      );
      if (result.kind === 'OTP_REQUIRED') {
        router.push({
          pathname: '/(auth)/verify',
          params: { challengeId: result.challenge.challengeId, destination: result.challenge.destination, debugCode: result.challenge.debugCode ?? '' },
        });
      }
      // A SESSION result is routed onward to onboarding by the root gate.
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  const valid = displayName.trim().length > 0 && accepted && (mode === 'email' ? email.includes('@') && password.length >= 8 : phone.length >= 10);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen>
        <T variant="display">Let’s get started 🎉</T>
        <T color={colors.textMuted} style={{ marginTop: 6, marginBottom: spacing.xl }}>
          Create your account in under a minute.
        </T>
        <Row style={{ marginBottom: spacing.lg }}>
          <Chip label="Email" selected={mode === 'email'} onPress={() => setMode('email')} />
          <Chip label="Phone" selected={mode === 'phone'} onPress={() => setMode('phone')} />
        </Row>
        <InlineError error={error} />
        <Field label="Your name" autoComplete="name" value={displayName} onChangeText={setDisplayName} error={fieldError(error, 'displayName')} />
        {mode === 'email' ? (
          <>
            <Field label="Email" keyboardType="email-address" autoCapitalize="none" autoComplete="email" value={email} onChangeText={setEmail} error={fieldError(error, 'email')} />
            <Field label="Password" secureTextEntry autoComplete="new-password" value={password} onChangeText={setPassword} hint="8+ characters with upper and lower case and a number." error={fieldError(error, 'password')} />
          </>
        ) : (
          <Field label="Phone number" keyboardType="phone-pad" autoComplete="tel" value={phone} onChangeText={setPhone} hint="International format, e.g. +254712345678" error={fieldError(error, 'phone')} />
        )}
        <Pressable onPress={() => setAccepted(!accepted)} style={{ flexDirection: 'row', gap: spacing.sm, marginVertical: spacing.md, alignItems: 'center' }} accessibilityRole="checkbox" accessibilityState={{ checked: accepted }}>
          <T style={{ fontSize: 20 }}>{accepted ? '☑️' : '⬜'}</T>
          <T color={colors.textMuted} style={{ flex: 1 }}>
            I agree to the{' '}
            <T variant="label" color={colors.brand} style={{ textDecorationLine: 'underline' }}>
              <T variant="label" color={colors.brand}>
                Terms
              </T>
            </T>{' '}
            and{' '}
            <T variant="label" color={colors.brand}>
              Privacy Policy
            </T>
          </T>
        </Pressable>
        <Pressable onPress={() => void Linking.openURL(`${WEB_URL}/privacy`)}>
          <T variant="caption" color={colors.brand} style={{ marginBottom: spacing.lg }}>
            Read the privacy policy
          </T>
        </Pressable>
        <Button title="Create account" loading={busy} disabled={!valid} onPress={submit} />
        <Pressable onPress={() => router.replace('/(auth)/sign-in')} style={{ marginTop: spacing.xl, alignSelf: 'center' }}>
          <T color={colors.textMuted}>
            Already have an account? <T variant="label" color={colors.brand}>Sign in</T>
          </T>
        </Pressable>
      </Screen>
    </KeyboardAvoidingView>
  );
}
