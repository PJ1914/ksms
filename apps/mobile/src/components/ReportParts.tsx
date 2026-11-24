import { useState } from 'react';
import { Text } from 'react-native';
import { Segmented } from '@/components/ui';
import { colors } from '@/theme/colors';
import { type PeriodKey, PERIODS, periodRange } from '@/utils/period';
import { todayInIndia } from '@/utils/today';

/** The period a report covers, chosen with one tap. Returns the dates to send to the API. */
export function usePeriod(initial: PeriodKey = 'today') {
  const [key, setKey] = useState<PeriodKey>(initial);
  const range = periodRange(key, todayInIndia());
  return { key, setKey, ...range };
}

export function PeriodChoice({
  value,
  onChange,
}: {
  value: PeriodKey;
  onChange: (k: PeriodKey) => void;
}) {
  return <Segmented options={PERIODS} value={value} onChange={onChange} />;
}

/** A small grey note under a figure, used to say what a number means. */
export function Note({ children }: { children: string }) {
  return <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>{children}</Text>;
}
