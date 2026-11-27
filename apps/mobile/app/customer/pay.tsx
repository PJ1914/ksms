import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Share } from 'react-native';
import { type PayForm, buildPayPayload, validatePayForm } from '@ksms/validation';
import { getData, getPage } from '@/api/client';
import type { CollectionAgentRow, CustomerRow } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import {
  Button,
  Card,
  Choice,
  ErrorText,
  Field,
  Hero,
  KeyValue,
  Loading,
  Screen,
} from '@/components/ui';
import { icons } from '@/theme/art';
import { useLoad } from '@/hooks/useLoad';
import { useSubmit } from '@/hooks/useSubmit';
import { absMoney, formatINR, isNegative, isPositive } from '@/utils/currency';

const METHODS = [
  { key: 'CASH', label: 'Cash' },
  { key: 'UPI', label: 'UPI' },
  { key: 'CARD', label: 'Card' },
  { key: 'BANK_TRANSFER', label: 'Bank transfer' },
] as const;

interface CollectionResult {
  paymentId: string;
  receiptNumber: string;
  amount: string;
  method: string;
  balanceAfter: string;
  collectionRecord: { id: string; agentId: string; agentName: string } | null;
}

export default function CollectCustomerPaymentScreen() {
  const { customerId } = useLocalSearchParams<{ customerId: string }>();
  const { can, profile } = useAuth();
  const {
    data,
    loading,
    error: loadError,
  } = useLoad(async () => {
    const customer = await getData<CustomerRow>(`/customers/${customerId}`);
    const agents = can('collection.assign')
      ? await getPage<CollectionAgentRow>('/collection-agents?activeOnly=true&pageSize=50')
      : null;
    return { customer, agents: agents?.data ?? [] };
  }, [customerId]);

  const { run, busy, error, setError } = useSubmit();
  const [form, setForm] = useState<PayForm>({ amount: '', method: 'CASH', referenceNo: '' });
  const [agentId, setAgentId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [done, setDone] = useState<CollectionResult | null>(null);

  if (loading) return <Loading />;
  if (!data) return <ErrorText message={loadError ?? 'Could not load this customer.'} />;
  const { customer: c, agents } = data;

  async function collect() {
    const problem = validatePayForm(form);
    if (problem) return setError(problem);
    const payload = {
      ...buildPayPayload(form),
      ...(agentId ? { agentId } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    const r = await run<CollectionResult>(`/customers/${customerId}/payments`, payload);
    if (r) setDone(r);
  }

  if (done) {
    const shareReceipt = async () => {
      const dueLine = isNegative(done.balanceAfter)
        ? `Advance balance: ${formatINR(absMoney(done.balanceAfter))}`
        : `Remaining due: ${formatINR(done.balanceAfter)}`;
      const lines = [
        `${profile?.organization.name ?? 'Yapaaram'} — Payment Receipt`,
        `Receipt: ${done.receiptNumber}`,
        `Customer: ${c.name}`,
        `Received: ${formatINR(done.amount)} (${done.method})`,
        ...(done.collectionRecord ? [`Collected by: ${done.collectionRecord.agentName}`] : []),
        dueLine,
      ];
      await Share.share({ title: `Receipt ${done.receiptNumber}`, message: lines.join('\n') });
    };

    return (
      <Screen footer={<Button title="Done" onPress={() => router.back()} />}>
        <Stack.Screen options={{ title: 'Collection recorded' }} />
        <Hero
          label={`Received from ${c.name}`}
          value={formatINR(done.amount)}
          valueTone="success"
          art={icons.payReceived}
          sub={`Receipt ${done.receiptNumber}`}
        />
        <Card>
          <KeyValue label="Customer" value={c.name} />
          <KeyValue label="Received" value={formatINR(done.amount)} tone="success" />
          <KeyValue label="Mode" value={done.method} />
          {done.collectionRecord ? (
            <KeyValue label="Collected by" value={done.collectionRecord.agentName} />
          ) : null}
          <KeyValue
            label={isNegative(done.balanceAfter) ? 'Advance balance' : 'Remaining due'}
            value={formatINR(
              isNegative(done.balanceAfter) ? absMoney(done.balanceAfter) : done.balanceAfter,
            )}
            bold
          />
        </Card>
        <Button
          title="Share receipt"
          icon="share-social-outline"
          variant="secondary"
          onPress={() => void shareReceipt()}
        />
      </Screen>
    );
  }

  return (
    <Screen footer={<Button title="Record collection" onPress={collect} busy={busy} />}>
      <Stack.Screen options={{ title: `Collect from ${c.name}` }} />
      <Hero
        label={isNegative(c.balance) ? 'Advance with you' : `${c.name} owes`}
        value={formatINR(isNegative(c.balance) ? absMoney(c.balance) : c.balance)}
        valueTone={isPositive(c.balance) ? 'danger' : 'success'}
        tint={isPositive(c.balance) ? 'tomato' : 'green'}
        art={icons.payReceived}
      >
        {isPositive(c.balance) ? (
          <Button
            title={`Collect full due ${formatINR(c.balance)}`}
            variant="secondary"
            onPress={() => setForm((f) => ({ ...f, amount: c.balance }))}
          />
        ) : null}
      </Hero>

      <Field
        label="Amount received (₹)"
        value={form.amount}
        onChangeText={(amount) => setForm((f) => ({ ...f, amount }))}
        placeholder="500.00"
        keyboardType="decimal-pad"
      />
      <Choice
        label="Payment mode"
        options={METHODS}
        value={form.method}
        onChange={(method) => setForm((f) => ({ ...f, method }))}
      />
      <Field
        label="Reference number (optional)"
        value={form.referenceNo}
        onChangeText={(referenceNo) => setForm((f) => ({ ...f, referenceNo }))}
        placeholder="UPI txn id, cheque no..."
      />
      {agents.length > 0 ? (
        <Choice
          label="Collection agent (optional)"
          options={[
            { key: '', label: 'Counter / self' },
            ...agents.map((a) => ({ key: a.id, label: a.name })),
          ]}
          value={agentId}
          onChange={setAgentId}
        />
      ) : null}
      <Field
        label="Notes (optional)"
        value={notes}
        onChangeText={setNotes}
        placeholder="Optional note"
      />
      <ErrorText message={error} />
    </Screen>
  );
}
