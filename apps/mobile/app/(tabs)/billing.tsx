import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, View } from 'react-native';
import { query } from '@/api/client';
import type { HeldBill, SaleRow } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { useCart } from '@/cart/CartProvider';
import { ListFooter } from '@/components/ListFooter';
import { SyncBanner } from '@/components/SyncBanner';
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
import { listLocalHeldBills } from '@/sync/cache-store';
import { useSync } from '@/sync/SyncProvider';
import { colors } from '@/theme/colors';
import { formatINR, isPositive } from '@/utils/currency';
import { formatDateTime } from '@/utils/format';
import { todayInIndia } from '@/utils/today';

export default function BillingScreen() {
  const { can, branch } = useAuth();
  const { cart } = useCart();
  const { db } = useSync();
  const [localUnsyncedCount, setLocalUnsyncedCount] = useState(0);
  const today = todayInIndia();
  const canRead = can('sale.read');
  const canCreate = can('sale.create');
  const bills = usePagedList<SaleRow>(
    canRead ? `/sales${query({ from: today, to: today })}` : null,
    20,
  );
  const held = usePagedList<HeldBill>(canCreate ? '/held-bills' : null, 1, async () => []);

  useFocusEffect(
    useCallback(() => {
      if (!db || !branch || !canCreate) {
        setLocalUnsyncedCount(0);
        return;
      }
      void listLocalHeldBills(db, branch.id)
        .then((rows) => setLocalUnsyncedCount(rows.filter((r) => !r.serverId).length))
        .catch(() => setLocalUnsyncedCount(0));
    }, [db, branch, canCreate]),
  );

  const totalHeld = (held.meta?.total ?? 0) + localUnsyncedCount;

  if (!canCreate && !canRead) {
    return <EmptyState icon="lock-closed-outline" title="Billing is not available for your role" />;
  }

  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 12 }}
    >
      <SyncBanner />
      {canCreate ? (
        <>
          <Button
            title={
              cart.lines.length ? `Continue the bill (${cart.lines.length} items)` : 'New bill'
            }
            onPress={() => router.push('/sale/new')}
          />
          {totalHeld > 0 ? (
            <Button
              title={`Held bills (${totalHeld})`}
              variant="secondary"
              onPress={() => router.push('/held-bills')}
            />
          ) : null}
        </>
      ) : null}

      {canRead ? (
        <>
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
                ListFooterComponent={
                  <ListFooter
                    shown={bills.items.length}
                    total={bills.meta?.total}
                    loadingMore={bills.loadingMore}
                    onLoadMore={() => void bills.loadMore()}
                  />
                }
                ListEmptyComponent={
                  <EmptyState icon="receipt-outline" title="No bills yet today" />
                }
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
        </>
      ) : null}
    </View>
  );
}
