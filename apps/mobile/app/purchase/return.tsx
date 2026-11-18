import { router, Stack, useLocalSearchParams } from 'expo-router';
import Decimal from 'decimal.js';
import { useState } from 'react';
import { Text } from 'react-native';
import { type ReturnLineForm, buildPurchaseReturnPayload, validateReturn } from '@ksms/validation';
import { getData } from '@/api/client';
import type { PurchaseDetail, StockDetail } from '@/api/types';
import { Button, Card, Choice, ErrorText, Field, Loading, Screen } from '@/components/ui';
import { useLoad } from '@/hooks/useLoad';
import { useSubmit } from '@/hooks/useSubmit';
import { colors } from '@/theme/colors';
import { formatDate, trimZeros } from '@/utils/format';

/** How much of a line can still go back, in the unit it was bought in. */
function returnableIn(i: PurchaseDetail['items'][number]): string {
  const base = new Decimal(i.baseQuantity);
  const back = new Decimal(i.receivedBaseQuantity).minus(i.returnedBaseQuantity);
  return back.mul(i.quantity).div(base).toDecimalPlaces(3, Decimal.ROUND_DOWN).toFixed();
}

export default function PurchaseReturnScreen() {
  const { purchaseId } = useLocalSearchParams<{ purchaseId: string }>();
  const {
    data,
    loading,
    error: loadError,
  } = useLoad(async () => {
    const purchase = await getData<PurchaseDetail>(`/purchases/${purchaseId}`);
    // batches currently in stock for each product (tracked goods must say which batch goes back)
    const stock: Record<string, StockDetail> = {};
    for (const productId of new Set(purchase.items.map((i) => i.productId))) {
      stock[productId] = await getData<StockDetail>(`/inventory/balances/${productId}`);
    }
    return { purchase, stock };
  }, [purchaseId]);
  const { run, busy, error, setError } = useSubmit();
  const [lines, setLines] = useState<Record<string, ReturnLineForm>>({});
  const [reason, setReason] = useState('');

  if (loading) return <Loading />;
  if (!data) return <ErrorText message={loadError ?? 'Could not load this purchase.'} />;
  const { purchase: p, stock } = data;

  const set = (itemId: string, patch: Partial<ReturnLineForm>) =>
    setLines((prev) => ({
      ...prev,
      [itemId]: { itemId, quantity: '', ...prev[itemId], ...patch },
    }));

  async function submit() {
    const chosen = Object.values(lines);
    const problem = validateReturn(chosen, reason);
    if (problem) return setError(problem);
    const result = await run('/purchase-returns', buildPurchaseReturnPayload(p.id, chosen, reason));
    if (result) router.back();
  }

  return (
    <Screen footer={<Button title="Send these goods back" onPress={submit} busy={busy} />}>
      <Stack.Screen options={{ title: `Return from ${p.purchaseNumber}` }} />
      {p.items.map((i) => {
        const max = returnableIn(i);
        if (new Decimal(max).lte(0)) return null;
        const prod = stock[i.productId];
        const tracked = Boolean(prod?.trackBatch || prod?.trackExpiry);
        const batches = prod?.batches ?? [];
        const unit = i.unitCode ?? '';
        const line = lines[i.id];
        return (
          <Card key={i.id}>
            <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>
              {i.productName}
            </Text>
            <Text style={{ color: colors.textMuted, marginBottom: 8 }}>
              Bought {trimZeros(i.quantity)}
              {unit ? ` ${unit}` : ''} · up to {trimZeros(max)} can go back
            </Text>
            <Field
              label={unit ? `How many (${unit})` : 'How many'}
              value={line?.quantity ?? ''}
              onChangeText={(v) => set(i.id, { quantity: v })}
              keyboardType="decimal-pad"
            />
            {line?.quantity && batches.length > 0 ? (
              <Choice
                label="From which batch"
                options={batches.map((b) => ({
                  key: b.id,
                  label: `${b.batchNumber}${b.expiryDate ? ` · ${formatDate(b.expiryDate)}` : ''} (${trimZeros(b.quantity)})`,
                }))}
                value={line.batchId ?? ''}
                onChange={(batchId) => set(i.id, { batchId })}
              />
            ) : line?.quantity && tracked ? (
              <ErrorText message="No batch with stock is available to return." />
            ) : null}
          </Card>
        );
      })}
      <Field
        label="Why are they going back?"
        value={reason}
        onChangeText={setReason}
        placeholder="e.g. damaged, wrong grade"
      />
      <Text style={{ color: colors.textMuted, marginBottom: 8 }}>
        You get credit for the price you paid. Goods you have already sold cannot be sent back.
      </Text>
      <ErrorText message={error} />
    </Screen>
  );
}
