import { INTEREST_CATALOG, type InterestDto } from '@bday/shared';
import { useQuery } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Button, Chip, Screen, T } from '../../src/components/ui';
import { api } from '../../src/lib/api';
import { colors, spacing } from '../../src/theme';
import { onboardingDraft } from '../../src/lib/onboardingDraft';
import { interestIcon } from '../../src/lib/icons';

/** Onboarding screen 3 (spec §4): "What do you love?" — feeds AI gift matching. */
export default function OnboardingInterests() {
  const interests = useQuery({ queryKey: ['interests'], queryFn: () => api.get<InterestDto[]>('/interests') });
  const [selected, setSelected] = useState<string[]>(onboardingDraft.interests);
  const catalog = interests.data ?? INTEREST_CATALOG.map((item) => ({ ...item }));

  const toggle = (slug: string) => setSelected((current) => (current.includes(slug) ? current.filter((item) => item !== slug) : [...current, slug]));

  return (
    <Screen>
      <T variant="caption" color={colors.brand}>
        STEP 2 OF 3
      </T>
      <T variant="display" style={{ marginVertical: spacing.sm }}>
        What do you love?
      </T>
      <T color={colors.textMuted} style={{ marginBottom: spacing.xl }}>
        Pick a few. We use them to suggest gifts people will actually like.
      </T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {catalog.map((interest) => (
          <Chip key={interest.slug} label={interest.label} icon={interestIcon(interest.slug)} selected={selected.includes(interest.slug)} onPress={() => toggle(interest.slug)} />
        ))}
      </View>
      <Button
        title={selected.length === 0 ? 'Skip for now' : `Continue with ${selected.length}`}
        variant={selected.length === 0 ? 'secondary' : 'primary'}
        style={{ marginTop: spacing.xl }}
        onPress={() => {
          onboardingDraft.interests = selected;
          router.push('/onboarding/permissions');
        }}
      />
    </Screen>
  );
}
