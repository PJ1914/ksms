import { router } from 'expo-router';
import { FlatList, View } from 'react-native';
import { query } from '@/api/client';
import type { HeldBill, SaleRow } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { useCart } from '@/cart/CartProvider';
import {
  Badge,
  Button,
  EmptyState,
  ErrorText,
  ListRow,
  Loading,
  SectionTitle,
} from '@/components/ui';
import { usePagedList } from '@/hooks/useLoad';
import { colors } from '@/theme/colors';
import { formatINR, isPositive } from '@/utils/currency';
import { formatDateTime } from '@/utils/format';
import { todayInIndia } from '@/utils/today';

export default function BillingScreen() {
  const { can } = useAuth();
  const { cart } = useCart();
  const today = todayInIndia();
  const bills = usePagedList<SaleRow>(`/sales${query({ from: today, to: today })}`, 20);
  const held = usePagedList<HeldBill>('/held-bills', 1);

  if (!can('sale.create') && !can('sale.read')) {
    return <EmptyState icon="lock-closed-outline" title="Billing is not available for your role" />;
  }

  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 12 }}
    >
      {can('sale.create') ? (
        <>
          <Button
            title={
              cart.lines.length ? `Continue the bill (${cart.lines.length} items)` : 'New bill'
            }
            onPress={() => router.push('/sale/new')}
          />
          {(held.meta?.total ?? 0) > 0 ? (
            <Button
              title={`Held bills (${held.meta!.total})`}
              variant="secondary"
              onPress={() => router.push('/held-bills')}
            />
          ) : null}
        </>
      ) : null}

      <SectionTitle>Today’s bills</SectionTitle>
      {bills.loading ? (
        <Loading />
      ) : (
        <>
          <ErrorText message={bills.error} />
          <FlatList
            data={bills.items}
            keyExtractor={(s) => s.id}
            refreshing={bills.refreshing}
            onRefresh={() => void bills.reload(true)}
            onEndReachedThreshold={0.5}
            onEndReached={() => void bills.loadMore()}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            ListEmptyComponent={<EmptyState icon="receipt-outline" title="No bills yet today" />}
            renderItem={({ item }) => (
              <ListRow
                title={item.saleNumber}
                subtitle={`${formatDateTime(item.soldAt)} · ${item.customer?.name ?? 'Walk-in'}`}
                right={
                  item.status === 'CANCELLED' ? (
                    <Badge text="Cancelled" tone="bad" />
                  ) : (
                    <View style={{ alignItems: 'flex-end' }}>
                      <Badge text={formatINR(item.total)} tone="good" />
                      {isPositive(item.creditAmount) ? (
                        <Badge text={`Khata ${formatINR(item.creditAmount)}`} tone="warn" />
                      ) : null}
                    </View>
                  )
                }
                onPress={() => router.push({ pathname: '/sale/[id]', params: { id: item.id } })}
              />
            )}
          />
        </>
      )}
    </View>
  );
}
