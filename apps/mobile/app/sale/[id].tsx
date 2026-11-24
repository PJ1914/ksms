import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Image, Share, Text, View } from 'react-native';
import { illustrations } from '@/theme/art';
import { getData } from '@/api/client';
import type { SaleDetail } from '@/api/types';
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
import { formatINR, isMoreThan, isPositive, isZero } from '@/utils/currency';
import { formatDateTime, trimZeros, words } from '@/utils/format';

export default function SaleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can, profile } = useAuth();
  const {
    data: s,
    loading,
    error,
    refreshing,
    reload,
  } = useLoad(() => getData<SaleDetail>(`/sales/${id}`), [id]);
  const cancel = useSubmit();
  const [reason, setReason] = useState('');
  const [asking, setAsking] = useState(false);

  if (loading) return <Loading />;
  if (!s) return <ErrorText message={error ?? 'Could not load this bill.'} />;

  const returnable = s.items.some((i) => isMoreThan(i.baseQuantity, i.returnedBaseQuantity));
  const cancelled = s.status === 'CANCELLED';

  async function doCancel() {
    if (reason.trim().length < 5) return cancel.setError('Say why (at least 5 letters).');
    const r = await cancel.run(`/sales/${id}/cancel`, { reason: reason.trim() });
    if (r) {
      setAsking(false);
      setReason('');
      void reload();
    }
  }

  async function shareInvoice() {
    if (!s) return;
    const invNo = s.invoice?.invoiceNumber ?? s.saleNumber;
    const lines = s.items.map(
      (i) =>
        `• ${i.name}: ${trimZeros(i.quantity)} ${i.unitCode} × ${formatINR(i.unitPrice)} = ${formatINR(i.lineTotal)}`,
    );
    const parts = [
      `${profile?.organization.name ?? 'KSMS'} — ${s.invoice?.type === 'GST' ? 'Tax Invoice' : s.invoice?.type === 'BILL_OF_SUPPLY' ? 'Bill of Supply' : 'Invoice'} ${invNo}`,
      `Date: ${formatDateTime(s.soldAt)}`,
      `Customer: ${s.customer?.name ?? 'Walk-in'}`,
      '',
      ...lines,
      '',
      ...(isPositive(s.discountTotal) ? [`Discount: -${formatINR(s.discountTotal)}`] : []),
      ...(isPositive(s.taxTotal)
        ? [
            `Taxable: ${formatINR(s.taxableTotal)}`,
            ...(isPositive(s.igstTotal)
              ? [`IGST: ${formatINR(s.igstTotal)}`]
              : [`CGST: ${formatINR(s.cgstTotal)} | SGST: ${formatINR(s.sgstTotal)}`]),
          ]
        : []),
      `Total: ${formatINR(s.total)}`,
      `Paid: ${formatINR(s.paidTotal)}${isPositive(s.creditAmount) ? ` | On Khata: ${formatINR(s.creditAmount)}` : ''}`,
    ];
    await Share.share({ title: `Invoice ${invNo}`, message: parts.join('\n') });
  }

  return (
    <Screen onRefresh={() => void reload(true)} refreshing={refreshing}>
      <Stack.Screen options={{ title: s.saleNumber }} />

      {!cancelled ? (
        <View style={{ alignItems: 'center', marginBottom: 8 }}>
          <Image
            source={illustrations.billSaved}
            style={{ width: 150, height: 130 }}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        </View>
      ) : null}
      <Card>
        <View
          style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text }}>
            {formatINR(s.total)}
          </Text>
          <Badge text={cancelled ? 'Cancelled' : 'Completed'} tone={cancelled ? 'bad' : 'good'} />
        </View>
        <KeyValue label="When" value={formatDateTime(s.soldAt)} />
        {s.invoice ? (
          <KeyValue
            label="Invoice"
            value={`${s.invoice.invoiceNumber} (${words(s.invoice.type)})`}
          />
        ) : null}
        <KeyValue label="Customer" value={s.customer?.name ?? 'Walk-in'} />
        <KeyValue label="Sold by" value={s.soldBy.fullName} />
        {cancelled && s.cancelReason ? (
          <KeyValue label="Cancelled because" value={s.cancelReason} tone="danger" />
        ) : null}
      </Card>

      <SectionTitle>Items</SectionTitle>
      <Card>
        {s.items.map((i) => (
          <View key={i.id} style={{ paddingVertical: 6 }}>
            <KeyValue label={i.name} value={formatINR(i.lineTotal)} bold />
            <KeyValue
              label={`${trimZeros(i.quantity)} ${i.unitCode} × ${formatINR(i.unitPrice)}${isPositive(i.discountAmount) ? ` (discount ${formatINR(i.discountAmount)})` : ''}`}
              value={
                isPositive(i.returnedBaseQuantity)
                  ? `${trimZeros(i.returnedBaseQuantity)} returned`
                  : ''
              }
              tone="muted"
            />
          </View>
        ))}
      </Card>

      <SectionTitle>Payment</SectionTitle>
      <Card>
        <KeyValue label="Items" value={formatINR(s.subtotal)} />
        {isPositive(s.discountTotal) ? (
          <KeyValue label="Discount" value={`- ${formatINR(s.discountTotal)}`} tone="success" />
        ) : null}
        {isPositive(s.taxTotal) ? (
          <>
            <KeyValue label="Taxable value" value={formatINR(s.taxableTotal)} />
            {isPositive(s.igstTotal) ? (
              <KeyValue label="IGST" value={formatINR(s.igstTotal)} />
            ) : (
              <>
                <KeyValue label="CGST" value={formatINR(s.cgstTotal)} />
                <KeyValue label="SGST" value={formatINR(s.sgstTotal)} />
              </>
            )}
          </>
        ) : null}
        {!isZero(s.roundOff) ? (
          <KeyValue label="Round off" value={formatINR(s.roundOff)} tone="muted" />
        ) : null}
        <KeyValue label="Total" value={formatINR(s.total)} bold />
        {s.payments
          .filter((p) => p.status === 'COMPLETED' || cancelled)
          .map((p) => (
            <KeyValue
              key={p.paymentId}
              label={`Paid by ${words(p.method)}`}
              value={formatINR(p.amount)}
              tone={p.status === 'REVERSED' ? 'muted' : undefined}
            />
          ))}
        {isPositive(s.creditAmount) ? (
          <KeyValue label="On khata" value={formatINR(s.creditAmount)} tone="danger" />
        ) : null}
        {isPositive(s.returnedTotal) ? (
          <KeyValue label="Returned goods worth" value={formatINR(s.returnedTotal)} tone="muted" />
        ) : null}
        {isPositive(s.refundedTotal) ? (
          <KeyValue label="Money given back" value={formatINR(s.refundedTotal)} tone="muted" />
        ) : null}
      </Card>

      <Button title="Share invoice" variant="secondary" onPress={() => void shareInvoice()} />

      {!cancelled && can('sale.return') && returnable ? (
        <Button
          title="Return goods"
          variant="secondary"
          onPress={() => router.push({ pathname: '/sale/return', params: { saleId: s.id } })}
        />
      ) : null}

      {!cancelled && can('sale.cancel') && isZero(s.returnedTotal) ? (
        asking ? (
          <Card>
            <Field
              label="Why is this bill cancelled?"
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. customer changed mind"
            />
            <ErrorText message={cancel.error} />
            <Button
              title="Yes, cancel this bill"
              variant="danger"
              onPress={doCancel}
              busy={cancel.busy}
            />
            <Button title="Keep the bill" variant="secondary" onPress={() => setAsking(false)} />
          </Card>
        ) : (
          <Button title="Cancel this bill" variant="danger" onPress={() => setAsking(true)} />
        )
      ) : null}

      <Button title="Start a new bill" onPress={() => router.replace('/sale/new')} />
    </Screen>
  );
}
