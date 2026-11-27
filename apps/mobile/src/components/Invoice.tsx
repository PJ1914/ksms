import { useState } from 'react';
import { Text, View } from 'react-native';
import type { BranchDetail, OrganizationSettings, SaleDetail } from '@/api/types';
import { colors } from '@/theme/colors';
import { formatINR, isPositive, isZero } from '@/utils/currency';
import { formatDateTime, trimZeros, words } from '@/utils/format';
import { rupeesInWords } from '@/utils/words';
import { MAX_FONT_SCALE } from './ui';

export interface ShopDetails {
  org: Pick<OrganizationSettings, 'name' | 'legalName' | 'phone' | 'email'> | null;
  branch: Pick<
    BranchDetail,
    'name' | 'addressLine' | 'city' | 'state' | 'pincode' | 'gstin' | 'phone'
  > | null;
  fallbackName: string;
}

const INK = '#15241B';
const LINE = '#C9D3CC';

function T({
  children,
  size = 13,
  bold,
  muted,
  align,
  style,
}: {
  children: React.ReactNode;
  size?: number;
  bold?: boolean;
  muted?: boolean;
  align?: 'left' | 'right' | 'center';
  style?: object;
}) {
  return (
    <Text
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      style={[
        {
          fontSize: size,
          color: muted ? colors.textMuted : INK,
          fontWeight: bold ? '700' : '400',
          textAlign: align,
        },
        style,
      ]}
    >
      {children}
    </Text>
  );
}

const COLS = { n: 28, qty: 80, rate: 78, disc: 64, gst: 52, amt: 92 } as const;

function Cell({
  children,
  width,
  align,
  bold,
  head,
}: {
  children: React.ReactNode;
  width?: number;
  align?: 'left' | 'right' | 'center';
  bold?: boolean;
  head?: boolean;
}) {
  return (
    <View style={{ width, flex: width ? undefined : 1, paddingHorizontal: 6, paddingVertical: 7 }}>
      <T size={head ? 12 : 13} bold={bold || head} align={align} muted={head}>
        {children}
      </T>
    </View>
  );
}

function Row({
  label,
  value,
  bold,
  big,
}: {
  label: string;
  value: string;
  bold?: boolean;
  big?: boolean;
}) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 }}>
      <T size={big ? 17 : 13} bold={bold || big}>
        {label}
      </T>
      <T size={big ? 17 : 13} bold={bold || big} align="right">
        {value}
      </T>
    </View>
  );
}

/** A printable bill: shop header, items table, GST breakup, totals, payment and footer. */
export function Invoice({ sale: s, shop }: { sale: SaleDetail; shop: ShopDetails }) {
  // Phones are too narrow for a six-column table: below this width each item becomes a two-line row.
  const [width, setWidth] = useState(0);
  const compact = width > 0 && width < 560;
  const shopName = shop.org?.legalName || shop.org?.name || shop.fallbackName;
  const b = shop.branch;
  const address = [b?.addressLine, [b?.city, b?.state].filter(Boolean).join(', '), b?.pincode]
    .filter(Boolean)
    .join(' - ')
    .replace(' - undefined', '');
  const phone = b?.phone || shop.org?.phone;
  const gst = s.invoice?.type === 'GST';
  const title =
    s.invoice?.type === 'GST'
      ? 'TAX INVOICE'
      : s.invoice?.type === 'BILL_OF_SUPPLY'
        ? 'BILL OF SUPPLY'
        : 'RETAIL INVOICE';
  const hasTax = isPositive(s.taxTotal);
  const showGstCol = gst || hasTax;
  const cancelled = s.status === 'CANCELLED';

  return (
    <View
      nativeID="invoice-print"
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{
        width: '100%',
        maxWidth: 820,
        alignSelf: 'center',
        backgroundColor: '#FFFFFF',
        borderWidth: 1,
        borderColor: LINE,
        borderRadius: 6,
        padding: compact ? 14 : 28,
      }}
    >
      {/* Shop header */}
      <View style={{ alignItems: 'center', gap: 3, paddingBottom: 14 }}>
        <T size={compact ? 21 : 26} bold align="center">
          {shopName}
        </T>
        {address ? (
          <T size={13} muted align="center">
            {address}
          </T>
        ) : null}
        <T size={13} muted align="center">
          {[phone ? `Phone: ${phone}` : '', shop.org?.email ?? ''].filter(Boolean).join('   ·   ')}
        </T>
        {b?.gstin ? (
          <T size={13} bold align="center">
            GSTIN: {b.gstin}
          </T>
        ) : null}
      </View>

      <View
        style={{
          borderTopWidth: 2,
          borderBottomWidth: 2,
          borderColor: INK,
          paddingVertical: 7,
          alignItems: 'center',
        }}
      >
        <T size={16} bold>
          {title}
          {cancelled ? '  (CANCELLED)' : ''}
        </T>
      </View>

      {/* Bill + customer */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingVertical: 12, gap: 16 }}>
        <View style={{ flex: 1, minWidth: compact ? '100%' : 220, gap: 3 }}>
          <T size={12} muted bold>
            BILL TO
          </T>
          <T size={15} bold>
            {s.customer?.name ?? 'Walk-in customer'}
          </T>
          {s.customer?.phone ? <T muted>Phone: {s.customer.phone}</T> : null}
          {s.customer?.gstin ? <T muted>GSTIN: {s.customer.gstin}</T> : null}
        </View>
        <View
          style={{
            flex: 1,
            minWidth: compact ? '100%' : 220,
            gap: 3,
            alignItems: compact ? 'flex-start' : 'flex-end',
          }}
        >
          <T bold>
            {s.invoice ? `Invoice No: ${s.invoice.invoiceNumber}` : `Bill No: ${s.saleNumber}`}
          </T>
          <T muted>Date: {formatDateTime(s.soldAt)}</T>
          <T muted>Billed by: {s.soldBy.fullName}</T>
        </View>
      </View>

      {/* Items */}
      <View style={{ borderWidth: 1, borderColor: LINE }}>
        {compact ? (
          s.items.map((i, idx) => (
            <View
              key={i.id}
              style={{
                flexDirection: 'row',
                gap: 8,
                padding: 8,
                borderTopWidth: idx ? 1 : 0,
                borderColor: '#E7EDE9',
              }}
            >
              <View style={{ flex: 1, gap: 2 }}>
                <T bold>
                  {idx + 1}. {i.name}
                </T>
                <T size={12} muted>
                  {`${trimZeros(i.quantity)} ${i.unitCode} × ${formatINR(i.unitPrice)}`}
                  {isPositive(i.discountAmount) ? `  ·  Disc ${formatINR(i.discountAmount)}` : ''}
                  {showGstCol && i.taxRatePercent ? `  ·  GST ${trimZeros(i.taxRatePercent)}%` : ''}
                  {i.hsn ? `  ·  HSN ${i.hsn}` : ''}
                </T>
              </View>
              <T bold align="right">
                {formatINR(i.lineTotal)}
              </T>
            </View>
          ))
        ) : (
          <>
            <View
              style={{
                flexDirection: 'row',
                backgroundColor: colors.surfaceMuted,
                borderBottomWidth: 1,
                borderColor: LINE,
              }}
            >
              <Cell width={COLS.n} head>
                #
              </Cell>
              <Cell head>Item</Cell>
              <Cell width={COLS.qty} align="right" head>
                Qty
              </Cell>
              <Cell width={COLS.rate} align="right" head>
                Rate
              </Cell>
              <Cell width={COLS.disc} align="right" head>
                Disc.
              </Cell>
              {showGstCol ? (
                <Cell width={COLS.gst} align="right" head>
                  GST%
                </Cell>
              ) : null}
              <Cell width={COLS.amt} align="right" head>
                Amount
              </Cell>
            </View>
            {s.items.map((i, idx) => (
              <View
                key={i.id}
                style={{
                  flexDirection: 'row',
                  borderTopWidth: idx ? 1 : 0,
                  borderColor: '#E7EDE9',
                }}
              >
                <Cell width={COLS.n}>{idx + 1}</Cell>
                <View style={{ flex: 1, paddingHorizontal: 6, paddingVertical: 7 }}>
                  <T bold>{i.name}</T>
                  {i.hsn ? (
                    <T size={11} muted>
                      HSN {i.hsn}
                    </T>
                  ) : null}
                </View>
                <Cell width={COLS.qty} align="right">
                  {`${trimZeros(i.quantity)} ${i.unitCode}`}
                </Cell>
                <Cell width={COLS.rate} align="right">
                  {formatINR(i.unitPrice).replace('₹', '')}
                </Cell>
                <Cell width={COLS.disc} align="right">
                  {isPositive(i.discountAmount)
                    ? formatINR(i.discountAmount).replace('₹', '')
                    : '-'}
                </Cell>
                {showGstCol ? (
                  <Cell width={COLS.gst} align="right">
                    {i.taxRatePercent ? `${trimZeros(i.taxRatePercent)}%` : '-'}
                  </Cell>
                ) : null}
                <Cell width={COLS.amt} align="right" bold>
                  {formatINR(i.lineTotal).replace('₹', '')}
                </Cell>
              </View>
            ))}
          </>
        )}
      </View>

      {/* Totals */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20, marginTop: 14 }}>
        <View style={{ flex: 1, minWidth: compact ? '100%' : 240, gap: 4 }}>
          <T size={12} muted bold>
            AMOUNT IN WORDS
          </T>
          <T bold>{rupeesInWords(s.total)}</T>
          {s.payments.length ? (
            <View style={{ marginTop: 10, gap: 2 }}>
              <T size={12} muted bold>
                PAYMENT
              </T>
              {s.payments
                .filter((p) => p.status === 'COMPLETED' || cancelled)
                .map((p) => (
                  <T key={p.paymentId}>
                    {words(p.method)}: {formatINR(p.amount)}
                  </T>
                ))}
              {isPositive(s.creditAmount) ? (
                <T>On khata (credit): {formatINR(s.creditAmount)}</T>
              ) : null}
            </View>
          ) : null}
        </View>

        <View style={{ width: compact ? '100%' : 300, maxWidth: '100%' }}>
          <Row label="Sub total" value={formatINR(s.subtotal)} />
          {isPositive(s.discountTotal) ? (
            <Row label="Discount" value={`- ${formatINR(s.discountTotal)}`} />
          ) : null}
          {hasTax ? (
            <>
              <Row label="Taxable value" value={formatINR(s.taxableTotal)} />
              {isPositive(s.igstTotal) ? (
                <Row label="IGST" value={formatINR(s.igstTotal)} />
              ) : (
                <>
                  <Row label="CGST" value={formatINR(s.cgstTotal)} />
                  <Row label="SGST" value={formatINR(s.sgstTotal)} />
                </>
              )}
            </>
          ) : null}
          {!isZero(s.roundOff) ? <Row label="Round off" value={formatINR(s.roundOff)} /> : null}
          <View
            style={{
              borderTopWidth: 2,
              borderBottomWidth: 2,
              borderColor: INK,
              marginTop: 6,
              paddingVertical: 4,
            }}
          >
            <Row big label="Grand total" value={formatINR(s.total)} />
          </View>
        </View>
      </View>

      {/* Footer */}
      <View
        style={{
          marginTop: 22,
          paddingTop: 12,
          borderTopWidth: 1,
          borderColor: LINE,
          alignItems: 'center',
          gap: 3,
        }}
      >
        <T bold align="center">
          Thank you for shopping with us. Visit again!
        </T>
        <T size={11} muted align="center">
          This is a computer generated bill.{gst ? ' Subject to local jurisdiction.' : ''}
        </T>
      </View>
    </View>
  );
}
