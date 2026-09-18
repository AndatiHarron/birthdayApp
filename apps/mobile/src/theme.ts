/** Design tokens (spec §44): premium, friendly, colourful but not childish. */
export const colors = {
  bg: '#FAF8FF',
  surface: '#FFFFFF',
  surfaceMuted: '#F3F0FA',
  border: '#ECE8F5',
  text: '#1C1830',
  textMuted: '#6B6680',
  textFaint: '#A09BB3',
  brand: '#7C3AED',
  brandDark: '#5B21B6',
  brandSoft: '#F1E8FF',
  pink: '#EC4899',
  pinkSoft: '#FCE7F3',
  gold: '#F59E0B',
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
  brand: ['#7C3AED', '#EC4899'] as const,
  sunrise: ['#F97316', '#EC4899'] as const,
  celebration: ['#7C3AED', '#EC4899', '#F59E0B'] as const,
  soft: ['#F5F0FF', '#FDF2F8'] as const,
};

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 18, xl: 24, pill: 999 } as const;

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
    shadowColor: '#2A1B5C',
    shadowOpacity: 0.07,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
} as const;
