import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { newKey, postData } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { api } from '@/auth/session';
import { BarcodeScannerModal } from '@/components/BarcodeScannerModal';
import {
  Button,
  Card,
  Choice,
  CONTENT_MAX,
  ErrorText,
  Field,
  FormHeader,
  Segmented,
} from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { icons } from '@/theme/art';
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
  const [sellBy, setSellBy] = useState<SellBy>('PCS');
  const [more, setMore] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
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

  async function save(another: boolean) {
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

      if (another) {
        setSavedCount((n) => n + 1);
        resetForNext();
      } else {
        router.back();
      }
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  function resetForNext() {
    createdProduct.current = null;
    stockKey.current = null;
    setName('');
    setPrice('');
    setMrp('');
    setBarcode('');
    setOpeningQuantity('');
    setOpeningCost('');
    setHsnCode('');
    setBusy(false);
  }

  return (
    <>
      <ScrollView
        style={{ backgroundColor: colors.background }}
        contentContainerStyle={styles.container}
        keyboardShouldPersistTaps="handled"
      >
        {savedCount > 0 ? (
          <View style={styles.saved}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={styles.savedText}>
              {savedCount} product{savedCount === 1 ? '' : 's'} saved. Add the next one.
            </Text>
          </View>
        ) : (
          <FormHeader
            art={icons.addProduct}
            title="New product"
            note="Name, price and how it is sold are enough to start billing."
          />
        )}

        <Field
          label="Product name"
          value={name}
          onChangeText={setName}
          placeholder="e.g. Sona Masoori Rice"
          autoCapitalize="words"
          autoFocus
        />

        <Text style={styles.label}>Sold by</Text>
        <Segmented
          options={SELL_BY.map((s) => ({
            key: s.key,
            label: s.key === 'PCS' ? 'Piece / packet' : s.key === 'KG' ? 'Weight (kg)' : 'Litre',
          }))}
          value={sellBy}
          onChange={setSellBy}
        />

        <Field
          label={`Selling price for ${unitLabel} (₹)`}
          value={price}
          onChangeText={setPrice}
          keyboardType="decimal-pad"
          placeholder="e.g. 52.50"
        />

        <View style={styles.barcodeRow}>
          <View style={{ flex: 1 }}>
            <Field
              label="Barcode (optional)"
              value={barcode}
              onChangeText={setBarcode}
              placeholder="Scan or type"
            />
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Scan barcode with camera"
            onPress={() => setScanning(true)}
            style={({ pressed }) => [styles.scanBtn, pressed && { opacity: 0.85 }]}
          >
            <Ionicons name="barcode-outline" size={24} color={colors.text} />
          </Pressable>
        </View>

        {canAdjustStock ? (
          <Field
            label={`In stock right now (${unitCode}, optional)`}
            value={openingQuantity}
            onChangeText={setOpeningQuantity}
            keyboardType="decimal-pad"
            placeholder="Leave empty for 0"
          />
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: more }}
          onPress={() => setMore((v) => !v)}
          style={styles.moreToggle}
        >
          <Text style={styles.moreText}>
            {more ? 'Hide more details' : 'More details: MRP, cost, GST, HSN'}
          </Text>
          <Ionicons name={more ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primary} />
        </Pressable>

        {more ? (
          <Card>
            <Field
              label={`MRP for ${unitLabel} (₹)`}
              value={mrp}
              onChangeText={setMrp}
              keyboardType="decimal-pad"
              placeholder="Printed MRP on pack"
            />
            {canAdjustStock && openingQuantity.trim() !== '' ? (
              <Field
                label={`Cost price per ${unitLabel} (₹)`}
                value={openingCost}
                onChangeText={setOpeningCost}
                keyboardType="decimal-pad"
                placeholder="0"
                hint="Used for profit. Leave empty if unknown."
              />
            ) : null}
            <Choice
              label="GST rate (when shop GST is on)"
              options={GST_RATES}
              value={gstRate}
              onChange={setGstRate}
            />
            <Field
              label="HSN code (4-8 digits)"
              value={hsnCode}
              onChangeText={setHsnCode}
              keyboardType="number-pad"
              placeholder="e.g. 1006"
              maxLength={8}
            />
          </Card>
        ) : null}

        <ErrorText message={error} />
        <Button
          title="Save product"
          icon="checkmark"
          onPress={() => void save(false)}
          busy={busy}
        />
        <Button
          title="Save & add another"
          icon="add"
          variant="secondary"
          onPress={() => void save(true)}
          disabled={busy}
        />
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
  container: {
    padding: 20,
    paddingBottom: 40,
    width: '100%',
    maxWidth: CONTENT_MAX,
    alignSelf: 'center',
  },
  label: { fontSize: 13, fontWeight: '700', color: '#3D4C43', marginBottom: 8 },
  barcodeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  scanBtn: {
    marginTop: 26,
    width: 54,
    height: 54,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    marginBottom: 8,
  },
  moreText: { fontSize: 14, fontWeight: '700', color: colors.primary },
  saved: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.successSoft,
    borderRadius: 14,
    padding: 12,
    marginBottom: 16,
  },
  savedText: { flex: 1, color: colors.success, fontWeight: '700' },
});
