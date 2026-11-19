import { Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { moneyString } from '@ksms/validation';
import { getData, postData, query } from '@/api/client';
import type { ExpenseCategoryRow, ExpenseRow } from '@/api/types';
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
import { useLoad, usePagedList } from '@/hooks/useLoad';
import { useSubmit } from '@/hooks/useSubmit';
import { colors } from '@/theme/colors';
import { formatINR } from '@/utils/currency';
import { friendlyError } from '@/utils/errors';

const METHODS = [
  { key: 'CASH', label: 'Cash' },
  { key: 'UPI', label: 'UPI' },
  { key: 'CARD', label: 'Card' },
  { key: 'BANK_TRANSFER', label: 'Bank' },
] as const;

export default function ExpensesScreen() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER'>('CASH');
  const [description, setDescription] = useState('');
  const [selected, setSelected] = useState<ExpenseRow | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [catBusy, setCatBusy] = useState(false);
  const [catError, setCatError] = useState<string | null>(null);

  const { run, busy, error, setError } = useSubmit();
  const list = usePagedList<ExpenseRow>(
    `/expenses${query({ q: search.trim(), includeCancelled: true })}`,
  );
  const cats = useLoad(
    () => getData<ExpenseCategoryRow[]>('/expense-categories?activeOnly=true'),
    [],
  );

  if (!can('expense.read')) {
    return (
      <EmptyState icon="lock-closed-outline" title="Expenses are not available for your role" />
    );
  }

  const activeCategories = cats.data ?? [];
  const chosenCat = categoryId || activeCategories[0]?.id || '';

  async function addCategory() {
    const trimmed = newCatName.trim();
    if (trimmed.length < 2) return setCatError('Enter a category name (at least 2 letters).');
    setCatBusy(true);
    setCatError(null);
    try {
      const created = await postData<ExpenseCategoryRow>('/expense-categories', { name: trimmed });
      setNewCatName('');
      setCategoryId(created.id);
      void cats.reload();
    } catch (e) {
      setCatError(friendlyError(e));
    } finally {
      setCatBusy(false);
    }
  }

  async function saveExpense() {
    if (!chosenCat) return setError('Create or select an expense category first.');
    if (!moneyString.safeParse(amount.trim()).success) {
      return setError('Enter a valid amount like 250.00.');
    }
    const res = await run('/expenses', {
      categoryId: chosenCat,
      amount: amount.trim(),
      method,
      ...(description.trim() ? { description: description.trim() } : {}),
    });
    if (res) {
      setAmount('');
      setDescription('');
      setAdding(false);
      void list.reload(true);
    }
  }

  async function cancelSelected() {
    if (!selected) return;
    if (cancelReason.trim().length < 2) {
      return setError('Enter a reason to cancel this expense.');
    }
    const res = await run(`/expenses/${selected.id}/cancel`, { reason: cancelReason.trim() });
    if (res) {
      setSelected(null);
      setCancelReason('');
      void list.reload(true);
    }
  }

  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 12 }}
    >
      <Stack.Screen options={{ title: 'Expenses' }} />
      <SearchBox
        value={search}
        onChangeText={setSearch}
        placeholder="Search expense description or category"
      />

      {can('expense.create') ? (
        adding ? (
          <Card>
            {activeCategories.length > 0 ? (
              <Choice
                label="Category"
                options={activeCategories.map((c) => ({ key: c.id, label: c.name }))}
                value={chosenCat}
                onChange={setCategoryId}
              />
            ) : null}
            <Field
              label="New category (optional)"
              value={newCatName}
              onChangeText={setNewCatName}
              placeholder="Tea & snacks, Rent, Transport..."
            />
            {newCatName.trim().length >= 2 ? (
              <Button
                title="Add category"
                variant="secondary"
                onPress={addCategory}
                busy={catBusy}
              />
            ) : null}
            <ErrorText message={catError} />

            <Field
              label="Amount (₹)"
              value={amount}
              onChangeText={setAmount}
              placeholder="150.00"
              keyboardType="decimal-pad"
            />
            <Choice label="Paid via" options={METHODS} value={method} onChange={setMethod} />
            <Field
              label="Description (optional)"
              value={description}
              onChangeText={setDescription}
              placeholder="Electricity bill, delivery charges..."
            />
            <ErrorText message={error} />
            <Button title="Save expense" onPress={saveExpense} busy={busy} />
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
            title="Add expense"
            onPress={() => {
              setAdding(true);
              setError(null);
            }}
          />
        )
      ) : null}

      {selected ? (
        <Card>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 }}>
            {selected.categoryName} · {formatINR(selected.amount)}
          </Text>
          <KeyValue label="Date" value={selected.expenseDate} />
          <KeyValue label="Mode" value={selected.method} />
          {selected.description ? <KeyValue label="Notes" value={selected.description} /> : null}
          <KeyValue
            label="Status"
            value={selected.cancelledAt ? 'Cancelled' : 'Active'}
            tone={selected.cancelledAt ? 'danger' : 'success'}
          />
          {!selected.cancelledAt && can('expense.create') ? (
            <>
              <Field
                label="Cancellation reason"
                value={cancelReason}
                onChangeText={setCancelReason}
                placeholder="Entered by mistake"
              />
              <ErrorText message={error} />
              <Button
                title="Cancel expense"
                variant="danger"
                onPress={cancelSelected}
                busy={busy}
              />
            </>
          ) : null}
          <Button
            title="Close"
            variant="secondary"
            onPress={() => {
              setSelected(null);
              setCancelReason('');
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
            keyExtractor={(e) => e.id}
            refreshing={list.refreshing}
            onRefresh={() => void list.reload(true)}
            onEndReachedThreshold={0.5}
            onEndReached={() => void list.loadMore()}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            ListEmptyComponent={<EmptyState icon="receipt-outline" title="No expenses recorded" />}
            renderItem={({ item }) => (
              <ListRow
                title={`${item.categoryName}${item.description ? ` · ${item.description}` : ''}`}
                subtitle={`${item.expenseDate} · ${item.method}`}
                right={
                  <Badge text={formatINR(item.amount)} tone={item.cancelledAt ? 'bad' : 'warn'} />
                }
                rightSub={item.cancelledAt ? 'Cancelled' : undefined}
                onPress={() => {
                  setSelected(item);
                  setCancelReason('');
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
