import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { getData } from '@/api/client';
import type { PurchaseDetail } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import {
  Badge,
  Button,
  Card,
  ErrorText,
  Field,
  KeyValue,
  Loading,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { useLoad } from '@/hooks/useLoad';
import { useSubmit } from '@/hooks/useSubmit';
import { colors } from '@/theme/colors';
import { formatINR, isPositive } from '@/utils/currency';
import { formatDate, purchaseTone, trimZeros, words } from '@/utils/format';

export default function PurchaseScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const {
    data: p,
    loading,
    error,
    refreshing,
    reload,
  } = useLoad(() => getData<PurchaseDetail>(`/purchases/${id}`), [id]);
  const receive = useSubmit();
  const cancel = useSubmit();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');

  if (loading) return <Loading />;
  if (!p) return <ErrorText message={error ?? 'Could not load this purchase.'} />;

  const waiting =
    p.status === 'DRAFT' || p.status === 'CONFIRMED' || p.status === 'PARTIALLY_RECEIVED';
  const received = p.status === 'PARTIALLY_RECEIVED' || p.status === 'RECEIVED';

  async function doReceive() {
    const r = await receive.run(`/purchases/${id}/receive`, {});
    if (r) void reload();
  }
  async function doCancel() {
    if (reason.trim().length < 5) return cancel.setError('Say why (at least 5 letters).');
    const r = await cancel.run(`/purchases/${id}/cancel`, { reason: reason.trim() });
    if (r) {
      setAsking(false);
      void reload();
    }
  }

  return (
    <Screen onRefresh={() => void reload(true)} refreshing={refreshing}>
      <Stack.Screen options={{ title: p.purchaseNumber }} />
      <Card>
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>
            {formatINR(p.total)}
          </Text>
          <Badge text={words(p.status)} tone={purchaseTone(p.status)} />
        </View>
        <KeyValue label="Supplier" value={p.supplier.name} />
        <KeyValue label="Date" value={formatDate(p.purchaseDate)} />
        {p.supplierInvoiceNo ? (
          <KeyValue label="Supplier’s bill" value={p.supplierInvoiceNo} />
        ) : null}
      </Card>

      <SectionTitle>Items</SectionTitle>
      <Card>
        {p.items.map((i) => (
          <View key={i.id} style={{ paddingVertical: 6 }}>
            <KeyValue label={i.productName} value={formatINR(i.lineTotal)} bold />
            <KeyValue
              label={`${trimZeros(i.quantity)} ${i.unitCode ?? ''} at ${formatINR(i.unitCost)}`}
              value={`${trimZeros(i.receivedBaseQuantity)} of ${trimZeros(i.baseQuantity)} received`}
              tone="muted"
            />
            {i.batchNumber ? (
              <KeyValue
                label={`Batch ${i.batchNumber}`}
                value={i.expiryDate ? `expires ${formatDate(i.expiryDate)}` : ''}
                tone="muted"
              />
            ) : null}
            {isPositive(i.returnedBaseQuantity) ? (
              <KeyValue label="Sent back" value={trimZeros(i.returnedBaseQuantity)} tone="muted" />
            ) : null}
          </View>
        ))}
      </Card>

      <SectionTitle>Amounts</SectionTitle>
      <Card>
        <KeyValue label="Items" value={formatINR(p.subtotal)} />
        {isPositive(p.discountTotal) ? (
          <KeyValue label="Discount" value={`- ${formatINR(p.discountTotal)}`} tone="success" />
        ) : null}
        {isPositive(p.additionalCosts) ? (
          <KeyValue label="Freight and other" value={formatINR(p.additionalCosts)} />
        ) : null}
        {isPositive(p.taxTotal) ? <KeyValue label="Tax" value={formatINR(p.taxTotal)} /> : null}
        <KeyValue label="Total" value={formatINR(p.total)} bold />
        {received ? (
          <>
            <KeyValue label="Billed so far" value={formatINR(p.billedTotal)} />
            {isPositive(p.returnedTotal) ? (
              <KeyValue
                label="Goods sent back"
                value={`- ${formatINR(p.returnedTotal)}`}
                tone="success"
              />
            ) : null}
            <KeyValue label="Paid" value={formatINR(p.paidTotal)} />
            <KeyValue
              label="Still to pay"
              value={formatINR(p.outstanding)}
              bold
              tone={isPositive(p.outstanding) ? 'danger' : undefined}
            />
          </>
        ) : null}
      </Card>

      {waiting && can('purchase.create') ? (
        <>
          <ErrorText message={receive.error} />
          <Button
            title={
              p.status === 'PARTIALLY_RECEIVED'
                ? 'Receive the rest of the goods'
                : 'Goods have arrived: receive them'
            }
            onPress={doReceive}
            busy={receive.busy}
          />
        </>
      ) : null}
      {received && can('supplier.payment') && isPositive(p.outstanding) ? (
        <Button
          title="Pay the supplier"
          variant="secondary"
          onPress={() =>
            router.push({ pathname: '/supplier/pay', params: { supplierId: p.supplier.id } })
          }
        />
      ) : null}
      {received && can('purchase.cancel') ? (
        <Button
          title="Send goods back to the supplier"
          variant="secondary"
          onPress={() =>
            router.push({ pathname: '/purchase/return', params: { purchaseId: p.id } })
          }
        />
      ) : null}
      {(p.status === 'DRAFT' || p.status === 'CONFIRMED') && can('purchase.cancel') ? (
        asking ? (
          <Card>
            <Field
              label="Why is this purchase cancelled?"
              value={reason}
              onChangeText={setReason}
            />
            <ErrorText message={cancel.error} />
            <Button title="Yes, cancel it" variant="danger" onPress={doCancel} busy={cancel.busy} />
            <Button title="Keep it" variant="secondary" onPress={() => setAsking(false)} />
          </Card>
        ) : (
          <Button title="Cancel this purchase" variant="danger" onPress={() => setAsking(true)} />
        )
      ) : null}
    </Screen>
  );
}
