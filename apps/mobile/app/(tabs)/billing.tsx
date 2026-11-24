import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { illustrations } from '@/theme/art';
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
  TabHeader,
  Page,
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
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <TabHeader title="Bills" />
        <EmptyState
          art={illustrations.roleLocked}
          title="Billing is not available for your role"
          note="Ask the shop owner if you need access."
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TabHeader title="Bills" subtitle="Everything billed today" />
      <Page>
        <SyncBanner />
        {canCreate ? (
          <>
            <Button
              icon={cart.lines.length ? 'receipt-outline' : 'add'}
              title={
                cart.lines.length ? `Continue the bill (${cart.lines.length} items)` : 'New bill'
              }
              onPress={() => router.push('/sale/new')}
            />
            {totalHeld > 0 ? (
              <Button
                icon="pause"
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
                  contentContainerStyle={{ paddingBottom: 24 }}
                  ListEmptyComponent={
                    <EmptyState
                      art={illustrations.emptyBills}
                      title="No bills yet today"
                      note="Your first bill of the day will show up here."
                    />
                  }
                  renderItem={({ item }) => (
                    <ListRow
                      icon="receipt-outline"
                      tint={item.status === 'CANCELLED' ? 'tomato' : 'green'}
                      title={item.saleNumber}
                      subtitle={`${formatDateTime(item.soldAt)} · ${item.customer?.name ?? 'Walk-in'}`}
                      right={
                        item.status === 'CANCELLED' ? (
                          <Badge text="Cancelled" tone="bad" />
                        ) : (
                          <View style={{ alignItems: 'flex-end', gap: 4 }}>
                            <Text style={{ fontSize: 16, fontWeight: '800', color: colors.text }}>
                              {formatINR(item.total)}
                            </Text>
                            {isPositive(item.creditAmount) ? (
                              <Badge text={`Khata ${formatINR(item.creditAmount)}`} tone="warn" />
                            ) : null}
                          </View>
                        )
                      }
                      onPress={() =>
                        router.push({ pathname: '/sale/[id]', params: { id: item.id } })
                      }
                    />
                  )}
                />
              </>
            )}
          </>
        ) : null}
      </Page>
    </View>
  );
}
