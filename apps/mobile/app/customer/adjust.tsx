import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { moneyString } from '@ksms/validation';
import { getData } from '@/api/client';
import type { CustomerRow } from '@/api/types';
import {
  Button,
  Card,
  Choice,
  ErrorText,
  Field,
  FormHeader,
  KeyValue,
  Loading,
  Screen,
} from '@/components/ui';
import { icons } from '@/theme/art';
import { useLoad } from '@/hooks/useLoad';
import { useSubmit } from '@/hooks/useSubmit';
import { colors } from '@/theme/colors';
import { absMoney, formatINR, isNegative, isPositive } from '@/utils/currency';

const DIRECTIONS = [
  { key: 'DEBIT', label: 'Customer owes more (+)' },
  { key: 'CREDIT', label: 'Reduce balance (−)' },
] as const;

const ENTRY_TYPES = [
  { key: 'ADJUSTMENT', label: 'Credit / Adjustment' },
  { key: 'OPENING_BALANCE', label: 'Opening balance' },
] as const;

interface AdjustResult {
  customerId: string;
  entryType: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: string;
  balanceAfter: string;
  description: string;
}

export default function CustomerKhataAdjustScreen() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const {
    data: c,
    loading,
    error: loadError,
  } = useLoad(() => getData<CustomerRow>(`/customers/${customerId}`), [customerId]);

  const { run, busy, error, setError } = useSubmit();
  const [direction, setDirection] = useState<'DEBIT' | 'CREDIT'>('DEBIT');
  const [entryType, setEntryType] = useState<'ADJUSTMENT' | 'OPENING_BALANCE'>('ADJUSTMENT');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [done, setDone] = useState<AdjustResult | null>(null);

  if (loading) return <Loading />;
  if (!c) return <ErrorText message={loadError ?? 'Could not load this customer.'} />;

  async function save() {
    const trimmedAmt = amount.trim();
    const trimmedDesc = description.trim();
    if (!moneyString.safeParse(trimmedAmt).success || !isPositive(trimmedAmt)) {
      return setError('Enter an amount greater than 0, like 250.00.');
    }
    if (trimmedDesc.length < 2) {
      return setError('Enter a note (e.g. "2 kg sugar taken without bill").');
    }
    const r = await run<AdjustResult>(`/customers/${customerId}/ledger/adjust`, {
      direction,
      entryType,
      amount: trimmedAmt,
      description: trimmedDesc,
    });
    if (r) setDone(r);
  }

  if (done) {
    return (
      <Screen footer={<Button title="Done" onPress={() => router.back()} />}>
        <Stack.Screen options={{ title: 'Khata updated' }} />
        <Card>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.success, marginBottom: 8 }}>
            Khata entry saved
          </Text>
          <KeyValue label="Customer" value={c.name} />
          <KeyValue
            label={done.direction === 'DEBIT' ? 'Added to khata (+)' : 'Reduced (−)'}
            value={formatINR(done.amount)}
            tone={done.direction === 'DEBIT' ? 'danger' : 'success'}
          />
          <KeyValue label="Note" value={done.description} />
          <KeyValue
            label={isNegative(done.balanceAfter) ? 'Advance balance' : 'Updated due'}
            value={formatINR(
              isNegative(done.balanceAfter) ? absMoney(done.balanceAfter) : done.balanceAfter,
            )}
            bold
          />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen footer={<Button title="Save khata entry" onPress={save} busy={busy} />}>
      <Stack.Screen options={{ title: `Khata · ${c.name}` }} />
      <FormHeader
        art={icons.payKhata}
        title="Khata entry"
        note="For old balances or corrections. Bills and payments are added for you."
      />
      <Card>
        <KeyValue
          label="Current balance"
          value={formatINR(isNegative(c.balance) ? absMoney(c.balance) : c.balance)}
          bold
          tone={isPositive(c.balance) ? 'danger' : undefined}
        />
      </Card>

      <Choice
        label="What happened?"
        options={DIRECTIONS}
        value={direction}
        onChange={setDirection}
      />
      <Choice label="Entry type" options={ENTRY_TYPES} value={entryType} onChange={setEntryType} />
      <Field
        label="Amount (₹)"
        value={amount}
        onChangeText={setAmount}
        placeholder="250.00"
        keyboardType="decimal-pad"
      />
      <Field
        label="Note / item details"
        value={description}
        onChangeText={setDescription}
        placeholder="2 kg rice taken without bill, old register balance..."
      />
      <ErrorText message={error} />
    </Screen>
  );
}
