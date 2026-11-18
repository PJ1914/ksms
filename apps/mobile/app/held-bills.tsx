import { router, Stack } from 'expo-router';
import { Alert, FlatList, View } from 'react-native';
import { parseHeldCart } from '@ksms/validation';
import { deleteData } from '@/api/client';
import type { HeldBill } from '@/api/types';
import { useCart } from '@/cart/CartProvider';
import { Button, EmptyState, ErrorText, ListRow, Loading } from '@/components/ui';
import { usePagedList } from '@/hooks/useLoad';
import { colors } from '@/theme/colors';
import { friendlyError } from '@/utils/errors';
import { formatDateTime } from '@/utils/format';
import { useState } from 'react';

/** Carts parked at this branch's counter. Picking one puts it back on the bill. */
export default function HeldBillsScreen() {
  const list = usePagedList<HeldBill>('/held-bills');
  const { cart, load } = useCart();
  const [error, setError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState<string | null>(null);

  function resume(h: HeldBill) {
    const parsed = parseHeldCart(h.payload);
    if (!parsed) return setError('This held bill cannot be opened.');
    const open = () => {
      load({ ...parsed, heldBillId: h.id });
      router.replace('/sale/new');
    };
    if (cart.lines.length > 0) {
      Alert.alert(
        'Replace the current bill?',
        'The bill on the counter now will be cleared (hold it first to keep it).',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Replace', style: 'destructive', onPress: open },
        ],
      );
    } else open();
  }

  async function discard(h: HeldBill) {
    if (discarding) return;
    setDiscarding(h.id);
    try {
      await deleteData(`/held-bills/${h.id}`);
      void list.reload();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setDiscarding(null);
    }
  }

  if (list.loading) return <Loading />;
  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 12 }}
    >
      <Stack.Screen options={{ title: 'Held bills' }} />
      <ErrorText message={error ?? list.error} />
      <FlatList
        data={list.items}
        keyExtractor={(h) => h.id}
        refreshing={list.refreshing}
        onRefresh={() => void list.reload(true)}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={
          <EmptyState
            icon="pause-circle-outline"
            title="No held bills"
            note="On a bill, tap “Hold this bill for later” to park it."
          />
        }
        renderItem={({ item }) => {
          const c = parseHeldCart(item.payload);
          return (
            <View>
              <ListRow
                title={item.label ?? 'Held bill'}
                subtitle={`${c?.lines.length ?? 0} items · ${formatDateTime(item.createdAt)}`}
                onPress={() => resume(item)}
              />
              <Button
                title="Discard"
                variant="secondary"
                busy={discarding === item.id}
                disabled={discarding !== null}
                onPress={() => void discard(item)}
              />
            </View>
          );
        }}
      />
    </View>
  );
}
