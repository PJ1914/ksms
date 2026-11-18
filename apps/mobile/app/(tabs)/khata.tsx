import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { query } from '@/api/client';
import type { CustomerRow } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
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
import { usePagedList } from '@/hooks/useLoad';
import { colors } from '@/theme/colors';
import { absMoney, formatINR, isNegative, isPositive } from '@/utils/currency';

type Filter = 'all' | 'owes';
const FILTERS = [
  { key: 'all', label: 'All customers' },
  { key: 'owes', label: 'Owe money' },
] as const;

export default function KhataScreen() {
  const { can } = useAuth();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const list = usePagedList<CustomerRow>(
    `/customers${query({ q: search.trim(), owes: filter === 'owes', sort: filter === 'owes' ? 'balance' : 'name', order: filter === 'owes' ? 'desc' : 'asc' })}`,
  );

  if (!can('customer.read'))
    return (
      <EmptyState icon="lock-closed-outline" title="Customers are not available for your role" />
    );

  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 12 }}
    >
      <SearchBox
        value={search}
        onChangeText={setSearch}
        placeholder="Search name or mobile number"
      />
      <Choice options={FILTERS} value={filter} onChange={setFilter} />
      {list.loading ? (
        <Loading />
      ) : (
        <>
          <ErrorText message={list.error} />
          <FlatList
            data={list.items}
            keyExtractor={(c) => c.id}
            contentContainerStyle={list.items.length ? { paddingBottom: 96 } : undefined}
            refreshing={list.refreshing}
            onRefresh={() => void list.reload(true)}
            onEndReachedThreshold={0.5}
            onEndReached={() => void list.loadMore()}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            ListEmptyComponent={
              <EmptyState
                icon="people-outline"
                title={
                  filter === 'owes'
                    ? 'Nobody owes you money'
                    : search.trim()
                      ? 'No customers match'
                      : 'No customers yet'
                }
                note={filter === 'all' && !search.trim() ? 'Tap + to add a customer.' : undefined}
              />
            }
            renderItem={({ item }) => (
              <ListRow
                title={item.name}
                subtitle={item.phone ?? 'No mobile number'}
                right={
                  isPositive(item.balance) ? (
                    <Badge text={formatINR(item.balance)} tone="warn" />
                  ) : isNegative(item.balance) ? (
                    <Badge text={`Advance ${formatINR(absMoney(item.balance))}`} tone="good" />
                  ) : (
                    <Badge text="Clear" />
                  )
                }
                rightSub={item.isActive ? undefined : 'Switched off'}
                onPress={() => router.push({ pathname: '/customer/[id]', params: { id: item.id } })}
              />
            )}
          />
        </>
      )}
      {can('customer.manage') ? (
        <FloatingButton label="Add customer" onPress={() => router.push('/customer-new')} />
      ) : null}
    </View>
  );
}
