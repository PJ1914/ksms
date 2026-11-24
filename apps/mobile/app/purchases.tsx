import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { query } from '@/api/client';
import type { PurchaseRow } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import {
  Badge,
  EmptyState,
  ErrorText,
  FloatingButton,
  ListRow,
  Loading,
  pageStyle,
  Segmented,
} from '@/components/ui';
import { icons, illustrations } from '@/theme/art';
import { usePagedList } from '@/hooks/useLoad';
import { formatINR, isPositive } from '@/utils/currency';
import { formatDate, purchaseTone, words } from '@/utils/format';

type Filter = 'all' | 'waiting' | 'unpaid';
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'waiting', label: 'Waiting for goods' },
  { key: 'unpaid', label: 'Unpaid' },
] as const;

export default function PurchasesScreen() {
  const { can } = useAuth();
  const [filter, setFilter] = useState<Filter>('all');
  const list = usePagedList<PurchaseRow>(
    `/purchases${query({ unpaid: filter === 'unpaid', status: filter === 'waiting' ? 'CONFIRMED' : undefined })}`,
  );
  return (
    <View style={pageStyle}>
      <Stack.Screen options={{ title: 'Purchases' }} />
      <Segmented options={FILTERS} value={filter} onChange={setFilter} />
      {list.loading ? (
        <Loading />
      ) : (
        <>
          <ErrorText message={list.error} />
          <FlatList
            data={list.items}
            keyExtractor={(p) => p.id}
            contentContainerStyle={list.items.length ? { paddingBottom: 96 } : undefined}
            refreshing={list.refreshing}
            onRefresh={() => void list.reload(true)}
            onEndReachedThreshold={0.5}
            onEndReached={() => void list.loadMore()}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            ListEmptyComponent={
              <EmptyState
                art={illustrations.emptyPurchases}
                title="No purchases here"
                note={filter === 'all' ? 'Tap + to record goods you bought.' : undefined}
              />
            }
            renderItem={({ item }) => (
              <ListRow
                art={icons.repPurchases}
                tint="mango"
                title={`${item.supplier.name}`}
                subtitle={`${item.purchaseNumber} · ${formatDate(item.purchaseDate)}`}
                right={<Badge text={words(item.status)} tone={purchaseTone(item.status)} />}
                rightSub={
                  isPositive(item.outstanding)
                    ? `${formatINR(item.total)} · due ${formatINR(item.outstanding)}`
                    : formatINR(item.total)
                }
                onPress={() => router.push({ pathname: '/purchase/[id]', params: { id: item.id } })}
              />
            )}
          />
        </>
      )}
      {can('purchase.create') ? (
        <FloatingButton label="New purchase" onPress={() => router.push('/purchase/new')} />
      ) : null}
    </View>
  );
}
