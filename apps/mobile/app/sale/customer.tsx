import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { query } from '@/api/client';
import type { CustomerRow } from '@/api/types';
import { useCart } from '@/cart/CartProvider';
import { Badge, Button, EmptyState, ErrorText, ListRow, Loading, SearchBox } from '@/components/ui';
import { usePagedList } from '@/hooks/useLoad';
import { searchCachedCustomers } from '@/sync/cache-store';
import { useSync } from '@/sync/SyncProvider';
import { colors } from '@/theme/colors';
import { formatINR, isPositive } from '@/utils/currency';

/** Choose who the bill is for. Walk-in customers must pay in full; a named customer can take credit (khata). */
export default function ChooseCustomerScreen() {
  const { setCustomer, cart } = useCart();
  const { db } = useSync();
  const [search, setSearch] = useState('');
  const list = usePagedList<CustomerRow>(
    `/customers${query({ q: search.trim(), isActive: true })}`,
    30,
    db ? () => searchCachedCustomers(db, { q: search, activeOnly: true }) : undefined,
  );

  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 12 }}
    >
      <Stack.Screen options={{ title: 'Who is this bill for?' }} />
      <SearchBox
        value={search}
        onChangeText={setSearch}
        placeholder="Search name or mobile number"
      />
      <Button
        title={cart.customerId ? 'Walk-in customer (remove customer)' : 'Walk-in customer'}
        variant="secondary"
        onPress={() => {
          setCustomer(null, null);
          router.back();
        }}
      />
      {list.loading ? (
        <Loading />
      ) : (
        <>
          {list.fromCache ? (
            <Text style={{ color: colors.warning, fontSize: 13, marginTop: 6 }}>
              Offline — showing saved customers from this phone.
            </Text>
          ) : null}
          <ErrorText message={list.error} />
          <FlatList
            data={list.items}
            keyExtractor={(c) => c.id}
            keyboardShouldPersistTaps="handled"
            style={{ marginTop: 8 }}
            onEndReachedThreshold={0.5}
            onEndReached={() => void list.loadMore()}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            ListEmptyComponent={
              <EmptyState
                icon="people-outline"
                title="No customers found"
                note="Add the customer first, then choose them here."
              />
            }
            ListFooterComponent={
              <View style={{ marginTop: 12, marginBottom: 24 }}>
                <Button
                  title="Add a new customer"
                  variant="secondary"
                  onPress={() => router.push('/customer-new')}
                />
              </View>
            }
            renderItem={({ item }) => (
              <ListRow
                title={item.name}
                subtitle={item.phone ?? 'No mobile number'}
                right={
                  isPositive(item.balance) ? (
                    <Badge text={`Owes ${formatINR(item.balance)}`} tone="warn" />
                  ) : (
                    <Text style={{ color: colors.textMuted }}>Clear</Text>
                  )
                }
                rightSub={item.creditLimit ? `Limit ${formatINR(item.creditLimit)}` : undefined}
                onPress={() => {
                  setCustomer(item.id, item.name);
                  router.back();
                }}
              />
            )}
          />
        </>
      )}
    </View>
  );
}
