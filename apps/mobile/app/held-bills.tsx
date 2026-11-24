import { router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Text, View } from 'react-native';
import { parseHeldCart } from '@ksms/validation';
import { deleteData } from '@/api/client';
import type { HeldBill } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { useCart } from '@/cart/CartProvider';
import { ListFooter } from '@/components/ListFooter';
import { Badge, Button, EmptyState, ErrorText, ListRow, Loading, pageStyle } from '@/components/ui';
import { icons, illustrations } from '@/theme/art';
import { usePagedList } from '@/hooks/useLoad';
import {
  listLocalHeldBills,
  removeLocalHeldBill,
  removeLocalHeldBillByServerId,
} from '@/sync/cache-store';
import { useSync } from '@/sync/SyncProvider';
import type { LocalHeldBill } from '@/sync/types';
import { colors } from '@/theme/colors';
import { friendlyError } from '@/utils/errors';
import { formatDateTime } from '@/utils/format';

interface MergedHeldBill {
  key: string;
  serverId: string | null;
  localId: string | null;
  label: string | null;
  payload: unknown;
  createdAt: string;
  syncStatus: 'SYNCED' | 'PENDING' | 'FAILED' | 'CONFLICT';
}

/** Carts parked at this branch's counter (server + locally queued held bills). */
export default function HeldBillsScreen() {
  const { branch } = useAuth();
  const { db, refreshLocalState, stats } = useSync();
  const [localBills, setLocalBills] = useState<LocalHeldBill[]>([]);
  const list = usePagedList<HeldBill>('/held-bills', 30, async () => []);
  const { cart, load } = useCart();
  const [error, setError] = useState<string | null>(null);
  const [discarding, setDiscarding] = useState<string | null>(null);

  const loadLocal = useCallback(async () => {
    if (!db || !branch) {
      setLocalBills([]);
      return;
    }
    setLocalBills(await listLocalHeldBills(db, branch.id));
  }, [db, branch]);

  useFocusEffect(
    useCallback(() => {
      void loadLocal();
    }, [loadLocal]),
  );

  const merged = useMemo<MergedHeldBill[]>(() => {
    const serverIds = new Set(list.items.map((s) => s.id));
    const rows: MergedHeldBill[] = [];

    for (const l of localBills) {
      // Once the server list includes this synced bill, show the server entry only (no duplicates).
      if (l.serverId && serverIds.has(l.serverId)) continue;
      rows.push({
        key: `local:${l.localId}`,
        serverId: l.serverId,
        localId: l.localId,
        label: l.label,
        payload: l.payload,
        createdAt: l.createdAt,
        syncStatus: l.syncStatus,
      });
    }

    for (const s of list.items) {
      rows.push({
        key: `server:${s.id}`,
        serverId: s.id,
        localId: null,
        label: s.label,
        payload: s.payload,
        createdAt: s.createdAt,
        syncStatus: 'SYNCED',
      });
    }

    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return rows;
  }, [list.items, localBills]);

  function resume(h: MergedHeldBill) {
    const parsed = parseHeldCart(h.payload);
    if (!parsed) return setError('This held bill cannot be opened.');
    const open = async () => {
      load({ ...parsed, heldBillId: h.serverId ?? null });
      if (h.localId && !h.serverId && db) {
        await removeLocalHeldBill(db, h.localId).catch(() => undefined);
        await refreshLocalState();
      }
      router.replace('/sale/new');
    };
    if (cart.lines.length > 0) {
      Alert.alert(
        'Replace the current bill?',
        'The bill on the counter now will be cleared (hold it first to keep it).',
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Replace', style: 'destructive', onPress: () => void open() },
        ],
      );
    } else void open();
  }

  async function discard(h: MergedHeldBill) {
    if (discarding) return;
    setDiscarding(h.key);
    setError(null);
    try {
      if (h.serverId) {
        await deleteData(`/held-bills/${h.serverId}`);
        if (db) await removeLocalHeldBillByServerId(db, h.serverId);
      }
      if (h.localId && db) {
        await removeLocalHeldBill(db, h.localId);
      }
      await Promise.all([loadLocal(), refreshLocalState(), list.reload()]);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setDiscarding(null);
    }
  }

  if (list.loading && localBills.length === 0) return <Loading />;
  return (
    <View style={pageStyle}>
      <Stack.Screen options={{ title: 'Held bills' }} />
      {list.fromCache ? (
        <Text style={{ color: colors.warning, fontSize: 13, marginBottom: 8 }}>
          Offline — showing held bills saved on this phone.
        </Text>
      ) : null}
      {stats.failedOutbox > 0 ? (
        <Button
          title={`Review ${stats.failedOutbox} failed sync item${stats.failedOutbox === 1 ? '' : 's'}`}
          variant="secondary"
          onPress={() => router.push('/sync')}
        />
      ) : null}
      <ErrorText message={error ?? list.error} />
      <FlatList
        data={merged}
        keyExtractor={(h) => h.key}
        refreshing={list.refreshing}
        onRefresh={() => {
          void loadLocal();
          void list.reload(true);
        }}
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
            art={illustrations.emptyHeld}
            title="No held bills"
            note="On a bill, tap “Hold this bill for later” to park it."
          />
        }
        renderItem={({ item }) => {
          const c = parseHeldCart(item.payload);
          const badge =
            item.syncStatus === 'PENDING' ? (
              <Badge text="Pending sync" tone="warn" />
            ) : item.syncStatus === 'FAILED' ? (
              <Badge text="Sync failed" tone="bad" />
            ) : item.syncStatus === 'CONFLICT' ? (
              <Badge text="Conflict" tone="bad" />
            ) : undefined;
          return (
            <View>
              <ListRow
                art={icons.hold}
                tint="mango"
                title={item.label ?? 'Held bill'}
                subtitle={`${c?.lines.length ?? 0} items · ${formatDateTime(item.createdAt)}`}
                right={badge}
                onPress={() => resume(item)}
              />
              <Button
                title="Discard"
                variant="secondary"
                busy={discarding === item.key}
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
