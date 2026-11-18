import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { type PayForm, buildPayPayload, validatePayForm } from '@ksms/validation';
import { getData } from '@/api/client';
import type { SupplierDetail } from '@/api/types';
import { Button, Card, Choice, ErrorText, Field, KeyValue, Loading, Screen } from '@/components/ui';
import { useLoad } from '@/hooks/useLoad';
import { useSubmit } from '@/hooks/useSubmit';
import { colors } from '@/theme/colors';
import { formatINR, isPositive } from '@/utils/currency';

const METHODS = [
  { key: 'CASH', label: 'Cash' },
  { key: 'UPI', label: 'UPI' },
  { key: 'CARD', label: 'Card' },
  { key: 'BANK_TRANSFER', label: 'Bank transfer' },
] as const;

interface PaymentResult {
  receiptNumber: string;
  advance: string;
  supplierBalance: string;
  allocations: { purchaseNumber: string; amount: string }[];
}

/** Pay a supplier: the money settles the oldest unpaid purchases first; anything extra stays as an advance. */
export default function PaySupplierScreen() {
  const { supplierId } = useLocalSearchParams<{ supplierId: string }>();
  const {
    data: s,
    loading,
    error: loadError,
  } = useLoad(() => getData<SupplierDetail>(`/suppliers/${supplierId}`), [supplierId]);
  const { run, busy, error, setError } = useSubmit();
  const [form, setForm] = useState<PayForm>({ amount: '', method: 'CASH', referenceNo: '' });
  const [done, setDone] = useState<PaymentResult | null>(null);

  if (loading) return <Loading />;
  if (!s) return <ErrorText message={loadError ?? 'Could not load this supplier.'} />;

  async function pay() {
    const problem = validatePayForm(form);
    if (problem) return setError(problem);
    const r = await run<PaymentResult>(`/suppliers/${supplierId}/payments`, buildPayPayload(form));
    if (r) setDone(r);
  }

  if (done) {
    return (
      <Screen footer={<Button title="Done" onPress={() => router.back()} />}>
        <Stack.Screen options={{ title: 'Payment recorded' }} />
        <Card>
          <Text style={{ fontSize: 18, fontWeight: '700', color: colors.success, marginBottom: 8 }}>
            Receipt {done.receiptNumber}
          </Text>
          {done.allocations.map((a) => (
            <KeyValue
              key={a.purchaseNumber}
              label={`Settled ${a.purchaseNumber}`}
              value={formatINR(a.amount)}
            />
          ))}
          {isPositive(done.advance) ? (
            <KeyValue label="Kept as advance" value={formatINR(done.advance)} tone="success" />
          ) : null}
          <KeyValue label="You now owe" value={formatINR(done.supplierBalance)} bold />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen footer={<Button title="Record payment" onPress={pay} busy={busy} />}>
      <Stack.Screen options={{ title: `Pay ${s.name}` }} />
      <Card>
        <KeyValue
          label="You owe"
          value={formatINR(s.balance)}
          bold
          tone={isPositive(s.balance) ? 'danger' : undefined}
        />
        {s.unpaidPurchaseCount > 0 ? (
          <KeyValue label="Unpaid purchases" value={`${s.unpaidPurchaseCount}`} tone="muted" />
        ) : null}
        {isPositive(s.balance) ? (
          <Button
            title={`Pay everything: ${formatINR(s.balance)}`}
            variant="secondary"
            onPress={() => setForm((f) => ({ ...f, amount: s.balance }))}
          />
        ) : null}
      </Card>
      <Field
        label="Amount ₹"
        value={form.amount}
        onChangeText={(v) => setForm((f) => ({ ...f, amount: v }))}
        keyboardType="decimal-pad"
      />
      <Choice
        label="Paid by"
        options={METHODS}
        value={form.method}
        onChange={(m) => setForm((f) => ({ ...f, method: m }))}
      />
      {form.method !== 'CASH' ? (
        <Field
          label="Reference (UPI id, cheque no...)"
          value={form.referenceNo}
          onChangeText={(v) => setForm((f) => ({ ...f, referenceNo: v }))}
        />
      ) : null}
      <ErrorText message={error} />
    </Screen>
  );
}
