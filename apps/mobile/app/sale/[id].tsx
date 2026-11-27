import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, Share, Text, View } from 'react-native';
import { colors } from '@/theme/colors';
import { getData } from '@/api/client';
import type { BranchDetail, OrganizationSettings, SaleDetail } from '@/api/types';
import { Invoice, type ShopDetails } from '@/components/Invoice';
import { canPrint, printPage } from '@/utils/print';
import { useAuth } from '@/auth/AuthProvider';
import { Card, ErrorText, Field, Loading, Screen } from '@/components/ui';
import { useLoad } from '@/hooks/useLoad';
import { useSubmit } from '@/hooks/useSubmit';
import { formatINR, isMoreThan, isPositive, isZero } from '@/utils/currency';
import { formatDateTime, trimZeros } from '@/utils/format';

export default function SaleScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can, profile, branch } = useAuth();
  const {
    data: s,
    loading,
    error,
    refreshing,
    reload,
  } = useLoad(() => getData<SaleDetail>(`/sales/${id}`), [id]);
  const shop = useLoad<ShopDetails>(async () => {
    const [org, branches] = await Promise.all([
      getData<OrganizationSettings>('/organization').catch(() => null),
      can('branch.read') ? getData<BranchDetail[]>('/branches').catch(() => []) : [],
    ]);
    return {
      org,
      branch: branches.find((b) => b.id === branch?.id) ?? branches[0] ?? null,
      fallbackName: profile?.organization.name ?? 'Shop',
    };
  }, [branch?.id]);
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

  const shopDetails = shop.data ?? {
    org: null,
    branch: null,
    fallbackName: profile?.organization.name ?? 'Shop',
  };
  const canReturn = !cancelled && can('sale.return') && returnable;
  const canCancel = !cancelled && can('sale.cancel') && isZero(s.returnedTotal);

  return (
    <Screen onRefresh={() => void reload(true)} refreshing={refreshing}>
      <Stack.Screen options={{ title: s.saleNumber }} />

      <View style={{ width: '100%', maxWidth: 820, alignSelf: 'center', gap: 14 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {canPrint ? (
            <BillAction primary label="Print bill" icon="print-outline" onPress={printPage} />
          ) : null}
          <BillAction label="Share" icon="share-outline" onPress={() => void shareInvoice()} />
          {canReturn ? (
            <BillAction
              label="Return goods"
              icon="return-down-back-outline"
              onPress={() => router.push({ pathname: '/sale/return', params: { saleId: s.id } })}
            />
          ) : null}
          {canCancel && !asking ? (
            <BillAction
              danger
              label="Cancel bill"
              icon="close-circle-outline"
              onPress={() => setAsking(true)}
            />
          ) : null}
          {can('sale.create') ? (
            <View style={{ marginLeft: 'auto' }}>
              <BillAction
                primary={!canPrint}
                label="Next bill"
                icon="add-circle-outline"
                onPress={() => router.replace('/sale/new')}
              />
            </View>
          ) : null}
        </View>

        {asking ? (
          <Card>
            <Field
              label="Why is this bill cancelled?"
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. customer changed mind"
            />
            <ErrorText message={cancel.error} />
            <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
              <BillAction
                danger
                label="Yes, cancel this bill"
                icon="close-circle-outline"
                onPress={doCancel}
              />
              <BillAction
                label="Keep the bill"
                icon="arrow-undo-outline"
                onPress={() => setAsking(false)}
              />
            </View>
          </Card>
        ) : null}

        <Invoice sale={s} shop={shopDetails} />
      </View>
    </Screen>
  );
}

/** A compact action button: big enough to tap, sized to its label instead of stretching the page. */
function BillAction({
  label,
  icon,
  onPress,
  primary,
  danger,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
}) {
  const ink = primary ? colors.onPrimary : danger ? colors.danger : colors.primary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minHeight: 56,
        paddingHorizontal: 20,
        borderRadius: 14,
        borderWidth: 2,
        borderColor: primary ? colors.primary : danger ? colors.danger : colors.border,
        backgroundColor: primary
          ? hovered
            ? colors.primaryDark
            : colors.primary
          : hovered
            ? colors.surfaceMuted
            : colors.surface,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Ionicons name={icon} size={26} color={ink} />
      <Text style={{ fontSize: 17, fontWeight: '700', color: ink }}>{label}</Text>
    </Pressable>
  );
}
