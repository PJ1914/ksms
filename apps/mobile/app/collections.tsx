import { Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { query } from '@/api/client';
import type { CollectionRow } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  KeyValue,
  ListRow,
  Loading,
  pageStyle,
  SearchBox,
  Segmented,
} from '@/components/ui';
import { icons, illustrations } from '@/theme/art';
import { usePagedList } from '@/hooks/useLoad';
import { useSubmit } from '@/hooks/useSubmit';
import { colors } from '@/theme/colors';
import { formatINR } from '@/utils/currency';
import { formatDateTime } from '@/utils/format';

type StatusFilter = 'ALL' | 'COMPLETED' | 'REVERSED';
const FILTERS = [
  { key: 'ALL', label: 'All' },
  { key: 'COMPLETED', label: 'Completed' },
  { key: 'REVERSED', label: 'Reversed' },
] as const;

export default function CollectionsScreen() {
  const { can } = useAuth();
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<CollectionRow | null>(null);
  const [reason, setReason] = useState('');
  const { run, busy, error: submitError, setError } = useSubmit();

  const list = usePagedList<CollectionRow>(
    `/collections${query({
      q: search.trim(),
      ...(status !== 'ALL' ? { status } : {}),
    })}`,
  );

  if (!can('collection.read')) {
    return (
      <EmptyState
        art={illustrations.roleLocked}
        title="Collections are not available for your role"
      />
    );
  }

  async function reverseSelected() {
    if (!selected) return;
    const trimmed = reason.trim();
    if (trimmed.length < 2) {
      return setError('Enter a brief reason to reverse this receipt.');
    }
    const res = await run(`/collections/${selected.id}/reverse`, { reason: trimmed });
    if (res) {
      setSelected(null);
      setReason('');
      void list.reload(true);
    }
  }

  return (
    <View style={pageStyle}>
      <Stack.Screen options={{ title: 'Collections' }} />
      <SearchBox
        value={search}
        onChangeText={setSearch}
        placeholder="Search receipt no, customer, or reference"
      />
      <Segmented options={FILTERS} value={status} onChange={setStatus} />

      {selected ? (
        <Card>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 6 }}>
            {selected.receiptNumber ?? 'Collection'} · {formatINR(selected.amount)}
          </Text>
          <KeyValue label="Customer" value={selected.customer?.name ?? '—'} />
          <KeyValue label="Mode" value={selected.method} />
          <KeyValue label="Date" value={formatDateTime(selected.paidAt)} />
          {selected.agent ? <KeyValue label="Agent" value={selected.agent.name} /> : null}
          {selected.referenceNo ? (
            <KeyValue label="Reference" value={selected.referenceNo} />
          ) : null}
          <KeyValue
            label="Status"
            value={selected.status}
            tone={selected.status === 'REVERSED' ? 'danger' : 'success'}
          />
          {selected.status === 'COMPLETED' && can('collection.assign') ? (
            <>
              <Field
                label="Reversal reason"
                value={reason}
                onChangeText={setReason}
                placeholder="Wrong amount or wrong customer"
              />
              <ErrorText message={submitError} />
              <Button
                title="Reverse receipt"
                variant="danger"
                onPress={reverseSelected}
                busy={busy}
              />
            </>
          ) : null}
          <Button
            title="Close"
            variant="secondary"
            onPress={() => {
              setSelected(null);
              setReason('');
              setError(null);
            }}
          />
        </Card>
      ) : null}

      {list.loading ? (
        <Loading />
      ) : (
        <>
          <ErrorText message={list.error} />
          <FlatList
            data={list.items}
            keyExtractor={(c) => c.id}
            refreshing={list.refreshing}
            onRefresh={() => void list.reload(true)}
            onEndReachedThreshold={0.5}
            onEndReached={() => void list.loadMore()}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            ListEmptyComponent={
              <EmptyState
                art={illustrations.emptyCollections}
                title="No collections recorded yet"
              />
            }
            renderItem={({ item }) => (
              <ListRow
                art={icons.payReceived}
                title={`${item.customer?.name ?? 'Customer'} · ${item.receiptNumber ?? ''}`}
                subtitle={`${item.method}${item.agent ? ` · ${item.agent.name}` : ''} · ${formatDateTime(item.paidAt)}`}
                right={
                  <Badge
                    text={formatINR(item.amount)}
                    tone={item.status === 'REVERSED' ? 'bad' : 'good'}
                  />
                }
                rightSub={item.status === 'REVERSED' ? 'Reversed' : undefined}
                onPress={() => {
                  setSelected(item);
                  setReason('');
                  setError(null);
                }}
              />
            )}
          />
        </>
      )}
    </View>
  );
}
