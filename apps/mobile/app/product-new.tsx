import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { newKey, postData } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { api } from '@/auth/session';
import { BarcodeScannerModal } from '@/components/BarcodeScannerModal';
import { Button, Card, Choice, ErrorText, Field, SectionTitle } from '@/components/ui';
import { colors } from '@/theme/colors';
import { friendlyError } from '@/utils/errors';
import {
  SELL_BY,
  type SellBy,
  type UnitRow,
  buildOpeningStockPayload,
  buildProductPayload,
  validateProductForm,
} from '@ksms/validation';

const GST_RATES = [
  { key: 'NONE', label: 'No GST' },
  { key: '5', label: '5%' },
  { key: '12', label: '12%' },
  { key: '18', label: '18%' },
  { key: '28', label: '28%' },
] as const;

export default function NewProductScreen() {
  const { can } = useAuth();
  const params = useLocalSearchParams<{ barcode?: string }>();
  const [name, setName] = useState('');
  const [sellBy, setSellBy] = useState<SellBy>('KG');
  const [price, setPrice] = useState('');
  const [mrp, setMrp] = useState('');
  const [barcode, setBarcode] = useState(params.barcode ?? '');
  const [openingQuantity, setOpeningQuantity] = useState('');
  const [openingCost, setOpeningCost] = useState('');
  const [scanning, setScanning] = useState(false);
  const [gstRate, setGstRate] = useState<string>('NONE');
  const [hsnCode, setHsnCode] = useState('');
  const [units, setUnits] = useState<UnitRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If product creation succeeded but opening-stock failed on a bad signal, retrying won't duplicate the product.
  const createdProduct = useRef<{ id: string; baseUnitId: string } | null>(null);
  const stockKey = useRef<string | null>(null);

  useEffect(() => {
    api
      .get<{ data: UnitRow[] }>('/units')
      .then((r) => setUnits(r.data))
      .catch((e) => setError(friendlyError(e)));
  }, []);

  const unitLabel = sellBy === 'KG' ? '1 kg' : sellBy === 'L' ? '1 litre' : '1 piece';
  const unitCode = sellBy === 'KG' ? 'kg' : sellBy === 'L' ? 'L' : 'pcs';
  const canAdjustStock = can('stock.adjust');

  async function save() {
    const input = {
      name,
      sellBy,
      price,
      mrp,
      barcode,
      autoCategorize: true,
      openingQuantity: canAdjustStock ? openingQuantity : '',
      openingCost: canAdjustStock ? openingCost : '',
      isTaxable: gstRate !== 'NONE',
      gstRatePercent: gstRate !== 'NONE' ? gstRate : '',
      hsnCode,
    };
    const problem = validateProductForm(input);
    if (problem) return setError(problem);
    if (!units) return setError('Still loading units. Please wait a moment.');
    setBusy(true);
    setError(null);
    try {
      if (!createdProduct.current) {
        const created = await postData<{ id: string; baseUnit: { id: string } }>(
          '/products',
          buildProductPayload(input, units),
        );
        createdProduct.current = { id: created.id, baseUnitId: created.baseUnit.id };
      }

      const stockBody = buildOpeningStockPayload(
        createdProduct.current.id,
        createdProduct.current.baseUnitId,
        input,
      );
      if (stockBody) {
        stockKey.current ??= newKey();
        await postData('/inventory/opening-stock', stockBody, stockKey.current);
      }

      router.back();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <>
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        <Field
          label="Product name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Sona Masoori Rice"
          autoCapitalize="words"
        />

        <View style={{ marginBottom: 4 }}>
          <Field
            label="Barcode (optional)"
            value={barcode}
            onChangeText={setBarcode}
            placeholder="Scan packet or type barcode"
          />
          <Button
            title={barcode ? 'Scan another barcode' : 'Scan barcode with camera'}
            variant="secondary"
            onPress={() => setScanning(true)}
          />
        </View>

        <Text style={[styles.label, { marginTop: 10 }]}>Sold</Text>
        <View style={styles.choices}>
          {SELL_BY.map((s) => {
            const selected = s.key === sellBy;
            return (
              <Pressable
                key={s.key}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => setSellBy(s.key)}
                style={[styles.choice, selected && styles.choiceSelected]}
              >
                <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
                  {s.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Field
          label={`Selling price for ${unitLabel} (₹)`}
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          placeholder="e.g. 52.50"
        />

        <Field
          label={`MRP for ${unitLabel} (optional, ₹)`}
          value={mrp}
          onChangeText={setMrp}
          keyboardType="decimal-pad"
          placeholder="Printed MRP on pack"
        />

        {canAdjustStock ? (
          <>
            <SectionTitle>Opening stock (optional)</SectionTitle>
            <Card>
              <Field
                label={`How many in stock right now (${unitCode})`}
                value={openingQuantity}
                onChangeText={setOpeningQuantity}
                keyboardType="decimal-pad"
                placeholder="Leave empty for 0 stock"
              />
              {openingQuantity.trim() !== '' ? (
                <Field
                  label={`Purchase / cost price per ${unitLabel} (₹, optional)`}
                  value={openingCost}
                  onChangeText={setOpeningCost}
                  keyboardType="decimal-pad"
                  placeholder="0"
                  hint="Used for profit calculation. Leave empty if unknown (uses ₹0)."
                />
              ) : null}
            </Card>
          </>
        ) : null}

        <Choice
          label="GST rate (when shop GST is on)"
          options={GST_RATES}
          value={gstRate}
          onChange={setGstRate}
        />

        <Field
          label="HSN code (optional, 4-8 digits)"
          value={hsnCode}
          onChangeText={setHsnCode}
          keyboardType="number-pad"
          placeholder="e.g. 1006"
          maxLength={8}
        />

        <Text style={styles.note}>
          More barcodes, categories and pack units can also be updated anytime from Edit product.
        </Text>
        <ErrorText message={error} />
        <Button title="Save product" onPress={save} busy={busy} />
      </ScrollView>

      <BarcodeScannerModal
        visible={scanning}
        title="Scan product barcode"
        hint="Point the camera at the packet barcode to fill it in."
        onScanned={(code) => {
          setBarcode(code);
          setScanning(false);
        }}
        onClose={() => setScanning(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 32 },
  label: { fontSize: 14, fontWeight: '500', color: colors.text, marginBottom: 6 },
  choices: { gap: 8, marginBottom: 14 },
  choice: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  choiceSelected: { borderColor: colors.primary, backgroundColor: '#E6F1EC' },
  choiceText: { fontSize: 15, color: colors.text },
  choiceTextSelected: { color: colors.primary, fontWeight: '600' },
  note: { fontSize: 13, color: colors.textMuted, marginBottom: 12 },
});
