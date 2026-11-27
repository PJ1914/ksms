import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import {
  ADD_REASONS,
  REMOVE_REASONS,
  type StockForm,
  buildStockRequest,
  validateStockForm,
} from '@ksms/validation';
import { getData } from '@/api/client';
import type { ProductDetail, StockDetail } from '@/api/types';
import { SupplierPicker } from '@/components/SupplierPicker';
import { Button, Choice, ErrorText, Field, FormHeader, Loading, Screen } from '@/components/ui';
import { icons } from '@/theme/art';
import { colors } from '@/theme/colors';
import { useLoad } from '@/hooks/useLoad';
import { useSubmit } from '@/hooks/useSubmit';
import { formatDate, trimZeros } from '@/utils/format';

type Mode = 'OPENING' | 'ADD' | 'REMOVE';
const TITLES: Record<Mode, string> = {
  OPENING: 'Opening stock',
  ADD: 'Add stock',
  REMOVE: 'Remove stock',
};

export default function StockAdjustScreen() {
  const { productId, mode: rawMode } = useLocalSearchParams<{ productId: string; mode: string }>();
  const mode: Mode = rawMode === 'OPENING' || rawMode === 'REMOVE' ? rawMode : 'ADD';
  const {
    data,
    loading,
    error: loadError,
  } = useLoad(async () => {
    const [product, stock] = await Promise.all([
      getData<ProductDetail>(`/products/${productId}`),
      getData<StockDetail>(`/inventory/balances/${productId}`),
    ]);
    return { product, stock };
  }, [productId]);

  const { run, busy, error, setError } = useSubmit();
  const [unitId, setUnitId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [reason, setReason] = useState<string>(
    mode === 'REMOVE' ? 'DAMAGE' : mode === 'ADD' ? 'FOUND' : '',
  );
  const [notes, setNotes] = useState('');
  const [batchId, setBatchId] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [supplierId, setSupplierId] = useState('');

  if (loading) return <Loading />;
  if (!data) return <ErrorText message={loadError ?? 'Could not load this product.'} />;
  const { product, stock } = data;
  const tracked = product.trackBatch || product.trackExpiry;
  const chosenUnit = unitId ?? product.baseUnit.id;
  const unit = product.conversions.find((c) => c.unitId === chosenUnit);

  const form: StockForm = {
    mode,
    productId: product.id,
    unitId: chosenUnit,
    quantity,
    unitCost,
    reason,
    notes,
    // only one batch to take from: use it without asking
    batchId: batchId || (stock.batches.length === 1 ? stock.batches[0]!.id : ''),
    batchNumber,
    expiryDate,
    tracked,
    supplierId,
  };

  async function save() {
    const problem = validateStockForm(form);
    if (problem) return setError(problem);
    const { path, body } = buildStockRequest(form);
    const result = await run(path, body);
    if (result) router.back();
  }

  return (
    <Screen
      footer={<Button title={`Save ${TITLES[mode].toLowerCase()}`} onPress={save} busy={busy} />}
    >
      <Stack.Screen options={{ title: `${TITLES[mode]}: ${product.name}` }} />
      <FormHeader
        art={icons.stockAdjust}
        title={TITLES[mode]}
        note={`Now in stock: ${trimZeros(stock.quantityOnHand)} ${stock.baseUnitCode}`}
      />

      {product.conversions.length > 1 ? (
        <Choice
          label="Unit"
          options={product.conversions.map((c) => ({ key: c.unitId, label: c.unitCode }))}
          value={chosenUnit}
          onChange={setUnitId}
        />
      ) : null}

      <Field
        label={`How many${unit ? ` (${unit.unitCode})` : ''}`}
        value={quantity}
        onChangeText={setQuantity}
        keyboardType="decimal-pad"
        placeholder="e.g. 25"
        autoFocus
        hint={
          unit && !unit.isBase
            ? `1 ${unit.unitCode} = ${trimZeros(unit.factorToBase)} ${product.baseUnit.code}`
            : undefined
        }
      />

      {mode !== 'REMOVE' ? (
        <Field
          label={
            mode === 'OPENING'
              ? `Cost of one ${unit?.unitCode ?? 'unit'} (₹)`
              : `Cost of one ${unit?.unitCode ?? 'unit'} (₹, optional)`
          }
          value={unitCost}
          onChangeText={setUnitCost}
          keyboardType="decimal-pad"
          placeholder="e.g. 40.50"
          hint={mode === 'ADD' ? 'Leave empty to use the current average cost.' : undefined}
        />
      ) : null}

      {mode === 'ADD' ? (
        <Choice
          label="Reason"
          options={ADD_REASONS.map((r) => ({ key: r.key, label: r.label }))}
          value={reason}
          onChange={setReason}
        />
      ) : null}
      {mode === 'REMOVE' ? (
        <Choice
          label="Reason"
          options={REMOVE_REASONS.map((r) => ({ key: r.key, label: r.label }))}
          value={reason}
          onChange={setReason}
        />
      ) : null}

      {tracked && mode === 'REMOVE' ? (
        stock.batches.length > 1 ? (
          <Choice
            label="From which batch"
            options={stock.batches.map((b) => ({
              key: b.id,
              label: `${b.batchNumber}${b.expiryDate ? ` · ${formatDate(b.expiryDate)}` : ''} (${trimZeros(b.quantity)})`,
            }))}
            value={batchId}
            onChange={setBatchId}
          />
        ) : stock.batches.length === 0 ? (
          <ErrorText message="There are no batches with stock to remove from." />
        ) : null
      ) : null}

      {tracked && mode !== 'REMOVE' ? (
        <>
          <Field
            label="Batch number"
            value={batchNumber}
            onChangeText={setBatchNumber}
            autoCapitalize="characters"
            placeholder="e.g. B-2611"
          />
          <Field
            label="Expiry date"
            value={expiryDate}
            onChangeText={setExpiryDate}
            placeholder="YYYY-MM-DD, e.g. 2026-12-31"
            keyboardType="numbers-and-punctuation"
          />
        </>
      ) : null}

      {mode !== 'REMOVE' ? <SupplierPicker value={supplierId} onChange={setSupplierId} /> : null}

      {mode !== 'OPENING' ? (
        showNote || notes ? (
          <Field
            label="Note"
            value={notes}
            onChangeText={setNotes}
            placeholder="e.g. found behind the shelf"
            autoFocus
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowNote(true)}
            style={{ minHeight: 44, justifyContent: 'center' }}
          >
            <Text style={{ color: colors.primary, fontWeight: '700' }}>+ Add a note</Text>
          </Pressable>
        )
      ) : null}

      <ErrorText message={error} />
    </Screen>
  );
}
