import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Button, Field, InlineError, Screen, T } from '../../src/components/ui';
import { useAuth } from '../../src/lib/auth';
import { colors, spacing } from '../../src/theme';

export default function Verify() {
  const params = useLocalSearchParams<{ challengeId: string; destination: string; debugCode?: string }>();
  const { verifyOtp } = useAuth();
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(value = code) {
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(params.challengeId, value);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <T variant="display">Enter your code 🔐</T>
      <T color={colors.textMuted} style={{ marginTop: 6, marginBottom: spacing.xl }}>
        We sent a 6-digit code to {params.destination}.
      </T>
      {__DEV__ && params.debugCode ? (
        <T variant="caption" color={colors.textMuted} style={{ marginBottom: spacing.md }}>
          Development code: {params.debugCode}
        </T>
      ) : null}
      <InlineError error={error} />
      <Field
        label="Verification code"
        keyboardType="number-pad"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={6}
        value={code}
        onChangeText={(value) => {
          const digits = value.replace(/\D/g, '');
          setCode(digits);
          if (digits.length === 6) void submit(digits);
        }}
        style={{ fontSize: 26, letterSpacing: 10, textAlign: 'center' }}
      />
      <Button title="Verify" loading={busy} disabled={code.length !== 6} onPress={() => void submit()} />
    </Screen>
  );
}
