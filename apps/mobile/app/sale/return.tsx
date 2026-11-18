import { router, Stack, useLocalSearchParams } from 'expo-router';
import Decimal from 'decimal.js';
import { useState } from 'react';
import { Text } from 'react-native';
import { type ReturnLineForm, buildSaleReturnPayload, validateReturn } from '@ksms/validation';
import { getData } from '@/api/client';
import type { SaleDetail } from '@/api/types';
import { Button, Card, Choice, ErrorText, Field, Loading, Screen } from '@/components/ui';
import { useLoad } from '@/hooks/useLoad';
import { useSubmit } from '@/hooks/useSubmit';
import { colors } from '@/theme/colors';
import { formatINR, isPositive } from '@/utils/currency';
import { trimZeros } from '@/utils/format';

type Refund = 'CASH' | 'UPI' | 'CARD' | 'BANK_TRANSFER' | 'CUSTOMER_ACCOUNT';

const DISPOSITIONS = [
  { key: 'SALEABLE', label: 'Back on the shelf' },
  { key: 'DAMAGED', label: 'Damaged' },
  { key: 'EXPIRED', label: 'Expired' },
] as const;

/** How much of a line can still be returned, in the unit it was sold in. */
function returnableIn(i: SaleDetail['items'][number]): string {
  const base = new Decimal(i.baseQuantity);
  const left = base.minus(i.returnedBaseQuantity);
  return left.mul(i.quantity).div(base).toDecimalPlaces(3, Decimal.ROUND_DOWN).toFixed();
}

export default function SaleReturnScreen() {
  const { saleId } = useLocalSearchParams<{ saleId: string }>();
  const {
    data: s,
    loading,
    error: loadError,
  } = useLoad(() => getData<SaleDetail>(`/sales/${saleId}`), [saleId]);
  const { run, busy, error, setError } = useSubmit();
  const [lines, setLines] = useState<Record<string, ReturnLineForm>>({});
  const [reason, setReason] = useState('');
  const [refundTo, setRefundTo] = useState<Refund>('CASH');

  if (loading) return <Loading />;
  if (!s) return <ErrorText message={loadError ?? 'Could not load this bill.'} />;

  const refundOptions: { key: Refund; label: string }[] = [
    { key: 'CASH', label: 'Cash back' },
    { key: 'UPI', label: 'UPI back' },
    { key: 'CARD', label: 'Card' },
    { key: 'BANK_TRANSFER', label: 'Bank' },
    ...(s.customer ? [{ key: 'CUSTOMER_ACCOUNT' as const, label: 'Reduce khata' }] : []),
  ];

  const set = (itemId: string, patch: Partial<ReturnLineForm>) =>
    setLines((prev) => ({
      ...prev,
      [itemId]: { itemId, quantity: '', ...prev[itemId], ...patch },
    }));

  async function submit() {
    const chosen = Object.values(lines);
    const problem = validateReturn(chosen, reason);
    if (problem) return setError(problem);
    const result = await run(
      '/sale-returns',
      buildSaleReturnPayload(s!.id, chosen, reason, refundTo),
    );
    if (result) router.back();
  }

  return (
    <Screen footer={<Button title="Return these goods" onPress={submit} busy={busy} />}>
      <Stack.Screen options={{ title: `Return from ${s.saleNumber}` }} />
      {s.items.map((i) => {
        const max = returnableIn(i);
        if (!isPositive(max)) return null;
        const line = lines[i.id];
        return (
          <Card key={i.id}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>{i.name}</Text>
            <Text style={{ color: colors.textMuted, marginBottom: 8 }}>
              Sold {trimZeros(i.quantity)} {i.unitCode} at {formatINR(i.unitPrice)} · up to{' '}
              {trimZeros(max)} can come back
            </Text>
            <Field
              label={`How many (${i.unitCode})`}
              value={line?.quantity ?? ''}
              onChangeText={(v) => set(i.id, { quantity: v })}
              keyboardType="decimal-pad"
            />
            {line?.quantity ? (
              <Choice
                options={DISPOSITIONS}
                value={line.disposition ?? 'SALEABLE'}
                onChange={(d) => set(i.id, { disposition: d })}
              />
            ) : null}
          </Card>
        );
      })}
      <Field
        label="Why is it coming back?"
        value={reason}
        onChangeText={setReason}
        placeholder="e.g. wrong item, broken"
      />
      <Choice
        label="Give the money back"
        options={refundOptions}
        value={refundTo}
        onChange={setRefundTo}
      />
      <Text style={{ color: colors.textMuted, marginBottom: 8 }}>
        The refund is worked out from the original bill. Only goods marked “Back on the shelf” go
        back into stock.
      </Text>
      <ErrorText message={error} />
    </Screen>
  );
}
