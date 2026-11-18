import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { getData, getPage, postData } from '@/api/client';
import type { LedgerEntry, SupplierDetail } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
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
import { useLoad } from '@/hooks/useLoad';
import { colors } from '@/theme/colors';
import { absMoney, formatINR, isNegative, isPositive } from '@/utils/currency';
import { friendlyError } from '@/utils/errors';
import { formatDateTime, words } from '@/utils/format';

export default function SupplierScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const { data, loading, error, refreshing, reload } = useLoad(async () => {
    const supplier = await getData<SupplierDetail>(`/suppliers/${id}`);
    const ledger = await getPage<LedgerEntry>(`/suppliers/${id}/ledger?pageSize=30`);
    return { supplier, ledger };
  }, [id]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (!data) return <ErrorText message={error ?? 'Could not load this supplier.'} />;
  const { supplier: s, ledger } = data;
  const owed = isPositive(s.balance);

  async function toggleActive() {
    setBusy(true);
    setProblem(null);
    try {
      await postData(`/suppliers/${id}/${s.isActive ? 'deactivate' : 'reactivate'}`);
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
        {ledger.data.length === 0 ? (
          <EmptyState icon="book-outline" title="Nothing yet" />
        ) : (
          ledger.data.map((e) => (
            <KeyValue
              key={e.id}
              label={`${words(e.type)} · ${formatDateTime(e.occurredAt)}`}
              value={`${isPositive(e.amount) ? '+' : '−'}${formatINR(absMoney(e.amount))}`}
              tone={isPositive(e.amount) ? 'danger' : 'success'}
            />
          ))
        )}
      </Card>
    </Screen>
  );
}
