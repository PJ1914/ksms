import { useState } from 'react';
import { getData, getPage, query } from '@/api/client';
import type { PurchaseSupplierRow, PurchasesSummary } from '@/api/types';
import { PeriodChoice, usePeriod } from '@/components/ReportParts';
import {
  Card,
  Choice,
  EmptyState,
  ErrorText,
  Hero,
  KeyValue,
  ListRow,
  Loading,
  Screen,
} from '@/components/ui';
import { icons, illustrations } from '@/theme/art';
import { useLoad } from '@/hooks/useLoad';
import { formatINR } from '@/utils/currency';

const VIEWS = [
  { key: 'days', label: 'By day' },
  { key: 'supplier', label: 'By supplier' },
] as const;

export default function PurchasesReportScreen() {
  const p = usePeriod('30d');
  const [view, setView] = useState<'days' | 'supplier'>('days');
  const { data, error, loading, refreshing, reload } = useLoad(
    () =>
      getData<PurchasesSummary>(`/reports/purchases/summary${query({ from: p.from, to: p.to })}`),
    [p.from, p.to],
  );
  const suppliers = useLoad(
    () =>
      view === 'supplier'
        ? getPage<PurchaseSupplierRow>(
            `/reports/purchases/breakdown${query({ from: p.from, to: p.to, pageSize: 50 })}`,
          )
        : Promise.resolve(null),
    [view, p.from, p.to],
  );
  return (
    <Screen
      onRefresh={() => {
        void reload(true);
        void suppliers.reload(true);
      }}
      refreshing={refreshing || suppliers.refreshing}
    >
      <PeriodChoice value={p.key} onChange={p.setKey} />
      <ErrorText message={error} />
      {loading ? (
        <Loading />
      ) : data ? (
        <>
          <Hero
            label="Bought (net of returns)"
            value={formatINR(data.totals.net)}
            tint="mango"
            art={icons.repPurchases}
            sub={`${data.totals.orders} purchase orders`}
          />
          <Card>
            <KeyValue label="Bought (net of returns)" value={formatINR(data.totals.net)} bold />
            <KeyValue label="Purchase orders" value={String(data.totals.orders)} />
            <KeyValue label="Received and billed" value={formatINR(data.totals.billed)} />
            <KeyValue label="Sent back to suppliers" value={formatINR(data.totals.returned)} />
          </Card>
          <Choice label="Show" options={VIEWS} value={view} onChange={setView} />
          {view === 'days' ? (
            data.series.length === 0 ? (
              <EmptyState art={illustrations.emptyPurchases} title="No purchases in this period" />
            ) : (
              data.series
                .slice()
                .reverse()
                .map((d) => (
                  <ListRow
                    key={d.date}
                    title={d.date}
                    subtitle={`${d.orders} orders`}
                    right={formatINR(d.net)}
                  />
                ))
            )
          ) : suppliers.loading ? (
            <Loading />
          ) : (
            <>
              <ErrorText message={suppliers.error} />
              {suppliers.data?.data.length === 0 ? (
                <EmptyState
                  art={illustrations.emptyPurchases}
                  title="No purchases in this period"
                />
              ) : (
                suppliers.data?.data.map((s) => (
                  <ListRow
                    key={s.supplierId}
                    title={s.name}
                    subtitle={`${s.orders} orders · you owe ${formatINR(s.owedNow)} now`}
                    right={formatINR(s.net)}
                  />
                ))
              )}
            </>
          )}
        </>
      ) : null}
    </Screen>
  );
}
