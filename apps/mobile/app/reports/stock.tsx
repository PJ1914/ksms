import { useState } from 'react';
import { getData, query } from '@/api/client';
import type { InventorySummary, MoverRow } from '@/api/types';
import { Note } from '@/components/ReportParts';
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

const KINDS = [
  { key: 'fast', label: 'Fast sellers' },
  { key: 'slow', label: 'Slow stock' },
] as const;

export default function StockReportScreen() {
  const [kind, setKind] = useState<'fast' | 'slow'>('fast');
  const summary = useLoad(() => getData<InventorySummary>('/reports/inventory/summary'), []);
  const movers = useLoad(
    () =>
      getData<{ items: MoverRow[]; days: number }>(
        `/reports/inventory/movers${query({ kind, days: 30 })}`,
      ),
    [kind],
  );
  const s = summary.data;
  return (
    <Screen
      onRefresh={() => {
        void summary.reload(true);
        void movers.reload(true);
      }}
      refreshing={summary.refreshing || movers.refreshing}
    >
      <ErrorText message={summary.error} />
      {summary.loading ? (
        <Loading />
      ) : s ? (
        <>
          <Card>
            <KeyValue label="Stock value (at cost)" value={formatINR(s.stockValue)} bold />
            <KeyValue label="Products in stock" value={String(s.productsInStock)} />
            <KeyValue
              label="Out of stock"
              value={String(s.productsOutOfStock)}
              tone={s.productsOutOfStock > 0 ? 'danger' : undefined}
            />
            <KeyValue
              label="Running low"
              value={String(s.lowStockProducts)}
              tone={s.lowStockProducts > 0 ? 'danger' : undefined}
            />
            <KeyValue
              label={`Expired (${s.expired.batches} batches)`}
              value={formatINR(s.expired.value)}
              tone={s.expired.batches > 0 ? 'danger' : undefined}
            />
            <KeyValue
              label={`Expiring in ${s.expiringSoon.withinDays} days (${s.expiringSoon.batches})`}
              value={formatINR(s.expiringSoon.value)}
            />
            <Note>Value uses the average cost of what is on the shelf.</Note>
          </Card>
          {s.byCategory.length > 0 ? (
            <>
              <SectionTitle>Value by category</SectionTitle>
              <Card>
                {s.byCategory.map((c) => (
                  <KeyValue
                    key={c.categoryId ?? 'none'}
                    label={c.category}
                    value={formatINR(c.value)}
                  />
                ))}
              </Card>
            </>
          ) : null}
        </>
      ) : null}

      <Choice label="Last 30 days" options={KINDS} value={kind} onChange={setKind} />
      {movers.loading ? (
        <Loading />
      ) : movers.data?.items.length === 0 ? (
        <EmptyState
          icon="cube-outline"
          title={kind === 'fast' ? 'Nothing sold yet' : 'No stock on the shelf'}
        />
      ) : (
        movers.data?.items.map((m) => (
          <ListRow
            key={m.productId}
            title={m.name}
            subtitle={`Sold ${m.soldQuantity} ${m.baseUnit} · ${m.quantityOnHand} on shelf`}
            right={formatINR(m.stockValue)}
            rightSub="tied up"
          />
        ))
      )}
    </Screen>
  );
}
