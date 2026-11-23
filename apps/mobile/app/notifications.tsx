import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { postData, query } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { ListFooter } from '@/components/ListFooter';
import { Badge, Button, Card, Choice, EmptyState, ErrorText, Loading } from '@/components/ui';
import { usePagedList } from '@/hooks/useLoad';
import { colors } from '@/theme/colors';
import { friendlyError } from '@/utils/errors';
import { formatDateTime } from '@/utils/format';

interface NotificationItem {
  id: string;
  branchId: string | null;
  type: 'LOW_STOCK' | 'EXPIRING_SOON' | 'PAYMENT_DUE' | 'SYNC_FAILURE' | 'GENERAL';
  title: string;
  body: string;
  data: { productId?: string } | null;
  readAt: string | null;
  createdAt: string;
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unread', label: 'Unread' },
] as const;

export default function NotificationsScreen() {
  const { can } = useAuth();
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const list = usePagedList<NotificationItem, { unreadCount?: number }>(
    `/notifications${query({ unreadOnly: filter === 'unread' })}`,
    30,
  );

  async function checkAlerts() {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await postData('/notifications/check-alerts');
      await list.reload(true);
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function markAllRead() {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await postData('/notifications/read-all');
      await list.reload(true);
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function openNotification(item: NotificationItem) {
    if (!item.readAt) {
      await postData(`/notifications/${item.id}/read`).catch(() => undefined);
      void list.reload();
    }
    if (item.data?.productId) {
      router.push({ pathname: '/product/[id]', params: { id: item.data.productId } });
    }
  }

  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 12 }}
    >
      <Stack.Screen options={{ title: 'Notifications' }} />
      <Choice options={FILTERS} value={filter} onChange={setFilter} />

      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
        {can('stock.read') ? (
          <View style={{ flex: 1 }}>
            <Button
              title="Check stock alerts"
              variant="secondary"
              busy={busy}
              onPress={() => void checkAlerts()}
            />
          </View>
        ) : null}
        {(list.meta?.unreadCount ?? 0) > 0 ? (
          <View style={{ flex: 1 }}>
            <Button
              title="Mark all read"
              variant="secondary"
              busy={busy}
              onPress={() => void markAllRead()}
            />
          </View>
        ) : null}
      </View>

      <ErrorText message={actionError ?? list.error} />
      {list.loading ? (
        <Loading />
      ) : (
        <FlatList
          data={list.items}
          keyExtractor={(n) => n.id}
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
              icon="notifications-outline"
              title={filter === 'unread' ? 'No unread alerts' : 'No notifications yet'}
              note="Low stock and expiring batch alerts for this branch appear here."
            />
          }
          renderItem={({ item }) => (
            <Pressable accessibilityRole="button" onPress={() => void openNotification(item)}>
              <Card
                style={
                  !item.readAt
                    ? { borderColor: colors.primary, backgroundColor: colors.surface }
                    : { opacity: 0.78 }
                }
              >
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Text style={{ flex: 1, fontSize: 15, fontWeight: '700', color: colors.text }}>
                    {item.title}
                  </Text>
                  <Badge
                    text={item.readAt ? 'Read' : 'New'}
                    tone={item.readAt ? 'neutral' : 'warn'}
                  />
                </View>
                <Text style={{ color: colors.text, marginTop: 4, fontSize: 14 }}>{item.body}</Text>
                <Text style={{ color: colors.textMuted, marginTop: 6, fontSize: 12 }}>
                  {formatDateTime(item.createdAt)}
                </Text>
              </Card>
            </Pressable>
          )}
        />
      )}
    </View>
  );
}
