import { getData, query } from '@/api/client';
import type { CashFlowReport } from '@/api/types';
import { PeriodChoice, usePeriod } from '@/components/ReportParts';
import {
  Card,
  ErrorText,
  Hero,
  KeyValue,
  Loading,
  Screen,
  SectionTitle,
  Stats,
} from '@/components/ui';
import { icons } from '@/theme/art';
import { useLoad } from '@/hooks/useLoad';
import { formatINR, isNegative } from '@/utils/currency';
import { words } from '@/utils/format';

export default function CashFlowScreen() {
  const p = usePeriod('7d');
  const { data, error, loading, refreshing, reload } = useLoad(
    () => getData<CashFlowReport>(`/reports/finance/cash-flow${query({ from: p.from, to: p.to })}`),
    [p.from, p.to],
  );
  return (
    <Screen onRefresh={() => void reload(true)} refreshing={refreshing}>
      <PeriodChoice value={p.key} onChange={p.setKey} />
      <ErrorText message={error} />
      {loading ? (
        <Loading />
      ) : data ? (
        <>
          <Hero
            label="Net cash movement"
            value={formatINR(data.totals.net)}
            valueTone={isNegative(data.totals.net) ? 'danger' : 'success'}
            tint={isNegative(data.totals.net) ? 'tomato' : 'blue'}
            art={icons.repCash}
            sub="Money that moved in the cash book, whatever it was for. This is not profit."
          />
          <Stats
            items={[
              { label: 'Money in', value: formatINR(data.totals.moneyIn), tint: 'green' },
              { label: 'Money out', value: formatINR(data.totals.moneyOut), tint: 'tomato' },
            ]}
          />
          <SectionTitle>By payment mode</SectionTitle>
          <Card>
            {data.byMethod.map((m) => (
              <KeyValue key={m.method} label={words(m.method)} value={formatINR(m.net)} />
            ))}
          </Card>
          <SectionTitle>Daily closing</SectionTitle>
          <Card>
            <KeyValue label="Days closed" value={String(data.closings.daysClosed)} />
            <KeyValue
              label="Counted less expected cash"
              value={formatINR(data.closings.cashDifference)}
              tone={isNegative(data.closings.cashDifference) ? 'danger' : undefined}
            />
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
