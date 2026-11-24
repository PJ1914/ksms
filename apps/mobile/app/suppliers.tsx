import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { query } from '@/api/client';
import type { SupplierRow } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import {
  Avatar,
  Badge,
  EmptyState,
  ErrorText,
  FloatingButton,
  ListRow,
  Loading,
  pageStyle,
  SearchBox,
  Segmented,
} from '@/components/ui';
import { illustrations } from '@/theme/art';
import { usePagedList } from '@/hooks/useLoad';
import { absMoney, formatINR, isNegative, isPositive } from '@/utils/currency';

type Filter = 'all' | 'owed';
const FILTERS = [
  { key: 'all', label: 'All suppliers' },
  { key: 'owed', label: 'I owe money' },
] as const;

export default function SuppliersScreen() {
  const { can } = useAuth();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const list = usePagedList<SupplierRow>(
    `/suppliers${query({ q: search.trim(), owed: filter === 'owed', sort: filter === 'owed' ? 'balance' : 'name', order: filter === 'owed' ? 'desc' : 'asc' })}`,
  );
  return (
    <View style={pageStyle}>
      <Stack.Screen options={{ title: 'Suppliers' }} />
      <SearchBox
        value={search}
        onChangeText={setSearch}
        placeholder="Search name or mobile number"
      />
      <Segmented options={FILTERS} value={filter} onChange={setFilter} />
      {list.loading ? (
        <Loading />
      ) : (
        <>
          <ErrorText message={list.error} />
          <FlatList
            data={list.items}
            keyExtractor={(s) => s.id}
            contentContainerStyle={list.items.length ? { paddingBottom: 96 } : undefined}
            refreshing={list.refreshing}
            onRefresh={() => void list.reload(true)}
            onEndReachedThreshold={0.5}
            onEndReached={() => void list.loadMore()}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            ListEmptyComponent={
              <EmptyState
                art={illustrations.emptySuppliers}
                title={
                  filter === 'owed'
                    ? 'You owe no supplier anything'
                    : search.trim()
                      ? 'No suppliers match'
                      : 'No suppliers yet'
                }
                note={filter === 'all' && !search.trim() ? 'Tap + to add a supplier.' : undefined}
              />
            }
            renderItem={({ item }) => (
              <ListRow
                leading={<Avatar name={item.name} />}
                title={item.name}
                subtitle={item.contactPerson ?? item.phone ?? undefined}
                right={
                  isPositive(item.balance) ? (
                    <Badge text={`You owe ${formatINR(item.balance)}`} tone="warn" />
                  ) : isNegative(item.balance) ? (
                    <Badge text={`Advance ${formatINR(absMoney(item.balance))}`} tone="good" />
                  ) : (
                    <Badge text="Clear" />
                  )
                }
                rightSub={item.isActive ? undefined : 'Switched off'}
                onPress={() => router.push({ pathname: '/supplier/[id]', params: { id: item.id } })}
              />
            )}
          />
        </>
      )}
      {can('supplier.manage') ? (
        <FloatingButton label="Add supplier" onPress={() => router.push('/supplier-new')} />
      ) : null}
    </View>
  );
}
