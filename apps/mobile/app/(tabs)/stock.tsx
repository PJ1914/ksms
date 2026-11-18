import { FlatList, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { getData, query } from '@/api/client';
import type { ExpiringRow, StockRow } from '@/api/types';
import {
  Badge,
  Choice,
  EmptyState,
  ErrorText,
  FloatingButton,
  ListRow,
  Loading,
  SearchBox,
} from '@/components/ui';
import { useLoad, usePagedList } from '@/hooks/useLoad';
import { colors } from '@/theme/colors';
import { trimZeros } from '@/utils/format';

type Filter = 'all' | 'low' | 'expiring';
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'low', label: 'Low stock' },
  { key: 'expiring', label: 'Expiring' },
] as const;

export default function StockScreen() {
  const { can } = useAuth();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');

  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 12 }}
    >
      {filter !== 'expiring' && (
        <SearchBox
          value={search}
          onChangeText={setSearch}
          placeholder="Search name, SKU or barcode"
        />
      )}
      <Choice options={FILTERS} value={filter} onChange={setFilter} />
      {filter === 'expiring' ? <ExpiringList /> : <StockList filter={filter} search={search} />}
      {can('product.manage') && filter !== 'expiring' && (
        <FloatingButton label="Add product" onPress={() => router.push('/product-new')} />
      )}
    </View>
  );
}

function StockList({ filter, search }: { filter: 'all' | 'low'; search: string }) {
  const list = usePagedList<StockRow>(
    `/inventory/balances${query({ q: search.trim(), lowStock: filter === 'low' ? 'true' : undefined })}`,
  );
  if (list.loading) return <Loading />;
  return (
    <>
      <ErrorText message={list.error} />
      <FlatList
        data={list.items}
        keyExtractor={(p) => p.productId}
        contentContainerStyle={list.items.length ? { paddingBottom: 96 } : undefined}
        refreshing={list.refreshing}
        onRefresh={() => void list.reload(true)}
        onEndReachedThreshold={0.5}
        onEndReached={() => void list.loadMore()}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={
          <EmptyState
            icon="cube-outline"
            title={
              filter === 'low'
                ? 'Nothing is running low'
                : search.trim()
                  ? 'No products match your search'
                  : 'No products yet'
            }
            note={
              filter === 'all' && !search.trim() ? 'Tap + to add your first product.' : undefined
            }
          />
        }
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={item.sku}
            right={
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: '700',
                  color: item.isLowStock ? colors.danger : colors.text,
                }}
              >
                {trimZeros(item.quantityOnHand)} {item.baseUnitCode}
              </Text>
            }
            rightSub={item.isLowStock ? 'Low stock' : undefined}
            onPress={() =>
              router.push({ pathname: '/product/[id]', params: { id: item.productId } })
            }
          />
        )}
      />
    </>
  );
}

function ExpiringList() {
  const { data, loading, error, refreshing, reload } = useLoad(
    () => getData<ExpiringRow[]>('/inventory/expiring?withinDays=30'),
    [],
  );
  if (loading) return <Loading />;
  return (
    <>
      <ErrorText message={error} />
      <FlatList
        data={data ?? []}
        keyExtractor={(b) => b.batchId}
        refreshing={refreshing}
        onRefresh={() => void reload(true)}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={
          <EmptyState icon="checkmark-circle-outline" title="Nothing expires in the next 30 days" />
        }
        renderItem={({ item }) => (
          <ListRow
            title={item.product.name}
            subtitle={`Batch ${item.batchNumber} · expires ${item.expiryDate}`}
            right={
              <Badge
                text={item.isExpired ? 'Expired' : `${item.daysToExpiry} days`}
                tone={item.isExpired ? 'bad' : 'warn'}
              />
            }
            rightSub={`${trimZeros(item.quantity)} ${item.product.baseUnitCode}`}
            onPress={() =>
              router.push({ pathname: '/product/[id]', params: { id: item.product.id } })
            }
          />
        )}
      />
    </>
  );
}
