import { useState } from 'react';
import { View } from 'react-native';
import { getPage, query } from '@/api/client';
import type { DayBookRow } from '@/api/types';
import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  KeyValue,
  ListRow,
  Loading,
  Screen,
} from '@/components/ui';
import { useLoad } from '@/hooks/useLoad';
import { formatINR } from '@/utils/currency';
import { formatDateTime, words } from '@/utils/format';
import { addDays } from '@/utils/period';
import { todayInIndia } from '@/utils/today';

export default function DayBookScreen() {
  const today = todayInIndia();
  const [date, setDate] = useState(today);
  const { data, error, loading, refreshing, reload } = useLoad(
    () =>
      getPage<DayBookRow, { totals: Record<string, { count: number; amount: string }> }>(
        `/reports/finance/day-book${query({ date, pageSize: 200 })}`,
      ),
    [date],
  );
  return (
    <Screen onRefresh={() => void reload(true)} refreshing={refreshing}>
      <Card>
        <KeyValue label="Day" value={date === today ? `${date} (today)` : date} bold />
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <View style={{ flex: 1 }}>
            <Button
              title="Earlier day"
              variant="secondary"
              onPress={() => setDate(addDays(date, -1))}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Later day"
              variant="secondary"
              onPress={() => setDate(addDays(date, 1))}
              disabled={date >= today}
            />
          </View>
        </View>
      </Card>
      <ErrorText message={error} />
      {loading ? (
        <Loading />
      ) : data?.data.length === 0 ? (
        <EmptyState icon="book-outline" title="Nothing happened on this day" />
      ) : (
        <>
          <Card>
            {Object.entries(data?.meta.totals ?? {}).map(([kind, v]) => (
              <KeyValue
                key={kind}
                label={`${words(kind)} (${v.count})`}
                value={formatINR(v.amount)}
              />
            ))}
          </Card>
          {data?.data.map((r, i) => (
            <ListRow
              key={`${r.kind}-${r.reference ?? i}-${r.at}`}
              title={`${words(r.kind)}${r.party ? ` · ${r.party}` : ''}`}
              subtitle={`${r.reference ? `${r.reference} · ` : ''}${formatDateTime(r.at)}`}
              right={formatINR(r.amount)}
            />
          ))}
        </>
      )}
    </Screen>
  );
}
