/**
 * Design tokens (spec §44): premium, friendly and neutral. Slate greys carry
 * the interface, one indigo does the work of "brand", and a warm orange is kept
 * for celebration moments so it still feels like a birthday app.
 */
export const colors = {
  bg: '#F6F7F9',
  surface: '#FFFFFF',
  surfaceMuted: '#F0F2F5',
  border: '#E3E6EB',
  text: '#101828',
  textMuted: '#5B6475',
  textFaint: '#98A2B3',
  brand: '#4F46E5',
  brandDark: '#3730A3',
  brandSoft: '#EEF0FF',
  /** Celebration accent: birthdays today, highlights, first celebrations. */
  accent: '#EA580C',
  accentSoft: '#FFF1E7',
  gold: '#D97706',
  goldSoft: '#FEF3C7',
  success: '#059669',
  successSoft: '#D1FAE5',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  info: '#2563EB',
  infoSoft: '#DBEAFE',
  white: '#FFFFFF',
} as const;

export const gradients = {
  /** Primary buttons and progress: close stops, so it reads as a confident solid. */
  brand: ['#5850EC', '#4338CA'] as const,
  sunrise: ['#F97316', '#EA580C'] as const,
  /** Hero and birthday-day backgrounds: deep ink to indigo, with white text. */
  celebration: ['#111827', '#312E81', '#4338CA'] as const,
  soft: ['#F4F5FF', '#F8FAFC'] as const,
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 22, pill: 999 } as const;

export const type = {
  display: { fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: '700' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  label: { fontSize: 13, fontWeight: '600' as const },
  caption: { fontSize: 12, fontWeight: '500' as const },
};

export const shadow = {
  card: {
    shadowColor: '#101828',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
} as const;
