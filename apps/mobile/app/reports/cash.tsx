import { getData, query } from '@/api/client';
import type { CashFlowReport } from '@/api/types';
import { Note, PeriodChoice, usePeriod } from '@/components/ReportParts';
import { Card, ErrorText, KeyValue, Loading, Screen, SectionTitle } from '@/components/ui';
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
          <Card>
            <KeyValue label="Money in" value={formatINR(data.totals.moneyIn)} tone="success" />
            <KeyValue label="Money out" value={formatINR(data.totals.moneyOut)} tone="danger" />
            <KeyValue
              label="Net movement"
              value={formatINR(data.totals.net)}
              bold
              tone={isNegative(data.totals.net) ? 'danger' : undefined}
            />
            <Note>Money that moved in the cash book, whatever it was for. This is not profit.</Note>
          </Card>
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
