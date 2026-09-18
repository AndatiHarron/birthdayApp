/** Onboarding answers collected across three screens and saved once at the end (spec §4). */
export const onboardingDraft: {
  birthday: { month: number; day: number; year: number | null } | null;
  showBirthYear: boolean;
  interests: string[];
} = { birthday: null, showBirthYear: true, interests: [] };
