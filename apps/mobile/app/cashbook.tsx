import { Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { moneyString } from '@ksms/validation';
import { query } from '@/api/client';
import type { CashbookEntryRow } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import {
  Badge,
  Button,
  Card,
  Choice,
  EmptyState,
  ErrorText,
  Field,
  KeyValue,
  ListRow,
  Loading,
  SearchBox,
} from '@/components/ui';
import { usePagedList } from '@/hooks/useLoad';
import { useSubmit } from '@/hooks/useSubmit';
import { colors } from '@/theme/colors';
import { absMoney, formatINR, isPositive } from '@/utils/currency';
import { words } from '@/utils/format';

const KINDS = [
  { key: 'CASH_IN', label: 'Cash in (+)' },
  { key: 'CASH_OUT', label: 'Cash out (-)' },
] as const;

export default function CashbookScreen() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<'CASH_IN' | 'CASH_OUT'>('CASH_IN');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const { run, busy, error, setError } = useSubmit();

  const list = usePagedList<
    CashbookEntryRow,
    { summary?: { totalIn: string; totalOut: string; net: string; cashNet: string } }
  >(`/cashbook${query({ q: search.trim() })}`);

  if (!can('cashbook.read')) {
    return (
      <EmptyState icon="lock-closed-outline" title="Cashbook is not available for your role" />
    );
  }

  async function saveEntry() {
    if (!moneyString.safeParse(amount.trim()).success) {
      return setError('Enter a valid amount like 500.00.');
    }
    if (description.trim().length < 2) {
      return setError('Enter a description (at least 2 letters).');
    }
    const res = await run('/cashbook/entries', {
      kind,
      amount: amount.trim(),
      method: 'CASH',
      description: description.trim(),
    });
    if (res) {
      setAmount('');
      setDescription('');
      setAdding(false);
      void list.reload(true);
    }
  }

  const summary = list.meta?.summary;

  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 12 }}
    >
      <Stack.Screen options={{ title: 'Cashbook' }} />
      {summary ? (
        <Card>
          <KeyValue label="Total in" value={formatINR(summary.totalIn)} tone="success" />
          <KeyValue label="Total out" value={formatINR(summary.totalOut)} tone="danger" />
          <KeyValue label="Cash net" value={formatINR(summary.cashNet)} bold />
        </Card>
      ) : null}

      <SearchBox value={search} onChangeText={setSearch} placeholder="Search cashbook entries" />

      {can('cashbook.manage') ? (
        adding ? (
          <Card>
            <Choice label="Entry type" options={KINDS} value={kind} onChange={setKind} />
            <Field
              label="Amount (₹)"
              value={amount}
              onChangeText={setAmount}
              placeholder="500.00"
              keyboardType="decimal-pad"
            />
            <Field
              label="Description"
              value={description}
              onChangeText={setDescription}
              placeholder="Opening drawer float, bank deposit..."
            />
            <ErrorText message={error} />
            <Button title="Save entry" onPress={saveEntry} busy={busy} />
            <Button
              title="Cancel"
              variant="secondary"
              onPress={() => {
                setAdding(false);
                setError(null);
              }}
            />
          </Card>
        ) : (
          <Button
            title="Record cash in / out"
            onPress={() => {
              setAdding(true);
              setError(null);
            }}
          />
        )
      ) : null}

      {list.loading ? (
        <Loading />
      ) : (
        <>
          <ErrorText message={list.error} />
          <FlatList
            data={list.items}
            keyExtractor={(e) => e.id}
            refreshing={list.refreshing}
            onRefresh={() => void list.reload(true)}
            onEndReachedThreshold={0.5}
            onEndReached={() => void list.loadMore()}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            ListEmptyComponent={
              <EmptyState icon="wallet-outline" title="No cashbook entries yet" />
            }
            renderItem={({ item }) => {
              const pos = isPositive(item.amount);
              return (
                <ListRow
                  title={item.description ?? words(item.kind)}
                  subtitle={`${item.businessDate} · ${words(item.kind)} · ${item.method}`}
                  right={
                    <Badge
                      text={`${pos ? '+' : '-'}${formatINR(absMoney(item.amount))}`}
                      tone={pos ? 'good' : 'bad'}
                    />
                  }
                />
              );
            }}
          />
        </>
      )}
    </View>
  );
}
