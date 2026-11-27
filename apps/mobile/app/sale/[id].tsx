import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { Alert, Pressable, Share, Text, useWindowDimensions, View } from 'react-native';
import { colors } from '@/theme/colors';
import { getData } from '@/api/client';
import type { BranchDetail, OrganizationSettings, SaleDetail } from '@/api/types';
import { Invoice, type ShopDetails } from '@/components/Invoice';
import { canPrint, printPage } from '@/utils/print';
import { shareInvoicePdf } from '@/utils/share-invoice';
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
  const { width } = useWindowDimensions();
  const narrow = width < 600;
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
    // Best: a PDF made from the saved invoice, shared and not kept. If that is not possible (no internet, no
    // invoice yet), fall back to the plain-text bill so sharing never fails.
    if (s.invoice) {
      try {
        if (await shareInvoicePdf(s.invoice.id, invNo)) return;
      } catch (e) {
        Alert.alert(
          'Sharing as text',
          `Could not make the PDF (${e instanceof Error ? e.message : 'unknown problem'}). Sharing the bill as text instead.`,
        );
      }
    }
    const lines = s.items.map(
      (i) =>
        `• ${i.name}: ${trimZeros(i.quantity)} ${i.unitCode} × ${formatINR(i.unitPrice)} = ${formatINR(i.lineTotal)}`,
    );
    const parts = [
      `${profile?.organization.name ?? 'Yapaaram'} — ${s.invoice?.type === 'GST' ? 'Tax Invoice' : s.invoice?.type === 'BILL_OF_SUPPLY' ? 'Bill of Supply' : 'Invoice'} ${invNo}`,
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
          <BillAction
            label="Share PDF"
            icon="share-outline"
            onPress={() => void shareInvoice()}
            grid={narrow}
          />
          {canReturn ? (
            <BillAction
              label="Return goods"
              icon="return-down-back-outline"
              grid={narrow}
              onPress={() => router.push({ pathname: '/sale/return', params: { saleId: s.id } })}
            />
          ) : null}
          {canCancel && !asking ? (
            <BillAction
              danger
              grid={narrow}
              label="Cancel bill"
              icon="close-circle-outline"
              onPress={() => setAsking(true)}
            />
          ) : null}
          {can('sale.create') ? (
            <BillAction
              primary={!canPrint}
              label="Next bill"
              icon="add-circle-outline"
              onPress={() => router.replace('/sale/new')}
              grid={narrow}
            />
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
  grid,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  primary?: boolean;
  danger?: boolean;
  /** On a phone: two equal buttons per row. */
  grid?: boolean;
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
        ...(grid ? { flexBasis: '47%', flexGrow: 1, justifyContent: 'center' as const } : {}),
        gap: 8,
        minHeight: 46,
        paddingHorizontal: 14,
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
      <Ionicons name={icon} size={22} color={ink} />
      <Text style={{ fontSize: 15, fontWeight: '700', color: ink }}>{label}</Text>
    </Pressable>
  );
}
