import { useState } from 'react';
import { getData, getPage, query } from '@/api/client';
import type { BreakdownRow, SalesSummary } from '@/api/types';
import { Note, PeriodChoice, usePeriod } from '@/components/ReportParts';
import {
  Card,
  Choice,
  EmptyState,
  ErrorText,
  KeyValue,
  ListRow,
  Loading,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { useLoad } from '@/hooks/useLoad';
import { formatINR } from '@/utils/currency';
import { words } from '@/utils/format';

const VIEWS = [
  { key: 'days', label: 'By day' },
  { key: 'product', label: 'Product' },
  { key: 'category', label: 'Category' },
  { key: 'customer', label: 'Customer' },
  { key: 'payment_method', label: 'Payment' },
  { key: 'cashier', label: 'Cashier' },
] as const;
type ViewKey = (typeof VIEWS)[number]['key'];

export default function SalesReportScreen() {
  const p = usePeriod('7d');
  const [view, setView] = useState<ViewKey>('days');

  const summary = useLoad(
    () => getData<SalesSummary>(`/reports/sales/summary${query({ from: p.from, to: p.to })}`),
    [p.from, p.to],
  );
  const breakdown = useLoad(
    () =>
      view === 'days'
        ? Promise.resolve(null)
        : getPage<BreakdownRow>(
            `/reports/sales/breakdown${query({ by: view, from: p.from, to: p.to, pageSize: 50 })}`,
          ),
    [view, p.from, p.to],
  );
  const t = summary.data?.totals;

  return (
    <Screen
      onRefresh={() => {
        void summary.reload(true);
        void breakdown.reload(true);
      }}
      refreshing={summary.refreshing || breakdown.refreshing}
    >
      <PeriodChoice value={p.key} onChange={p.setKey} />
      <ErrorText message={summary.error} />
      {summary.loading ? (
        <Loading />
      ) : t ? (
        <Card>
          <KeyValue label="Net sales (before GST)" value={formatINR(t.netSales)} bold />
          <KeyValue label="Bills" value={String(t.bills)} />
          <KeyValue label="Billed to customers (with GST)" value={formatINR(t.billValue)} />
          <KeyValue label="Average bill" value={formatINR(t.averageBill)} />
          <KeyValue label="Discounts given" value={formatINR(t.discount)} />
          <KeyValue label="GST charged" value={formatINR(t.gst)} />
          <KeyValue label="Left on credit" value={formatINR(t.creditGiven)} />
          <KeyValue
            label={`Returns (${t.returnsCount})`}
            value={formatINR(t.returnsValue)}
            tone="danger"
          />
          <Note>
            Net sales = what was sold before GST, less discounts and goods returned. It is not the
            money received.
          </Note>
        </Card>
      ) : null}

      <Choice label="Show" options={VIEWS} value={view} onChange={setView} />
      {view === 'days' ? (
        summary.data && summary.data.series.length === 0 ? (
          <EmptyState icon="receipt-outline" title="No sales in this period" />
        ) : (
          summary.data?.series
            .slice()
            .reverse()
            .map((d) => (
              <ListRow
                key={d.date}
                title={d.date}
                subtitle={`${d.bills} bills`}
                right={formatINR(d.netSales)}
                rightSub="net sales"
              />
            ))
        )
      ) : breakdown.loading ? (
        <Loading />
      ) : (
        <>
          <ErrorText message={breakdown.error} />
          <SectionTitle>{`By ${words(view)}`}</SectionTitle>
          {breakdown.data?.data.length === 0 ? (
            <EmptyState icon="receipt-outline" title="Nothing sold in this period" />
          ) : (
            breakdown.data?.data.map((r, i) => (
              <ListRow
                key={`${r.id ?? r.method ?? 'x'}-${i}`}
                title={r.name ?? words(r.method ?? '')}
                subtitle={
                  r.grossProfit !== undefined
                    ? `Profit ${formatINR(r.grossProfit)} (${r.marginPercent}%)`
                    : r.bills !== undefined
                      ? `${r.bills} bills`
                      : r.quantity !== undefined
                        ? `${r.quantity} ${r.baseUnit ?? ''}`
                        : undefined
                }
                right={formatINR(r.netSales ?? r.billValue ?? r.amount ?? '0')}
              />
            ))
          )}
        </>
      )}
    </Screen>
  );
}
