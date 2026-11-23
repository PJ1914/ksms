import { getData, query } from '@/api/client';
import type { ProfitReport } from '@/api/types';
import { Note, PeriodChoice, usePeriod } from '@/components/ReportParts';
import { Card, ErrorText, KeyValue, Loading, Screen, SectionTitle } from '@/components/ui';
import { useLoad } from '@/hooks/useLoad';
import { formatINR, isNegative } from '@/utils/currency';

export default function ProfitScreen() {
  const p = usePeriod('month');
  const { data, error, loading, refreshing, reload } = useLoad(
    () => getData<ProfitReport>(`/reports/finance/profit${query({ from: p.from, to: p.to })}`),
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
          <SectionTitle>Gross profit (estimate)</SectionTitle>
          <Card>
            <KeyValue label="Revenue (sales before GST)" value={formatINR(data.revenue)} />
            <KeyValue label="Cost of goods sold" value={formatINR(data.costOfGoodsSold)} />
            <KeyValue
              label="Gross profit"
              value={formatINR(data.grossProfit)}
              bold
              tone={isNegative(data.grossProfit) ? 'danger' : 'success'}
            />
            <KeyValue label="Gross margin" value={`${data.grossMarginPercent}%`} tone="muted" />
          </Card>
          <SectionTitle>Net profit (estimate)</SectionTitle>
          <Card>
            <KeyValue label="Gross profit" value={formatINR(data.grossProfit)} />
            <KeyValue label="Expenses" value={`-${formatINR(data.expenses.total)}`} />
            <KeyValue label="Stock written off" value={`-${formatINR(data.stockWrittenOff)}`} />
            <KeyValue
              label="Net profit"
              value={formatINR(data.netProfit)}
              bold
              tone={isNegative(data.netProfit) ? 'danger' : 'success'}
            />
            <Note>
              Estimates: cost is the average cost when each item was sold. Revenue is not the money
              received, and net profit is not the cash in hand. See Cash flow for money that moved.
            </Note>
          </Card>
          {data.expenses.byCategory.length > 0 ? (
            <>
              <SectionTitle>Expenses by category</SectionTitle>
              <Card>
                {data.expenses.byCategory.map((c) => (
                  <KeyValue key={c.categoryId} label={c.name} value={formatINR(c.total)} />
                ))}
              </Card>
            </>
          ) : null}
        </>
      ) : null}
    </Screen>
  );
}
