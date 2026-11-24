/** Fresh Mandi design tokens: light, leafy, friendly. Every screen reads its colours from here. */
export const colors = {
  primary: '#1E7A4C',
  primaryDark: '#155C39',
  primarySoft: '#E3F0E6',
  accent: '#F5B83D',
  accentSoft: '#FFF1D6',
  background: '#F4F8F1',
  surface: '#FFFFFF',
  surfaceMuted: '#EEF4EF',
  text: '#15241B',
  textMuted: '#5B6B61',
  border: '#E3EBE5',
  danger: '#A8321F',
  dangerSoft: '#FDE7E4',
  warning: '#8A5300',
  warningSoft: '#FFF1D6',
  success: '#1B6B43',
  successSoft: '#E3F0E6',
  info: '#2F5EB8',
  infoSoft: '#E6EEFB',
  onPrimary: '#FFFFFF',
  onPrimaryMuted: '#D6EEDF',
} as const;

export const radius = { sm: 10, md: 14, lg: 20, xl: 24, pill: 999 } as const;

/** Soft card shadow (iOS) with a matching Android elevation. */
export const shadow = {
  card: {
    shadowColor: '#15241B',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  raised: {
    shadowColor: '#1E7A4C',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
} as const;

/** Tinted icon tiles: background + foreground pairs used across lists and tiles. */
export const tints = {
  green: { bg: '#E3F0E6', fg: '#1E7A4C' },
  mango: { bg: '#FFF1D6', fg: '#8A5300' },
  tomato: { bg: '#FDE7E4', fg: '#A8321F' },
  blue: { bg: '#E6EEFB', fg: '#2F5EB8' },
  lavender: { bg: '#EFE6FB', fg: '#5B3FA0' },
} as const;
export type Tint = keyof typeof tints;
