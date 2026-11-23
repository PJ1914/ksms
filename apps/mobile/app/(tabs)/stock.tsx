import { Alert, FlatList, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import { getData, query } from '@/api/client';
import type { ExpiringRow, ProductDetail, StockRow } from '@/api/types';
import { BarcodeScannerModal } from '@/components/BarcodeScannerModal';
import { CategoryChips, type CategoryChipItem } from '@/components/CategoryChips';
import { ListFooter } from '@/components/ListFooter';
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
import { isNetworkFailure } from '@/sync/backoff';
import { getCachedProductByBarcode, listCachedCategories } from '@/sync/cache-store';
import { useSync } from '@/sync/SyncProvider';
import { colors } from '@/theme/colors';
import { friendlyError } from '@/utils/errors';
import { trimZeros } from '@/utils/format';

type Filter = 'all' | 'low' | 'expiring';
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'low', label: 'Low stock' },
  { key: 'expiring', label: 'Expiring' },
] as const;

export default function StockScreen() {
  const { can } = useAuth();
  const { db } = useSync();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const cats = useLoad<CategoryChipItem[]>(
    async () => {
      try {
        const list = await getData<CategoryChipItem[]>('/categories');
        return list.filter((c) => (c.productCount ?? 1) > 0);
      } catch (e) {
        if (isNetworkFailure(e) && db) {
          return (await listCachedCategories(db)).map((c) => ({ id: c.id, name: c.name }));
        }
        return [];
      }
    },
    [db],
    'stock-categories',
  );

  async function onBarcodeScanned(code: string) {
    setScanning(false);
    try {
      let product: ProductDetail | null = null;
      try {
        const res = await getData<{ product: ProductDetail }>(
          `/products/by-barcode/${encodeURIComponent(code)}`,
        );
        product = res.product;
      } catch (err) {
        if (isNetworkFailure(err) && db) {
          product = await getCachedProductByBarcode(db, code);
        } else {
          throw err;
        }
      }
      if (product) {
        router.push({ pathname: '/product/[id]', params: { id: product.id } });
        return;
      }
      promptMissing(code);
    } catch (err) {
      if (can('product.manage') && !isNetworkFailure(err)) {
        promptMissing(code);
      } else {
        Alert.alert('Barcode not found', friendlyError(err));
      }
    }
  }

  function promptMissing(code: string) {
    if (!can('product.manage')) {
      Alert.alert('Barcode not found', `No product matches barcode ${code}.`);
      return;
    }
    Alert.alert(
      'Product not found',
      `No product has barcode ${code}. Would you like to add a new product with this barcode?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add product',
          onPress: () => router.push({ pathname: '/product-new', params: { barcode: code } }),
        },
      ],
    );
  }

  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 12 }}
    >
      {filter !== 'expiring' && (
        <SearchBox
          value={search}
          onChangeText={setSearch}
          placeholder="Search name, SKU or barcode"
          onScan={() => setScanning(true)}
        />
      )}
      <Choice options={FILTERS} value={filter} onChange={setFilter} />
      {filter !== 'expiring' ? (
        <CategoryChips categories={cats.data ?? []} value={categoryId} onChange={setCategoryId} />
      ) : null}
      {filter === 'expiring' ? (
        <ExpiringList />
      ) : (
        <StockList filter={filter} search={search} categoryId={categoryId} />
      )}
      {can('product.manage') && filter !== 'expiring' && (
        <FloatingButton label="Add product" onPress={() => router.push('/product-new')} />
      )}
      <BarcodeScannerModal
        visible={scanning}
        title="Scan product barcode"
        hint="Scan a packet to open its stock page, or add it if it is new."
        onScanned={(code) => void onBarcodeScanned(code)}
        onClose={() => setScanning(false)}
      />
    </View>
  );
}

function StockList({
  filter,
  search,
  categoryId,
}: {
  filter: 'all' | 'low';
  search: string;
  categoryId: string | null;
}) {
  const list = usePagedList<StockRow>(
    `/inventory/balances${query({
      q: search.trim(),
      categoryId: categoryId ?? undefined,
      lowStock: filter === 'low' ? 'true' : undefined,
    })}`,
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
        ListFooterComponent={
          <ListFooter
            shown={list.items.length}
            total={list.meta?.total}
            loadingMore={list.loadingMore}
            onLoadMore={() => void list.loadMore()}
          />
        }
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
