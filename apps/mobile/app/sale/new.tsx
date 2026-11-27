import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  type ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  type PaymentEntry,
  amountLeft,
  cartIsEmpty,
  fingerprint,
  idempotencyFor,
  previewBody,
  saleBody,
  validateCart,
  validatePayments,
} from '@ksms/validation';
import { ApiError } from '@ksms/api-client';
import { deleteData, newKey, postData } from '@/api/client';
import type { SalePreview } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { useCart } from '@/cart/CartProvider';
import { ProductPicker } from './add-item';
import { useShortcut } from '@/hooks/useShortcut';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Choice,
  EmptyState,
  ErrorText,
  Field,
  IconTile,
  KeyValue,
  Screen,
  SectionTitle,
  MAX_FONT_SCALE,
  useLayout,
} from '@/components/ui';
import { icons, illustrations } from '@/theme/art';
import { isNetworkFailure } from '@/sync/backoff';
import { removeLocalHeldBillByServerId } from '@/sync/cache-store';
import { useSync } from '@/sync/SyncProvider';
import { colors, radius, shadow } from '@/theme/colors';
import { formatINR, isPositive, isZero, stepQuantity } from '@/utils/currency';
import { haptic } from '@/utils/haptics';
import { friendlyError } from '@/utils/errors';
import { trimZeros } from '@/utils/format';

const METHODS = [
  { key: 'CASH', label: 'Cash' },
  { key: 'UPI', label: 'UPI' },
  { key: 'CARD', label: 'Card' },
  { key: 'BANK_TRANSFER', label: 'Bank' },
] as const;

export default function NewBillScreen() {
  const { can, branch } = useAuth();
  const layout = useLayout();
  const desktop = layout.mode === 'desktop';
  const { cart, update, remove, setBillDiscount, clear, checkoutKey } = useCart();
  const { db, holdBill } = useSync();
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [allowOverLimit, setAllowOverLimit] = useState(false);
  const [preview, setPreview] = useState<SalePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openLine, setOpenLine] = useState<string | null>(null);
  const [showBillDiscount, setShowBillDiscount] = useState(false);
  const [splitOpen, setSplitOpen] = useState(false);

  const cartProblem = cartIsEmpty(cart) ? null : validateCart(cart);
  const paymentProblem = validatePayments(payments);
  const request = useMemo(
    () => (cartIsEmpty(cart) || cartProblem || paymentProblem ? null : previewBody(cart, payments)),
    [cart, payments, cartProblem, paymentProblem],
  );
  const requestKey = request ? fingerprint(request) : null;

  // The figures on screen come from the server's own pricing code (the same code checkout uses).
  useEffect(() => {
    setPreviewError(null);
    if (!request) {
      setPreview(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      postData<SalePreview>('/sales/preview', request)
        .then((p) => alive && setPreview(p))
        .catch((e) => {
          if (!alive) return;
          setPreview(null);
          setPreviewError(friendlyError(e));
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [requestKey]); // `request` is derived from it

  const total = preview?.total ?? null;
  const left = total ? amountLeft(total, payments) : null;
  const onCredit = left !== null && isPositive(left);
  const stockProblem = (preview?.warnings.stock.length ?? 0) > 0;
  const limitProblem = !!preview?.warnings.creditLimit;
  const creditBlocked = onCredit && !cart.customerId;

  const blocker = cartIsEmpty(cart)
    ? 'Add items to the bill.'
    : (cartProblem ??
      paymentProblem ??
      previewError ??
      (!preview ? 'Working out the total...' : null) ??
      (stockProblem ? 'Some items are not in stock (see below).' : null) ??
      (creditBlocked
        ? `Choose a customer to put ${formatINR(left!)} on khata, or take the full payment.`
        : null) ??
      (limitProblem && !allowOverLimit ? 'This is over the customer’s credit limit.' : null));

  async function pay() {
    if (blocker || !request || busy) return;
    setBusy(true);
    setError(null);
    try {
      const body = saleBody(cart, payments, allowOverLimit);
      // the key is kept above this screen: while the bill is unchanged, a retry reuses it and cannot sell twice
      checkoutKey.current = idempotencyFor(checkoutKey.current, { path: '/sales', body }, newKey);
      const sale = await postData<{ id: string }>('/sales', body, checkoutKey.current.key);
      clear();
      router.replace({ pathname: '/sale/[id]', params: { id: sale.id } });
    } catch (e) {
      const offline = isNetworkFailure(e);
      setError(
        offline
          ? 'No answer from the server. Checkout requires an internet connection — your draft bill is saved on this phone. If the bill may have gone through, tap Pay again when online: it will not be charged twice.'
          : friendlyError(e),
      );
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_STOCK') setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  async function hold() {
    if (cartIsEmpty(cart) || busy || !branch) return;
    setBusy(true);
    setError(null);
    try {
      const { heldBillId, ...payload } = cart;
      await holdBill({
        branchId: branch.id,
        ...(cart.customerName ? { label: cart.customerName } : {}),
        ...(cart.customerId ? { customerId: cart.customerId } : {}),
        payload,
      });
      if (heldBillId) {
        await deleteData(`/held-bills/${heldBillId}`).catch(() => undefined);
        if (db) await removeLocalHeldBillByServerId(db, heldBillId).catch(() => undefined);
      }
      clear();
      setPayments([]);
      router.back();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  function confirmClear() {
    Alert.alert('Clear this bill?', 'All items will be removed.', [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: () => {
          clear();
          setPayments([]);
        },
      },
    ]);
  }

  const setPayment = (i: number, patch: Partial<PaymentEntry>) =>
    setPayments((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  /** Quick payment: the whole bill by one method. 'KHATA' means nothing paid now. */
  const quick: 'CASH' | 'UPI' | 'KHATA' | 'SPLIT' | null = !preview
    ? null
    : payments.length === 0
      ? cart.customerId
        ? 'KHATA'
        : null
      : payments.length === 1 && payments[0]!.amount === preview.total
        ? payments[0]!.method === 'CASH'
          ? 'CASH'
          : payments[0]!.method === 'UPI'
            ? 'UPI'
            : 'SPLIT'
        : 'SPLIT';

  // Desktop POS shortcuts: F4 customer, F8 hold, F9 or Ctrl+Enter take payment, F2 search.
  useShortcut('F4', desktop ? () => router.push('/sale/customer') : undefined);
  useShortcut('F8', desktop && !busy ? () => void hold() : undefined);
  useShortcut('F9', desktop && !blocker ? () => void pay() : undefined);
  useShortcut('Ctrl+Enter', desktop && !blocker ? () => void pay() : undefined);

  const bill = (
    <Screen
      footer={
        <View>
          {blocker && !cartIsEmpty(cart) ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.blocker}>
              {blocker}
            </Text>
          ) : null}
          <ErrorText message={error} />
          <View style={styles.payRow}>
            <View>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.payLabel}>
                {cart.lines.length} item{cart.lines.length === 1 ? '' : 's'} · Total
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.payTotal}>
                {total ? formatINR(total) : '—'}
              </Text>
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title={quick === 'KHATA' ? 'Save on khata' : 'Save bill'}
                icon="checkmark"
                onPress={pay}
                busy={busy}
                disabled={!!blocker}
              />
            </View>
          </View>
        </View>
      }
    >
      <Stack.Screen
        options={{
          title: cart.heldBillId ? 'Held bill' : 'New bill',
          headerRight: () =>
            cartIsEmpty(cart) ? null : (
              <Pressable
                accessibilityRole="button"
                onPress={confirmClear}
                hitSlop={10}
                style={{ paddingHorizontal: 4 }}
              >
                <Text
                  maxFontSizeMultiplier={MAX_FONT_SCALE}
                  style={{ color: colors.danger, fontWeight: '700' }}
                >
                  Clear
                </Text>
              </Pressable>
            ),
        }}
      />

      {/* Customer */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={cart.customerId ? 'Change customer' : 'Choose customer'}
        onPress={() => router.push('/sale/customer')}
        style={({ pressed }) => [styles.customer, pressed && { opacity: 0.8 }]}
      >
        {cart.customerName ? (
          <Avatar name={cart.customerName} size={42} />
        ) : (
          <IconTile icon="person-outline" tint="blue" size={42} />
        )}
        <View style={{ flex: 1 }}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.customerName}>
            {cart.customerName ?? 'Walk-in customer'}
          </Text>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.customerSub}>
            {cart.customerId ? 'Tap to change' : 'Add a customer to give khata'}
          </Text>
        </View>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.link}>
          {cart.customerId ? 'Change' : 'Choose'}
        </Text>
      </Pressable>

      {/* Add items (on desktop the product list is already beside the bill) */}
      <View style={[styles.addRow, desktop && { display: 'none' }]}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/sale/add-item')}
          style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="search" size={20} color={colors.textMuted} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.addText}>
            Add item by name
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scan barcodes"
          onPress={() => router.push('/sale/scan')}
          style={({ pressed }) => [styles.scanBtn, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name="barcode-outline" size={24} color={colors.text} />
        </Pressable>
      </View>

      {cartIsEmpty(cart) ? (
        <EmptyState
          art={illustrations.emptyCart}
          title="The bill is empty"
          note="Search an item by name, or scan its barcode."
        />
      ) : (
        <>
          <View style={styles.lines}>
            {cart.lines.map((l, i) => {
              const pl = preview?.lines[i];
              const open = openLine === l.key;
              const canEditPrice = can('discount.apply') || can('price.override');
              return (
                <View key={l.key} style={[styles.line, i > 0 && styles.lineBorder]}>
                  <View style={styles.lineTop}>
                    <View style={{ flex: 1 }}>
                      <Text
                        maxFontSizeMultiplier={MAX_FONT_SCALE}
                        style={styles.lineName}
                        numberOfLines={2}
                      >
                        {l.name}
                      </Text>
                      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.lineSub}>
                        {pl ? `${formatINR(pl.unitPrice)} / ${l.unitCode}` : l.unitCode}
                        {pl && isPositive(pl.discount ?? '0') ? ' · discount' : ''}
                      </Text>
                    </View>
                    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.lineAmt}>
                      {pl ? formatINR(pl.net) : ''}
                    </Text>
                  </View>
                  <View style={styles.lineControls}>
                    <View style={styles.stepper}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`One less ${l.name}`}
                        onPress={() => {
                          haptic('tap');
                          update(l.key, { quantity: stepQuantity(l.quantity, -1) });
                        }}
                        style={styles.stepBtn}
                      >
                        <Ionicons name="remove" size={18} color={colors.primary} />
                      </Pressable>
                      <TextInput
                        maxFontSizeMultiplier={MAX_FONT_SCALE}
                        accessibilityLabel={`Quantity of ${l.name}`}
                        value={l.quantity}
                        onChangeText={(v) => update(l.key, { quantity: v })}
                        keyboardType="decimal-pad"
                        style={styles.qty}
                        selectTextOnFocus
                      />
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`One more ${l.name}`}
                        onPress={() => {
                          haptic('tap');
                          update(l.key, { quantity: stepQuantity(l.quantity, 1) });
                        }}
                        style={[styles.stepBtn, { backgroundColor: colors.primary }]}
                      >
                        <Ionicons name="add" size={18} color={colors.onPrimary} />
                      </Pressable>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      {canEditPrice ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityState={{ expanded: open }}
                          onPress={() => setOpenLine(open ? null : l.key)}
                          style={styles.iconBtn}
                        >
                          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.link}>
                            {open ? 'Done' : 'More'}
                          </Text>
                        </Pressable>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${l.name}`}
                        onPress={() => {
                          haptic('tap');
                          remove(l.key);
                        }}
                        style={styles.iconBtn}
                      >
                        <Ionicons name="trash-outline" size={20} color={colors.danger} />
                      </Pressable>
                    </View>
                  </View>
                  {open ? (
                    <View style={{ flexDirection: 'row', gap: 10, marginTop: 10 }}>
                      {can('discount.apply') ? (
                        <View style={{ flex: 1 }}>
                          <Field
                            label="Discount ₹"
                            value={l.discount}
                            onChangeText={(v) => update(l.key, { discount: v })}
                            keyboardType="decimal-pad"
                          />
                        </View>
                      ) : null}
                      {can('price.override') ? (
                        <View style={{ flex: 1 }}>
                          <Field
                            label={`Price/${l.unitCode} ₹`}
                            value={l.unitPrice}
                            onChangeText={(v) => update(l.key, { unitPrice: v })}
                            keyboardType="decimal-pad"
                            placeholder={pl?.unitPrice}
                          />
                        </View>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            })}

            {preview ? (
              <View style={[styles.totals, styles.lineBorder]}>
                {isPositive(preview.discountTotal) ? (
                  <KeyValue
                    label="Discount"
                    value={`- ${formatINR(preview.discountTotal)}`}
                    tone="success"
                  />
                ) : null}
                {isPositive(preview.taxTotal) ? (
                  <>
                    <KeyValue
                      label="Taxable value"
                      value={formatINR(preview.taxableTotal)}
                      tone="muted"
                    />
                    {preview.interState ? (
                      <KeyValue label="IGST" value={formatINR(preview.igstTotal)} tone="muted" />
                    ) : (
                      <KeyValue
                        label="CGST + SGST"
                        value={`${formatINR(preview.cgstTotal)} + ${formatINR(preview.sgstTotal)}`}
                        tone="muted"
                      />
                    )}
                  </>
                ) : null}
                {!isZero(preview.roundOff) ? (
                  <KeyValue label="Round off" value={formatINR(preview.roundOff)} tone="muted" />
                ) : null}
                <KeyValue label="Total to pay" value={formatINR(preview.total)} bold />
              </View>
            ) : null}
          </View>

          {can('discount.apply') ? (
            showBillDiscount || cart.billDiscount ? (
              <Field
                label="Discount on the whole bill ₹"
                value={cart.billDiscount}
                onChangeText={setBillDiscount}
                keyboardType="decimal-pad"
              />
            ) : (
              <Pressable
                accessibilityRole="button"
                onPress={() => setShowBillDiscount(true)}
                style={{ minHeight: 44, justifyContent: 'center' }}
              >
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.link}>
                  + Discount on the whole bill
                </Text>
              </Pressable>
            )
          ) : null}

          <ErrorText message={cartProblem ?? paymentProblem ?? previewError} />

          {preview && stockProblem ? (
            <Card tint="tomato">
              {preview.warnings.stock.map((w) => {
                const line = cart.lines.find((l) => l.productId === w.productId);
                return (
                  <Text
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                    key={w.productId}
                    style={{ color: colors.danger, fontWeight: '600' }}
                  >
                    {line?.name ?? 'An item'}: only {trimZeros(w.availableBaseQuantity)} in stock
                  </Text>
                );
              })}
            </Card>
          ) : null}

          {preview ? (
            <>
              <SectionTitle>How is the customer paying?</SectionTitle>
              <View style={styles.methods}>
                <MethodTile
                  art={icons.payCash}
                  label="Cash"
                  selected={quick === 'CASH'}
                  onPress={() => setPayments([{ method: 'CASH', amount: preview.total }])}
                />
                <MethodTile
                  art={icons.payUpi}
                  label="UPI"
                  selected={quick === 'UPI'}
                  onPress={() => setPayments([{ method: 'UPI', amount: preview.total }])}
                />
                <MethodTile
                  art={icons.payKhata}
                  label="Khata"
                  selected={quick === 'KHATA'}
                  disabled={!cart.customerId}
                  onPress={() =>
                    cart.customerId ? setPayments([]) : router.push('/sale/customer')
                  }
                />
              </View>
              {!cart.customerId ? (
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.methodNote}>
                  Choose a customer above to put the bill on khata.
                </Text>
              ) : null}

              {quick === 'SPLIT' || splitOpen ? (
                <>
                  {payments.map((p, i) => (
                    <Card key={i}>
                      <Choice
                        options={METHODS}
                        value={p.method}
                        onChange={(m) => setPayment(i, { method: m })}
                      />
                      <View style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={{ flex: 1 }}>
                          <Field
                            label="Amount ₹"
                            value={p.amount}
                            onChangeText={(v) => setPayment(i, { amount: v })}
                            keyboardType="decimal-pad"
                          />
                        </View>
                        {p.method !== 'CASH' ? (
                          <View style={{ flex: 1 }}>
                            <Field
                              label="Reference"
                              value={p.referenceNo ?? ''}
                              onChangeText={(v) => setPayment(i, { referenceNo: v })}
                            />
                          </View>
                        ) : null}
                      </View>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => setPayments((prev) => prev.filter((_, idx) => idx !== i))}
                        style={{ minHeight: 40, justifyContent: 'center' }}
                      >
                        <Text
                          maxFontSizeMultiplier={MAX_FONT_SCALE}
                          style={{ color: colors.danger, fontWeight: '700' }}
                        >
                          Remove this payment
                        </Text>
                      </Pressable>
                    </Card>
                  ))}
                  <Button
                    icon="add"
                    title={payments.length ? 'Add another payment' : 'Add a payment'}
                    variant="secondary"
                    onPress={() =>
                      setPayments((prev) => [
                        ...prev,
                        {
                          method: prev.length ? 'UPI' : 'CASH',
                          amount: left && isPositive(left) ? left : '',
                        },
                      ])
                    }
                  />
                </>
              ) : (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => setSplitOpen(true)}
                  style={{ minHeight: 44, justifyContent: 'center' }}
                >
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.link}>
                    Split payment, card or bank transfer
                  </Text>
                </Pressable>
              )}

              {payments.length > 0 || onCredit ? (
                <Card tint={onCredit ? 'mango' : 'green'} style={{ marginTop: 8 }}>
                  <KeyValue label="Paid now" value={formatINR(preview.paid)} />
                  <KeyValue
                    label={onCredit ? 'Goes on khata' : 'Left to pay'}
                    value={formatINR(left ?? '0')}
                    tone={onCredit ? 'danger' : 'muted'}
                    bold
                  />
                  {onCredit && cart.customerId ? (
                    <Badge text={`Owed by ${cart.customerName}`} tone="warn" />
                  ) : null}
                </Card>
              ) : null}

              {limitProblem && preview.warnings.creditLimit ? (
                <Card tint="mango">
                  <Text
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                    style={{ color: colors.warning, fontWeight: '700' }}
                  >
                    Over the credit limit: limit{' '}
                    {formatINR(preview.warnings.creditLimit.creditLimit)}, already owes{' '}
                    {formatINR(preview.warnings.creditLimit.balance)}, can still take{' '}
                    {formatINR(preview.warnings.creditLimit.available)}.
                  </Text>
                  {can('credit.override_limit') ? (
                    <Button
                      title={
                        allowOverLimit
                          ? 'Going over the limit is allowed (tap to undo)'
                          : 'Allow this bill over the limit'
                      }
                      variant={allowOverLimit ? 'primary' : 'secondary'}
                      onPress={() => setAllowOverLimit((v) => !v)}
                    />
                  ) : (
                    <Text
                      maxFontSizeMultiplier={MAX_FONT_SCALE}
                      style={{ color: colors.warning, marginTop: 6 }}
                    >
                      Take more payment now, or ask a manager.
                    </Text>
                  )}
                </Card>
              ) : null}
            </>
          ) : null}

          <Button
            icon="pause"
            title="Hold this bill for later"
            variant="secondary"
            onPress={hold}
            busy={busy}
          />
        </>
      )}
    </Screen>
  );

  if (!desktop) return bill;
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.background }}>
      <View style={{ flex: 3, minWidth: 0 }}>
        <ProductPicker embedded />
      </View>
      <View
        style={{
          flex: 2,
          minWidth: 420,
          maxWidth: 560,
          borderLeftWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        {bill}
      </View>
    </View>
  );
}

function MethodTile({
  art,
  label,
  selected,
  disabled,
  onPress,
}: {
  art: ImageSourcePropType;
  label: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.method,
        selected && styles.methodOn,
        disabled && { opacity: 0.55 },
        pressed && { opacity: 0.8 },
      ]}
    >
      <Image source={art} style={{ width: 40, height: 40 }} resizeMode="contain" />
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.methodText, selected && { color: colors.primary }]}
      >
        {label}
      </Text>
      {selected ? (
        <View style={styles.methodCheck}>
          <Ionicons name="checkmark" size={14} color={colors.onPrimary} />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  blocker: { color: colors.textMuted, marginBottom: 6, fontSize: 13 },
  payRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  payLabel: { fontSize: 12, color: colors.textMuted },
  payTotal: { fontSize: 24, fontWeight: '800', color: colors.text },
  customer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 12,
    marginBottom: 12,
    ...shadow.card,
    shadowOpacity: 0.04,
  },
  customerName: { fontSize: 15, fontWeight: '700', color: colors.text },
  customerSub: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  link: { fontSize: 14, fontWeight: '700', color: colors.primary },
  addRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  addBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  addText: { fontSize: 16, color: colors.textMuted },
  scanBtn: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  lines: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    marginBottom: 12,
    ...shadow.card,
  },
  line: { paddingVertical: 12 },
  lineBorder: { borderTopWidth: 1, borderTopColor: '#EEF3EF' },
  lineTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  lineName: { fontSize: 15, fontWeight: '700', color: colors.text },
  lineSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  lineAmt: { fontSize: 16, fontWeight: '800', color: colors.text },
  lineControls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  qty: {
    minWidth: 56,
    height: 40,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '800',
    color: colors.text,
    borderRadius: 10,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 6,
  },
  iconBtn: { minWidth: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  totals: { paddingVertical: 10 },
  methods: { flexDirection: 'row', gap: 10 },
  method: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  methodOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  methodText: { fontSize: 14, fontWeight: '700', color: colors.text },
  methodCheck: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  methodNote: { fontSize: 12, color: colors.textMuted, marginTop: 8 },
});
