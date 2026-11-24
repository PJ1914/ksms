import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import { getData, postData } from '@/api/client';
import type { LedgerEntry, SupplierDetail } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { ListFooter } from '@/components/ListFooter';
import {
  Avatar,
  Badge,
  EmptyState,
  EntryRow,
  ErrorText,
  Group,
  Hero,
  Loading,
  QuickActions,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { illustrations } from '@/theme/art';
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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <Avatar name={s.name} size={56} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>{s.name}</Text>
          <Text style={{ fontSize: 14, color: colors.textMuted }}>
            {[s.contactPerson, s.phone].filter(Boolean).join(' · ') || 'No contact details'}
          </Text>
        </View>
        {!s.isActive ? <Badge text="Switched off" tone="warn" /> : null}
      </View>

      <Hero
        label={owed ? 'You owe' : isNegative(s.balance) ? 'Advance paid' : 'All settled'}
        value={formatINR(isNegative(s.balance) ? absMoney(s.balance) : s.balance)}
        valueTone={owed ? 'danger' : 'success'}
        tint={owed ? 'mango' : 'green'}
        art={illustrations.supplierTruck}
        sub={`${s.purchaseCount} purchase${s.purchaseCount === 1 ? '' : 's'}${
          s.unpaidPurchaseCount > 0
            ? ` · ${s.unpaidPurchaseCount} unpaid (${formatINR(s.unpaidPurchasesTotal)})`
            : ''
        }`}
      />

      <QuickActions
        actions={[
          {
            label: 'Pay',
            icon: 'cash-outline',
            primary: true,
            hidden: !can('supplier.payment'),
            onPress: () => router.push({ pathname: '/supplier/pay', params: { supplierId: s.id } }),
          },
          {
            label: 'New purchase',
            icon: 'cart-outline',
            hidden: !(can('purchase.create') && s.isActive),
            onPress: () =>
              router.push({
                pathname: '/purchase/new',
                params: { supplierId: s.id, supplierName: s.name },
              }),
          },
          {
            label: 'Call',
            icon: 'call-outline',
            hidden: !s.phone,
            onPress: () => void Linking.openURL(`tel:${s.phone}`),
          },
          {
            label: s.isActive ? 'Switch off' : 'Switch on',
            icon: s.isActive ? 'pause-circle-outline' : 'play-circle-outline',
            hidden: !can('supplier.manage') || busy,
            onPress: () => void toggleActive(),
          },
        ]}
      />
      <ErrorText message={problem} />

      <SectionTitle>Statement</SectionTitle>
      {ledger.loading ? (
        <Loading />
      ) : ledger.items.length === 0 ? (
        <EmptyState art={illustrations.emptySuppliers} title="Nothing yet" />
      ) : (
        <Group>
          {ledger.items.map((e) => (
            <EntryRow
              key={e.id}
              title={e.description || words(e.type)}
              subtitle={`${e.description ? `${words(e.type)} · ` : ''}${formatDateTime(e.occurredAt)}`}
              amount={`${isPositive(e.amount) ? '+' : '−'}${formatINR(absMoney(e.amount))}`}
              direction={isPositive(e.amount) ? 'out' : 'in'}
            />
          ))}
        </Group>
      )}
      <ListFooter
        shown={ledger.items.length}
        total={ledger.meta?.total}
        loadingMore={ledger.loadingMore}
        onLoadMore={() => void ledger.loadMore()}
      />
    </Screen>
  );
}
