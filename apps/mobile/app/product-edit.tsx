import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { moneyString, quantityString } from '@ksms/validation';
import { deleteData, getData, patchData, postData, putData } from '@/api/client';
import type { ProductDetail } from '@/api/types';
import { BarcodeScannerModal } from '@/components/BarcodeScannerModal';
import {
  Button,
  Card,
  Choice,
  ErrorText,
  Field,
  Loading,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { colors } from '@/theme/colors';
import { friendlyError } from '@/utils/errors';

interface CategoryOption {
  id: string;
  name: string;
}

const STATUSES = [
  { key: 'ACTIVE', label: 'Active' },
  { key: 'INACTIVE', label: 'Switched off' },
] as const;

const GST_RATES = [
  { key: 'NONE', label: 'No GST' },
  { key: '5', label: '5%' },
  { key: '12', label: '12%' },
  { key: '18', label: '18%' },
  { key: '28', label: '28%' },
] as const;

const TAX_MODES = [
  { key: 'INCLUSIVE', label: 'Tax included' },
  { key: 'EXCLUSIVE', label: 'Tax extra' },
] as const;

export default function EditProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [localName, setLocalName] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [status, setStatus] = useState<'ACTIVE' | 'INACTIVE'>('ACTIVE');
  const [mrp, setMrp] = useState('');
  const [minStockLevel, setMinStockLevel] = useState('');
  const [gstRate, setGstRate] = useState('NONE');
  const [taxMode, setTaxMode] = useState<'INCLUSIVE' | 'EXCLUSIVE'>('INCLUSIVE');
  const [hsnCode, setHsnCode] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [newBarcode, setNewBarcode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [barcodeBusy, setBarcodeBusy] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      getData<ProductDetail>(`/products/${id}`),
      getData<CategoryOption[]>('/categories').catch(() => [] as CategoryOption[]),
    ])
      .then(([p, cats]) => {
        setProduct(p);
        setCategories(cats);
        setName(p.name);
        setLocalName(p.localName ?? '');
        setCategoryId(p.category?.id ?? '');
        setStatus(p.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE');
        setMrp(p.mrp ?? '');
        setMinStockLevel(p.minStockLevel ?? '0');
        const rateNum = p.gstRatePercent ? String(Number(p.gstRatePercent)) : 'NONE';
        setGstRate(p.isTaxable && ['5', '12', '18', '28'].includes(rateNum) ? rateNum : 'NONE');
        setTaxMode(p.taxMode ?? 'INCLUSIVE');
        setHsnCode(p.hsnCode ?? '');
        setBasePrice(p.basePrice ?? '');
      })
      .catch((e) => setLoadError(friendlyError(e)))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Loading />;
  if (!product) return <ErrorText message={loadError ?? 'Could not load this product.'} />;

  async function addBarcode(codeToAdd: string) {
    if (!product || barcodeBusy) return;
    const trimmed = codeToAdd.trim();
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(trimmed)) {
      return setError('Barcode must be 3 to 64 letters, digits, or . _ -.');
    }
    setBarcodeBusy(true);
    setError(null);
    try {
      const updated = await postData<ProductDetail>(`/products/${product.id}/barcodes`, {
        barcode: trimmed,
      });
      setProduct(updated);
      setNewBarcode('');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBarcodeBusy(false);
    }
  }

  async function removeBarcode(barcodeId: string) {
    if (!product || barcodeBusy) return;
    setBarcodeBusy(true);
    setError(null);
    try {
      await deleteData(`/products/${product.id}/barcodes/${barcodeId}`);
      const fresh = await getData<ProductDetail>(`/products/${product.id}`);
      setProduct(fresh);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBarcodeBusy(false);
    }
  }

  async function save() {
    if (!product || busy) return;
    if (name.trim().length < 2) return setError('Enter a product name (at least 2 characters).');
    if (mrp.trim() && !moneyString.safeParse(mrp.trim()).success) {
      return setError('MRP must be a valid amount in rupees (e.g. 70.00).');
    }
    if (minStockLevel.trim() && !quantityString.safeParse(minStockLevel.trim()).success) {
      return setError('Reorder level must be a valid quantity (e.g. 5).');
    }
    if (basePrice.trim() && !moneyString.safeParse(basePrice.trim()).success) {
      return setError('Selling price must be a valid amount in rupees (e.g. 60.00).');
    }
    if (hsnCode.trim() && !/^\d{4,8}$/.test(hsnCode.trim())) {
      return setError('HSN code must be 4 to 8 digits.');
    }

    setBusy(true);
    setError(null);
    try {
      const taxable = gstRate !== 'NONE';
      await patchData(`/products/${product.id}`, {
        name: name.trim(),
        localName: localName.trim() || undefined,
        categoryId: categoryId || null,
        status,
        mrp: mrp.trim() || null,
        minStockLevel: minStockLevel.trim() || '0',
        isTaxable: taxable,
        gstRatePercent: taxable ? gstRate : null,
        taxMode: taxable ? taxMode : null,
        hsnCode: hsnCode.trim() || null,
        version: product.version,
      });

      // Update base unit price if provided and changed
      if (basePrice.trim() && basePrice.trim() !== (product.basePrice ?? '')) {
        const otherPrices = product.prices
          .filter(
            (x) => x.isActive && !(x.unitId === product.baseUnit.id && Number(x.quantity) === 1),
          )
          .map((x) => ({
            unitId: x.unitId,
            quantity: x.quantity,
            price: x.price,
          }));
        await putData(`/products/${product.id}/prices`, {
          prices: [
            { unitId: product.baseUnit.id, quantity: '1', price: basePrice.trim() },
            ...otherPrices,
          ],
        });
      }
      router.back();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen footer={<Button title="Save changes" onPress={() => void save()} busy={busy} />}>
      <Stack.Screen options={{ title: 'Edit product' }} />
      <Field label="Product name" value={name} onChangeText={setName} />
      <Field
        label="Local name (optional)"
        value={localName}
        onChangeText={setLocalName}
        placeholder="Regional / shop name"
      />

      {categories.length > 0 ? (
        <Choice
          label="Category"
          options={[
            { key: '', label: 'None' },
            ...categories.map((c) => ({ key: c.id, label: c.name })),
          ]}
          value={categoryId}
          onChange={setCategoryId}
        />
      ) : null}

      <Choice label="Status" options={STATUSES} value={status} onChange={setStatus} />

      <SectionTitle>Price & stock alert</SectionTitle>
      <Card>
        <Field
          label={`Selling price per 1 ${product.baseUnit.code} (₹)`}
          value={basePrice}
          onChangeText={setBasePrice}
          keyboardType="decimal-pad"
          placeholder="e.g. 60.00"
        />
        <Field
          label={`MRP per 1 ${product.baseUnit.code} (optional, ₹)`}
          value={mrp}
          onChangeText={setMrp}
          keyboardType="decimal-pad"
          placeholder="e.g. 65.00"
        />
        <Field
          label={`Reorder alert below (${product.baseUnit.code})`}
          value={minStockLevel}
          onChangeText={setMinStockLevel}
          keyboardType="decimal-pad"
          placeholder="0"
        />
      </Card>

      <SectionTitle>GST</SectionTitle>
      <Choice label="GST rate" options={GST_RATES} value={gstRate} onChange={setGstRate} />
      {gstRate !== 'NONE' ? (
        <>
          <Choice label="Tax mode" options={TAX_MODES} value={taxMode} onChange={setTaxMode} />
          <Field
            label="HSN code (4-8 digits, optional)"
            value={hsnCode}
            onChangeText={setHsnCode}
            keyboardType="number-pad"
          />
        </>
      ) : (
        <Text style={{ color: colors.textMuted, fontSize: 12, marginBottom: 8 }}>
          Exempt / 0% GST item.
        </Text>
      )}
      <SectionTitle>Barcodes</SectionTitle>
      <Card>
        {product.barcodes.length === 0 ? (
          <Text style={{ color: colors.textMuted, fontSize: 13, marginBottom: 8 }}>
            No barcodes linked yet.
          </Text>
        ) : (
          product.barcodes.map((b) => (
            <View
              key={b.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                paddingVertical: 6,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
              }}
            >
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.text }}>
                {b.barcode}
              </Text>
              <Text
                accessibilityRole="button"
                onPress={() => void removeBarcode(b.id)}
                style={{ color: colors.danger, fontWeight: '600', paddingHorizontal: 8 }}
              >
                Remove
              </Text>
            </View>
          ))
        )}
        <View style={{ height: 8 }} />
        <Field
          label="Add barcode"
          value={newBarcode}
          onChangeText={setNewBarcode}
          placeholder="Type or scan barcode"
        />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Button
              title="Scan"
              variant="secondary"
              disabled={barcodeBusy}
              onPress={() => setScanning(true)}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              title="Add"
              variant="secondary"
              busy={barcodeBusy}
              disabled={!newBarcode.trim()}
              onPress={() => void addBarcode(newBarcode)}
            />
          </View>
        </View>
      </Card>

      <ErrorText message={error} />
      <BarcodeScannerModal
        visible={scanning}
        title="Scan barcode to attach"
        hint="Point the camera at the packet barcode."
        onScanned={(code) => {
          setScanning(false);
          void addBarcode(code);
        }}
        onClose={() => setScanning(false)}
      />
    </Screen>
  );
}
