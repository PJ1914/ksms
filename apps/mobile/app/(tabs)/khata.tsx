import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { query } from '@/api/client';
import type { CustomerRow } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { CustomerDetail } from '../customer/[id]';
import { MasterDetail, useOpenDetail } from '@/components/MasterDetail';
import { OptionChips } from '@/components/CategoryChips';
import { ListFooter } from '@/components/ListFooter';
import {
  Avatar,
  Badge,
  EmptyState,
  ErrorText,
  ListRow,
  Loading,
  SearchBox,
  Segmented,
  TabHeader,
  Page,
} from '@/components/ui';
import { illustrations } from '@/theme/art';
import { usePagedList } from '@/hooks/useLoad';
import { searchCachedCustomers } from '@/sync/cache-store';
import { useSync } from '@/sync/SyncProvider';
import { colors } from '@/theme/colors';
import { absMoney, formatINR, isNegative, isPositive } from '@/utils/currency';

type Filter = 'all' | 'owes' | 'advance';
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'owes', label: 'Owe money' },
  { key: 'advance', label: 'Paid ahead' },
] as const;

type SortKey = 'az' | 'za' | 'most' | 'least' | 'new' | 'old';
const SORTS: Record<
  SortKey,
  { label: string; sort: 'name' | 'balance' | 'createdAt'; order: 'asc' | 'desc' }
> = {
  az: { label: 'Name A–Z', sort: 'name', order: 'asc' },
  za: { label: 'Name Z–A', sort: 'name', order: 'desc' },
  most: { label: 'Owes most', sort: 'balance', order: 'desc' },
  least: { label: 'Owes least', sort: 'balance', order: 'asc' },
  new: { label: 'New to old', sort: 'createdAt', order: 'desc' },
  old: { label: 'Old to new', sort: 'createdAt', order: 'asc' },
};

const SORT_OPTIONS = (Object.keys(SORTS) as SortKey[]).map((k) => ({
  key: k,
  label: SORTS[k].label,
}));

export default function KhataScreen() {
  return (
    <MasterDetail
      renderDetail={(id) => <CustomerDetail id={id} embedded />}
      emptyTitle="Choose a customer"
      emptyNote="Their khata, bills and payments appear here."
    >
      <KhataList />
    </MasterDetail>
  );
}

function KhataList() {
  const open = useOpenDetail('/customer/[id]');
  const { can } = useAuth();
  const { db } = useSync();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('az');
  const s = SORTS[sortKey];
  const list = usePagedList<CustomerRow>(
    `/customers${query({ q: search.trim(), owes: filter === 'owes', advance: filter === 'advance', sort: s.sort, order: s.order })}`,
    30,
    db
      ? () =>
          searchCachedCustomers(db, {
            q: search,
            owes: filter === 'owes',
            advance: filter === 'advance',
            sort: s.sort,
            order: s.order,
          })
      : undefined,
  );

  if (!can('customer.read'))
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <TabHeader title="Khata" />
        <EmptyState
          art={illustrations.roleLocked}
          title="Customers are not available for your role"
          note="Ask the shop owner if you need access."
        />
      </View>
    );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TabHeader
        title="Khata"
        subtitle="Who owes you, and how much"
        action={
          can('customer.manage')
            ? { label: 'Customer', onPress: () => router.push('/customer-new') }
            : undefined
        }
      />
      <Page>
        <SearchBox
          value={search}
          onChangeText={setSearch}
          placeholder="Search name or mobile number"
        />
        <Segmented options={FILTERS} value={filter} onChange={setFilter} />
        <OptionChips options={SORT_OPTIONS} value={sortKey} onChange={setSortKey} />
        {list.loading ? (
          <Loading />
        ) : (
          <>
            {list.fromCache ? (
              <Text
                style={{ color: colors.warning, fontSize: 13, marginBottom: 8, fontWeight: '600' }}
              >
                Offline — showing saved customers from this phone.
              </Text>
            ) : null}
            <ErrorText message={list.error} />
            <FlatList
              data={list.items}
              keyExtractor={(c) => c.id}
              contentContainerStyle={{ paddingBottom: 24 }}
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
                  fromCache={list.fromCache}
                  onLoadMore={() => void list.loadMore()}
                />
              }
              ListEmptyComponent={
                <EmptyState
                  art={
                    filter === 'owes' || filter === 'advance'
                      ? illustrations.duesCleared
                      : search.trim()
                        ? illustrations.emptySearch
                        : illustrations.emptyCustomers
                  }
                  title={
                    filter === 'owes'
                      ? 'Nobody owes you money'
                      : filter === 'advance'
                        ? 'Nobody has paid ahead'
                        : search.trim()
                          ? 'No customers match'
                          : 'No customers yet'
                  }
                  note={
                    filter === 'all' && !search.trim()
                      ? 'Tap “+ Customer” at the top to add your first customer.'
                      : undefined
                  }
                />
              }
              renderItem={({ item }) => (
                <ListRow
                  leading={<Avatar name={item.name} />}
                  title={item.name}
                  subtitle={item.phone ?? 'No mobile number'}
                  right={
                    isPositive(item.balance) ? (
                      <Text style={{ fontSize: 16, fontWeight: '800', color: colors.danger }}>
                        {formatINR(item.balance)}
                      </Text>
                    ) : isNegative(item.balance) ? (
                      <Badge text={`Advance ${formatINR(absMoney(item.balance))}`} tone="good" />
                    ) : (
                      <Badge text="All clear" tone="good" />
                    )
                  }
                  rightSub={item.isActive ? undefined : 'Switched off'}
                  onPress={() => open(item.id)}
                />
              )}
            />
          </>
        )}
      </Page>
    </View>
  );
}
