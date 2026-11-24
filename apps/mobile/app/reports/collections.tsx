import { getPage, query } from '@/api/client';
import type { CollectionAgentRow, CollectionsMeta } from '@/api/types';
import { Note, PeriodChoice, usePeriod } from '@/components/ReportParts';
import {
  Card,
  EmptyState,
  ErrorText,
  KeyValue,
  ListRow,
  Loading,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { illustrations } from '@/theme/art';
import { useLoad } from '@/hooks/useLoad';
import { formatINR } from '@/utils/currency';

export default function CollectionsReportScreen() {
  const p = usePeriod('7d');
  const { data, error, loading, refreshing, reload } = useLoad(
    () =>
      getPage<CollectionAgentRow, CollectionsMeta>(
        `/reports/finance/collections${query({ from: p.from, to: p.to, pageSize: 50 })}`,
      ),
    [p.from, p.to],
  );
  const m = data?.meta;
  return (
    <Screen onRefresh={() => void reload(true)} refreshing={refreshing}>
      <PeriodChoice value={p.key} onChange={p.setKey} />
      <ErrorText message={error} />
      {loading ? (
        <Loading />
      ) : (
        <>
          {m ? (
            <Card>
              <KeyValue
                label="Collected"
                value={formatINR(m.totals.collected)}
                bold
                tone="success"
              />
              <KeyValue label="Receipts" value={String(m.totals.receipts)} />
              <KeyValue label="Customers paid" value={String(m.totals.customers)} />
              <Note>Receipts that were reversed are not counted.</Note>
            </Card>
          ) : null}
          <SectionTitle>By agent</SectionTitle>
          {data?.data.length === 0 ? (
            <EmptyState
              art={illustrations.emptyCollections}
              title="No collections in this period"
            />
          ) : (
            data?.data.map((a) => (
              <ListRow
                key={a.agentId ?? 'counter'}
                title={a.name}
                subtitle={`${a.receipts} receipts · ${a.customers} customers`}
                right={formatINR(a.collected)}
              />
            ))
          )}
          {m && m.daily.length > 0 ? (
            <>
              <SectionTitle>By day</SectionTitle>
              {m.daily
                .slice()
                .reverse()
                .map((d) => (
                  <ListRow
                    key={d.date}
                    title={d.date}
                    subtitle={`${d.receipts} receipts`}
                    right={formatINR(d.collected)}
                  />
                ))}
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}
