import { useState } from 'react';
import { getPage, query } from '@/api/client';
import type { DuesMeta, DuesRow } from '@/api/types';
import {
  Card,
  Choice,
  EmptyState,
  ErrorText,
  KeyValue,
  ListRow,
  Loading,
  Screen,
} from '@/components/ui';
import { useLoad } from '@/hooks/useLoad';
import { formatINR } from '@/utils/currency';
import { formatDate } from '@/utils/format';

const PARTIES = [
  { key: 'customers', label: 'Customers owe us' },
  { key: 'suppliers', label: 'We owe suppliers' },
] as const;

export default function DuesScreen() {
  const [party, setParty] = useState<'customers' | 'suppliers'>('customers');
  const { data, error, loading, refreshing, reload } = useLoad(
    () =>
      getPage<DuesRow, DuesMeta>(`/reports/finance/outstanding${query({ party, pageSize: 50 })}`),
    [party],
  );
  const s = data?.meta.summary;
  return (
    <Screen onRefresh={() => void reload(true)} refreshing={refreshing}>
      <Choice options={PARTIES} value={party} onChange={setParty} />
      <ErrorText message={error} />
      {loading ? (
        <Loading />
      ) : (
        <>
          {s ? (
            <Card>
              {party === 'customers' ? (
                <>
                  <KeyValue
                    label="Total owed by customers"
                    value={formatINR(s.customers.totalDue)}
                    bold
                    tone="danger"
                  />
                  <KeyValue label="Customers owing" value={String(s.customers.owing)} />
                  <KeyValue
                    label="Advances held for customers"
                    value={formatINR(s.customers.advances)}
                    tone="muted"
                  />
                </>
              ) : (
                <>
                  <KeyValue
                    label="Total owed to suppliers"
                    value={formatINR(s.suppliers.totalPayable)}
                    bold
                    tone="danger"
                  />
                  <KeyValue label="Suppliers owed" value={String(s.suppliers.owed)} />
                </>
              )}
            </Card>
          ) : null}
          {data?.data.length === 0 ? (
            <EmptyState icon="checkmark-circle-outline" title="Nothing outstanding" />
          ) : (
            data?.data.map((r) => (
              <ListRow
                key={r.id}
                title={r.name}
                subtitle={
                  party === 'customers'
                    ? r.lastPaymentAt
                      ? `Last paid ${formatDate(r.lastPaymentAt)}`
                      : 'Has not paid yet'
                    : (r.phone ?? undefined)
                }
                right={formatINR(r.due ?? r.payable ?? '0')}
              />
            ))
          )}
        </>
      )}
    </Screen>
  );
}
