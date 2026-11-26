import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { query } from '@/api/client';
import type { CustomerRow } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { useCart } from '@/cart/CartProvider';
import {
  Avatar,
  Badge,
  Button,
  EmptyState,
  ErrorText,
  ListRow,
  Loading,
  pageStyle,
  SearchBox,
} from '@/components/ui';
import { illustrations } from '@/theme/art';
import { usePagedList } from '@/hooks/useLoad';
import { searchCachedCustomers } from '@/sync/cache-store';
import { useSync } from '@/sync/SyncProvider';
import { colors } from '@/theme/colors';
import { formatINR, isPositive } from '@/utils/currency';

/** Choose who the bill is for. Walk-in customers must pay in full; a named customer can take credit (khata). */
export default function ChooseCustomerScreen() {
  const { setCustomer, cart } = useCart();
  const { can } = useAuth();
  const { db } = useSync();
  const [search, setSearch] = useState('');
  const list = usePagedList<CustomerRow>(
    `/customers${query({ q: search.trim(), isActive: true })}`,
    30,
    db ? () => searchCachedCustomers(db, { q: search, activeOnly: true }) : undefined,
  );

  return (
    <View style={pageStyle}>
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
            ListHeaderComponent={
              search.trim() && can('customer.manage') ? (
                <View style={{ marginBottom: 8 }}>
                  <ListRow
                    icon="person-add-outline"
                    tint="green"
                    title={`Add “${search.trim()}” as a new customer`}
                    subtitle="Saves them and puts them on this bill"
                    onPress={() =>
                      router.push({
                        pathname: '/customer-new',
                        params: { name: search.trim(), forBill: '1' },
                      })
                    }
                  />
                </View>
              ) : undefined
            }
            ListEmptyComponent={
              search.trim() ? undefined : (
                <EmptyState
                  art={illustrations.emptyCustomers}
                  title="No customers yet"
                  note="Type a name above to add one."
                />
              )
            }
            ListFooterComponent={
              can('customer.manage') ? (
                <View style={{ marginTop: 12, marginBottom: 24 }}>
                  <Button
                    title="Add a new customer"
                    icon="person-add-outline"
                    variant="secondary"
                    onPress={() =>
                      router.push({ pathname: '/customer-new', params: { forBill: '1' } })
                    }
                  />
                </View>
              ) : undefined
            }
            renderItem={({ item }) => (
              <ListRow
                leading={<Avatar name={item.name} />}
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
