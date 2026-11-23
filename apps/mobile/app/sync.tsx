import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { parseHeldCart } from '@ksms/validation';
import { useSync } from '@/sync/SyncProvider';
import type { OutboxRow } from '@/sync/types';
import { Badge, Button, Card, EmptyState, KeyValue, Screen, SectionTitle } from '@/components/ui';
import { colors } from '@/theme/colors';
import { formatDateTime } from '@/utils/format';

/** Sync status, local read-cache summary, and failed/pending outbox queue with Retry and Discard. */
export default function SyncScreen() {
  const { syncState, lastError, stats, outbox, syncNow, retryItem, discardItem } = useSync();
  const [busyId, setBusyId] = useState<string | null>(null);

  const failedItems = outbox.filter((o) => o.status === 'FAILED' || o.status === 'CONFLICT');
  const pendingItems = outbox.filter((o) => o.status === 'PENDING' || o.status === 'SENDING');

  const statusLabel =
    syncState === 'syncing'
      ? 'Syncing…'
      : syncState === 'offline'
        ? 'Offline'
        : syncState === 'error'
          ? 'Sync error'
          : 'Online';

  const statusTone =
    syncState === 'offline' || syncState === 'error'
      ? ('warn' as const)
      : syncState === 'syncing'
        ? ('neutral' as const)
        : ('good' as const);

  async function onRetry(item: OutboxRow) {
    if (busyId) return;
    setBusyId(item.operationId);
    try {
      await retryItem(item.operationId);
    } finally {
      setBusyId(null);
    }
  }

  function onDiscard(item: OutboxRow) {
    Alert.alert(
      'Discard this held bill?',
      'This removes the failed held bill from this phone. It will not be uploaded to the server.',
      [
        { text: 'Keep', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            setBusyId(item.operationId);
            void discardItem(item.operationId).finally(() => setBusyId(null));
          },
        },
      ],
    );
  }

  return (
    <Screen refreshing={syncState === 'syncing'} onRefresh={() => void syncNow()}>
      <Stack.Screen options={{ title: 'Sync & offline cache' }} />

      <Card>
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Text style={{ fontSize: 17, fontWeight: '700', color: colors.text }}>Sync status</Text>
          <Badge text={statusLabel} tone={statusTone} />
        </View>
        <KeyValue
          label="Last synced"
          value={stats.lastSyncedAt ? formatDateTime(stats.lastSyncedAt) : 'Not synced yet'}
        />
        <KeyValue label="Waiting to upload" value={String(stats.pendingOutbox)} />
        <KeyValue
          label="Failed uploads"
          value={String(stats.failedOutbox)}
          tone={stats.failedOutbox > 0 ? 'danger' : 'muted'}
        />
        {lastError ? (
          <Text style={{ color: colors.warning, fontSize: 13, marginTop: 6 }}>{lastError}</Text>
        ) : null}
        <View style={{ height: 8 }} />
        <Button
          title={syncState === 'syncing' ? 'Syncing…' : 'Sync now'}
          busy={syncState === 'syncing'}
          onPress={() => void syncNow()}
        />
      </Card>

      <SectionTitle>Saved on this phone (read cache)</SectionTitle>
      <Card>
        <KeyValue label="Products" value={String(stats.products)} />
        <KeyValue label="Categories" value={String(stats.categories)} />
        <KeyValue label="Units" value={String(stats.units)} />
        <KeyValue label="Customers" value={String(stats.customers)} />
        <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 8 }}>
          Draft bills and held bills stay on this phone while offline. Completing a sale, collecting
          khata, changing stock and adding customers require an internet connection.
        </Text>
      </Card>

      <SectionTitle>{`Failed & conflicted uploads (${failedItems.length})`}</SectionTitle>
      {failedItems.length === 0 ? (
        <EmptyState
          icon="checkmark-circle-outline"
          title="No failed items"
          note="All held bills either uploaded cleanly or are waiting for the next automatic retry."
        />
      ) : (
        failedItems.map((item) => {
          const cart = parseHeldCart(item.payload.payload);
          const count = cart?.lines.length ?? 0;
          return (
            <Card key={item.operationId} style={{ borderColor: colors.danger }}>
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text }}>
                  {item.payload.label ?? 'Held bill'}
                </Text>
                <Badge text={item.status === 'CONFLICT' ? 'Conflict' : 'Failed'} tone="bad" />
              </View>
              <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 2 }}>
                {count} item{count === 1 ? '' : 's'} · Saved {formatDateTime(item.createdAt)} ·{' '}
                {item.retryCount} attempt{item.retryCount === 1 ? '' : 's'}
              </Text>
              {item.lastError ? (
                <Text style={{ color: colors.danger, fontSize: 13, marginTop: 6 }}>
                  {item.lastError}
                </Text>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Retry"
                    busy={busyId === item.operationId}
                    disabled={busyId !== null}
                    onPress={() => void onRetry(item)}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Button
                    title="Discard"
                    variant="secondary"
                    disabled={busyId !== null}
                    onPress={() => onDiscard(item)}
                  />
                </View>
              </View>
            </Card>
          );
        })
      )}

      {pendingItems.length > 0 ? (
        <>
          <SectionTitle>{`Waiting to upload (${pendingItems.length})`}</SectionTitle>
          {pendingItems.map((item) => {
            const cart = parseHeldCart(item.payload.payload);
            const count = cart?.lines.length ?? 0;
            return (
              <Card key={item.operationId}>
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>
                    {item.payload.label ?? 'Held bill'}
                  </Text>
                  <Badge text={item.status === 'SENDING' ? 'Uploading' : 'Queued'} tone="warn" />
                </View>
                <Text style={{ color: colors.textMuted, fontSize: 13, marginTop: 2 }}>
                  {count} item{count === 1 ? '' : 's'} · Saved {formatDateTime(item.createdAt)}
                </Text>
                {item.nextRetryAt ? (
                  <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 4 }}>
                    Next automatic retry: {formatDateTime(item.nextRetryAt)} (attempt{' '}
                    {item.retryCount})
                  </Text>
                ) : null}
                {item.lastError ? (
                  <Text style={{ color: colors.warning, fontSize: 12, marginTop: 2 }}>
                    {item.lastError}
                  </Text>
                ) : null}
              </Card>
            );
          })}
        </>
      ) : null}
    </Screen>
  );
}
