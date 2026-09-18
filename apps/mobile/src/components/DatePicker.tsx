import { daysInMonth } from '@bday/shared';
import { useMemo } from 'react';
import { ScrollView, View } from 'react-native';
import { colors, spacing } from '../theme';
import { Chip, T } from './ui';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Birthday picker: month, day and an optional year. Birthdays are calendar
 * anniversaries, so this never produces a timestamp that could shift by time
 * zone — it yields the (month, day, year?) triple the API stores.
 */
export function BirthdayPicker({
  value,
  onChange,
  allowNoYear = true,
}: {
  value: { month: number; day: number; year: number | null };
  onChange: (value: { month: number; day: number; year: number | null }) => void;
  allowNoYear?: boolean;
}) {
  const thisYear = new Date().getFullYear();
  const years = useMemo(() => Array.from({ length: 100 }, (_, index) => thisYear - index), [thisYear]);
  const maxDay = daysInMonth(value.month, value.year ?? 2000);

  return (
    <View style={{ gap: spacing.md }}>
      <T variant="label" color={colors.textMuted}>
        Month
      </T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm }}>
        {MONTHS.map((label, index) => (
          <Chip key={label} label={label} selected={value.month === index + 1} onPress={() => onChange({ ...value, month: index + 1, day: Math.min(value.day, daysInMonth(index + 1, value.year ?? 2000)) })} />
        ))}
      </View>
      <T variant="label" color={colors.textMuted}>
        Day
      </T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {Array.from({ length: maxDay }, (_, index) => index + 1).map((day) => (
          <Chip key={day} label={String(day)} selected={value.day === day} onPress={() => onChange({ ...value, day })} />
        ))}
      </View>
      <T variant="label" color={colors.textMuted}>
        Year {allowNoYear ? '(optional)' : ''}
      </T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
        {allowNoYear ? <Chip label="Skip" selected={value.year == null} onPress={() => onChange({ ...value, year: null })} /> : null}
        {years.map((year) => (
          <Chip key={year} label={String(year)} selected={value.year === year} onPress={() => onChange({ ...value, year, day: Math.min(value.day, daysInMonth(value.month, year)) })} />
        ))}
      </ScrollView>
    </View>
  );
}
