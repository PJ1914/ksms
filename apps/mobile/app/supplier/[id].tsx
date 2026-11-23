import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { getData, postData } from '@/api/client';
import type { LedgerEntry, SupplierDetail } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { ListFooter } from '@/components/ListFooter';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  KeyValue,
  Loading,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { useLoad, usePagedList } from '@/hooks/useLoad';
import { colors } from '@/theme/colors';
import { absMoney, formatINR, isNegative, isPositive } from '@/utils/currency';
import { friendlyError } from '@/utils/errors';
import { formatDateTime, words } from '@/utils/format';

export default function SupplierScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const {
    data: s,
    loading,
    error,
    refreshing,
    reload,
  } = useLoad(() => getData<SupplierDetail>(`/suppliers/${id}`), [id]);
  const ledger = usePagedList<LedgerEntry>(`/suppliers/${id}/ledger`, 25);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (!s) return <ErrorText message={error ?? 'Could not load this supplier.'} />;
  const supplier = s;
  const owed = isPositive(supplier.balance);

  async function toggleActive() {
    setBusy(true);
    setProblem(null);
    try {
      await postData(`/suppliers/${id}/${supplier.isActive ? 'deactivate' : 'reactivate'}`);
      void reload();
    } catch (e) {
      setProblem(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen onRefresh={() => void reload(true)} refreshing={refreshing}>
      <Stack.Screen options={{ title: s.name }} />
      <Card>
        <Text
          style={{ fontSize: 26, fontWeight: '800', color: owed ? colors.danger : colors.text }}
        >
          {formatINR(isNegative(s.balance) ? absMoney(s.balance) : s.balance)}
        </Text>
        <Text style={{ color: colors.textMuted, marginBottom: 8 }}>
          {owed
            ? 'you owe this supplier'
            : isNegative(s.balance)
              ? 'advance paid to this supplier'
              : 'nothing owed'}
        </Text>
        {s.contactPerson ? <KeyValue label="Contact" value={s.contactPerson} /> : null}
        <KeyValue label="Mobile" value={s.phone ?? 'Not given'} />
        <KeyValue label="Purchases" value={String(s.purchaseCount)} />
        {s.unpaidPurchaseCount > 0 ? (
          <KeyValue
            label="Unpaid purchases"
            value={`${s.unpaidPurchaseCount} · ${formatINR(s.unpaidPurchasesTotal)}`}
            tone="danger"
          />
        ) : null}
        {!s.isActive ? <Badge text="Switched off: no new purchases" tone="warn" /> : null}
      </Card>

      {can('supplier.payment') ? (
        <Button
          title="Pay this supplier"
          onPress={() => router.push({ pathname: '/supplier/pay', params: { supplierId: s.id } })}
        />
      ) : null}
      {can('purchase.create') && s.isActive ? (
        <Button
          title="New purchase from this supplier"
          variant="secondary"
          onPress={() =>
            router.push({
              pathname: '/purchase/new',
              params: { supplierId: s.id, supplierName: s.name },
            })
          }
        />
      ) : null}
      {can('supplier.manage') ? (
        <Button
          title={s.isActive ? 'Switch this supplier off' : 'Switch this supplier on'}
          variant="secondary"
          onPress={toggleActive}
          busy={busy}
        />
      ) : null}
      <ErrorText message={problem} />

      <SectionTitle>Statement</SectionTitle>
      <Card>
        {ledger.loading ? (
          <Loading />
        ) : ledger.items.length === 0 ? (
          <EmptyState icon="book-outline" title="Nothing yet" />
        ) : (
          ledger.items.map((e) => (
            <KeyValue
              key={e.id}
              label={`${words(e.type)} · ${formatDateTime(e.occurredAt)}`}
              value={`${isPositive(e.amount) ? '+' : '−'}${formatINR(absMoney(e.amount))}`}
              tone={isPositive(e.amount) ? 'danger' : 'success'}
            />
          ))
        )}
        <ListFooter
          shown={ledger.items.length}
          total={ledger.meta?.total}
          loadingMore={ledger.loadingMore}
          onLoadMore={() => void ledger.loadMore()}
        />
      </Card>
    </Screen>
  );
}
