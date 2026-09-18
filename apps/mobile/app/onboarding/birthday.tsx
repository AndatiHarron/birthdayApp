import { router } from 'expo-router';
import { useState } from 'react';
import { BirthdayPicker } from '../../src/components/DatePicker';
import { Button, Card, Screen, T, Toggle } from '../../src/components/ui';
import { colors, spacing } from '../../src/theme';
import { onboardingDraft } from '../../src/lib/onboardingDraft';

/** Onboarding screen 2 (spec §4): "When is your birthday?" */
export default function OnboardingBirthday() {
  const [value, setValue] = useState(onboardingDraft.birthday ?? { month: 1, day: 1, year: null as number | null });
  const [showYear, setShowYear] = useState(onboardingDraft.showBirthYear);

  return (
    <Screen>
      <T variant="caption" color={colors.brand}>
        STEP 1 OF 3
      </T>
      <T variant="display" style={{ marginVertical: spacing.sm }}>
        When is your birthday? 🎂
      </T>
      <T color={colors.textMuted} style={{ marginBottom: spacing.xl }}>
        Your friends get reminded so they can celebrate you.
      </T>
      <Card>
        <BirthdayPicker value={value} onChange={setValue} />
        {value.year != null ? (
          <Toggle label="Show my birth year" description="When off, friends see the day but not your age." value={showYear} onChange={setShowYear} />
        ) : null}
      </Card>
      <Button
        title="Continue"
        style={{ marginTop: spacing.xl }}
        onPress={() => {
          onboardingDraft.birthday = value;
          onboardingDraft.showBirthYear = showYear;
          router.push('/onboarding/interests');
        }}
      />
    </Screen>
  );
}
