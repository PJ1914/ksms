import { router, Stack } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
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
import {
  Badge,
  Button,
  Card,
  Choice,
  EmptyState,
  ErrorText,
  Field,
  KeyValue,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { isNetworkFailure } from '@/sync/backoff';
import { removeLocalHeldBillByServerId } from '@/sync/cache-store';
import { useSync } from '@/sync/SyncProvider';
import { colors } from '@/theme/colors';
import { formatINR, isPositive, isZero } from '@/utils/currency';
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
  const { cart, update, remove, setBillDiscount, clear, checkoutKey } = useCart();
  const { db, holdBill } = useSync();
  const [payments, setPayments] = useState<PaymentEntry[]>([]);
  const [allowOverLimit, setAllowOverLimit] = useState(false);
  const [preview, setPreview] = useState<SalePreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <Screen
      footer={
        <View>
          {blocker && !cartIsEmpty(cart) ? (
            <Text style={{ color: colors.textMuted, marginBottom: 6, fontSize: 13 }}>
              {blocker}
            </Text>
          ) : null}
          <ErrorText message={error} />
          <Button
            title={total ? `Pay ${formatINR(total)}` : 'Pay'}
            onPress={pay}
            busy={busy}
            disabled={!!blocker}
          />
        </View>
      }
    >
      <Stack.Screen
        options={{
          title: cart.heldBillId ? 'Held bill' : 'New bill',
          headerRight: () =>
            cartIsEmpty(cart) ? null : (
              <Text
                accessibilityRole="button"
                onPress={confirmClear}
                style={{ color: colors.danger, fontWeight: '600' }}
              >
                Clear
              </Text>
            ),
        }}
      />

      <Button title="Add items" onPress={() => router.push('/sale/add-item')} />

      {cartIsEmpty(cart) ? (
        <EmptyState
          icon="cart-outline"
          title="The bill is empty"
          note="Tap Add items to search, or scan a barcode."
        />
      ) : (
        <>
          <SectionTitle>Items</SectionTitle>
          {cart.lines.map((l, i) => {
            const pl = preview?.lines[i];
            return (
              <Card key={l.key}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ flex: 1, fontSize: 16, fontWeight: '600', color: colors.text }}>
                    {l.name}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${l.name}`}
                    onPress={() => remove(l.key)}
                    hitSlop={10}
                  >
                    <Ionicons name="trash-outline" size={22} color={colors.danger} />
                  </Pressable>
                </View>
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Field
                      label={`Quantity (${l.unitCode})`}
                      value={l.quantity}
                      onChangeText={(v) => update(l.key, { quantity: v })}
                      keyboardType="decimal-pad"
                    />
                  </View>
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
                {pl ? (
                  <Text style={{ textAlign: 'right', fontWeight: '700', color: colors.text }}>
                    {trimZeros(pl.quantity)} × {formatINR(pl.unitPrice)} = {formatINR(pl.net)}
                  </Text>
                ) : null}
              </Card>
            );
          })}

          <SectionTitle>Customer</SectionTitle>
          <Card>
            <KeyValue label="Bill for" value={cart.customerName ?? 'Walk-in customer'} bold />
            <Button
              title={cart.customerId ? 'Change customer' : 'Choose customer (for khata)'}
              variant="secondary"
              onPress={() => router.push('/sale/customer')}
            />
          </Card>

          {can('discount.apply') ? (
            <Field
              label="Discount on the whole bill ₹ (optional)"
              value={cart.billDiscount}
              onChangeText={setBillDiscount}
              keyboardType="decimal-pad"
            />
          ) : null}

          <ErrorText message={cartProblem ?? paymentProblem ?? previewError} />

          {preview ? (
            <>
              <SectionTitle>Total</SectionTitle>
              <Card>
                <KeyValue label="Items" value={formatINR(preview.subtotal)} />
                {isPositive(preview.discountTotal) ? (
                  <KeyValue
                    label="Discount"
                    value={`- ${formatINR(preview.discountTotal)}`}
                    tone="success"
                  />
                ) : null}
                {isPositive(preview.taxTotal) ? (
                  <>
                    <KeyValue label="Taxable value" value={formatINR(preview.taxableTotal)} />
                    {preview.interState ? (
                      <KeyValue label="IGST" value={formatINR(preview.igstTotal)} />
                    ) : (
                      <>
                        <KeyValue label="CGST" value={formatINR(preview.cgstTotal)} />
                        <KeyValue label="SGST" value={formatINR(preview.sgstTotal)} />
                      </>
                    )}
                  </>
                ) : null}
                {!isZero(preview.roundOff) ? (
                  <KeyValue label="Round off" value={formatINR(preview.roundOff)} tone="muted" />
                ) : null}
                <KeyValue label="Total to pay" value={formatINR(preview.total)} bold />
              </Card>

              {stockProblem ? (
                <Card style={{ backgroundColor: colors.dangerSoft, borderColor: colors.danger }}>
                  {preview.warnings.stock.map((w) => {
                    const line = cart.lines.find((l) => l.productId === w.productId);
                    return (
                      <Text key={w.productId} style={{ color: colors.danger }}>
                        {line?.name ?? 'An item'}: only {trimZeros(w.availableBaseQuantity)} in
                        stock
                      </Text>
                    );
                  })}
                </Card>
              ) : null}

              <SectionTitle>Payment</SectionTitle>
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <Button
                  title={`Cash ${formatINR(preview.total)}`}
                  variant="secondary"
                  onPress={() => setPayments([{ method: 'CASH', amount: preview.total }])}
                />
                <Button
                  title={`UPI ${formatINR(preview.total)}`}
                  variant="secondary"
                  onPress={() => setPayments([{ method: 'UPI', amount: preview.total }])}
                />
                {cart.customerId ? (
                  <Button
                    title="All on khata"
                    variant="secondary"
                    onPress={() => setPayments([])}
                  />
                ) : null}
              </View>
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
                  <Button
                    title="Remove this payment"
                    variant="secondary"
                    onPress={() => setPayments((prev) => prev.filter((_, idx) => idx !== i))}
                  />
                </Card>
              ))}
              <Button
                title={payments.length ? 'Add another payment (split)' : 'Add a payment'}
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

              <Card>
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

              {limitProblem && preview.warnings.creditLimit ? (
                <Card style={{ backgroundColor: colors.warningSoft, borderColor: colors.warning }}>
                  <Text style={{ color: colors.warning, fontWeight: '600' }}>
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
                    <Text style={{ color: colors.warning, marginTop: 6 }}>
                      Take more payment now, or ask a manager.
                    </Text>
                  )}
                </Card>
              ) : null}
            </>
          ) : null}

          <View style={{ height: 12 }} />
          <Button title="Hold this bill for later" variant="secondary" onPress={hold} busy={busy} />
        </>
      )}
    </Screen>
  );
}
