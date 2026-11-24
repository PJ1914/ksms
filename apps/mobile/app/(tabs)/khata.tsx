import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { query } from '@/api/client';
import type { CustomerRow } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
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

type Filter = 'all' | 'owes';
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'owes', label: 'Owe money' },
] as const;

export default function KhataScreen() {
  const { can } = useAuth();
  const { db } = useSync();
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const list = usePagedList<CustomerRow>(
    `/customers${query({ q: search.trim(), owes: filter === 'owes', sort: filter === 'owes' ? 'balance' : 'name', order: filter === 'owes' ? 'desc' : 'asc' })}`,
    30,
    db ? () => searchCachedCustomers(db, { q: search, owes: filter === 'owes' }) : undefined,
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
                    filter === 'owes'
                      ? illustrations.duesCleared
                      : search.trim()
                        ? illustrations.emptySearch
                        : illustrations.emptyCustomers
                  }
                  title={
                    filter === 'owes'
                      ? 'Nobody owes you money'
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
                  onPress={() =>
                    router.push({ pathname: '/customer/[id]', params: { id: item.id } })
                  }
                />
              )}
            />
          </>
        )}
      </Page>
    </View>
  );
}
