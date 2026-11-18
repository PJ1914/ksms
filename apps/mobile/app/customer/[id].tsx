import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { moneyString } from '@ksms/validation';
import { getData, getPage, patchData, postData } from '@/api/client';
import type { CustomerRow, LedgerEntry } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  KeyValue,
  Loading,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { useLoad } from '@/hooks/useLoad';
import { colors } from '@/theme/colors';
import { absMoney, formatINR, isNegative, isPositive } from '@/utils/currency';
import { friendlyError } from '@/utils/errors';
import { formatDateTime, words } from '@/utils/format';

export default function CustomerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const { data, loading, error, refreshing, reload } = useLoad(async () => {
    const customer = await getData<CustomerRow>(`/customers/${id}`);
    const ledger = can('ledger.read')
      ? await getPage<LedgerEntry>(`/customers/${id}/ledger?pageSize=30`)
      : null;
    return { customer, ledger };
  }, [id]);
  const [limit, setLimit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (!data) return <ErrorText message={error ?? 'Could not load this customer.'} />;
  const { customer: c, ledger } = data;
  const owes = isPositive(c.balance);

  async function saveLimit() {
    const v = (limit ?? '').trim();
    if (v !== '' && !moneyString.safeParse(v).success)
      return setProblem(
        'Enter the credit limit in rupees, like 5000, or leave it empty for no limit.',
      );
    setBusy(true);
    setProblem(null);
    try {
      await patchData(`/customers/${id}`, { creditLimit: v === '' ? null : v, version: c.version });
      setLimit(null);
      void reload();
    } catch (e) {
      setProblem(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    setBusy(true);
    setProblem(null);
    try {
      await postData(`/customers/${id}/${c.isActive ? 'deactivate' : 'reactivate'}`);
      void reload();
    } catch (e) {
      setProblem(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen onRefresh={() => void reload(true)} refreshing={refreshing}>
      <Stack.Screen options={{ title: c.name }} />
      <Card>
        <Text
          style={{ fontSize: 26, fontWeight: '800', color: owes ? colors.danger : colors.text }}
        >
          {formatINR(c.balance)}
        </Text>
        <Text style={{ color: colors.textMuted, marginBottom: 8 }}>
          {owes ? 'owes you' : isNegative(c.balance) ? 'advance with you' : 'nothing owed'}
        </Text>
        <KeyValue label="Mobile" value={c.phone ?? 'Not given'} />
        <KeyValue
          label="Credit limit"
          value={c.creditLimit ? formatINR(c.creditLimit) : 'No limit'}
        />
        {!c.isActive ? <Badge text="Switched off: no new khata" tone="warn" /> : null}
      </Card>

      {can('customer.manage') ? (
        limit === null ? (
          <>
            <Button
              title="Change credit limit"
              variant="secondary"
              onPress={() => setLimit(c.creditLimit ?? '')}
            />
            <Button
              title={c.isActive ? 'Switch this customer off' : 'Switch this customer on'}
              variant="secondary"
              onPress={toggleActive}
              busy={busy}
            />
          </>
        ) : (
          <Card>
            <Field
              label="Credit limit ₹ (empty = no limit)"
              value={limit}
              onChangeText={setLimit}
              keyboardType="decimal-pad"
            />
            <ErrorText message={problem} />
            <Button title="Save limit" onPress={saveLimit} busy={busy} />
            <Button title="Cancel" variant="secondary" onPress={() => setLimit(null)} />
          </Card>
        )
      ) : null}
      {limit === null ? <ErrorText message={problem} /> : null}

      <Text style={{ color: colors.textMuted, marginVertical: 8 }}>
        Receiving payments from customers (collections and receipts) arrives in the next update.
      </Text>

      {ledger ? (
        <>
          <SectionTitle>Khata statement</SectionTitle>
          <Card>
            {ledger.data.length === 0 ? (
              <EmptyState icon="book-outline" title="No khata entries yet" />
            ) : (
              ledger.data.map((e) => (
                <KeyValue
                  key={e.id}
                  label={`${words(e.type)} · ${formatDateTime(e.occurredAt)}`}
                  value={`${isPositive(e.amount) ? '+' : '−'}${formatINR(absMoney(e.amount))}`}
                  tone={isPositive(e.amount) ? 'danger' : 'success'}
                />
              ))
            )}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
