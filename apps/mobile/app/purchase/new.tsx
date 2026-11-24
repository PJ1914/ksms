import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  type PurchaseForm,
  type PurchaseLineForm,
  buildPurchasePayload,
  validatePurchaseForm,
} from '@ksms/validation';
import { getData, newKey, query } from '@/api/client';
import type { ProductDetail, ProductRow, SupplierRow } from '@/api/types';
import {
  Button,
  Card,
  Choice,
  ErrorText,
  Field,
  FormHeader,
  ListRow,
  Screen,
  SearchBox,
  SectionTitle,
} from '@/components/ui';
import { illustrations } from '@/theme/art';
import { usePagedList } from '@/hooks/useLoad';
import { useSubmit } from '@/hooks/useSubmit';
import { colors } from '@/theme/colors';
import { friendlyError } from '@/utils/errors';
import { trimZeros } from '@/utils/format';

/** What we know about a product on the form, beyond what is sent to the server. */
interface LineMeta {
  units: { unitId: string; unitCode: string; factorToBase: string }[];
  baseUnitCode: string;
  tracked: boolean;
}

export default function NewPurchaseScreen() {
  const params = useLocalSearchParams<{ supplierId?: string; supplierName?: string }>();
  const { run, busy, error, setError } = useSubmit();
  const [supplierId, setSupplierId] = useState<string | null>(params.supplierId ?? null);
  const [supplierName, setSupplierName] = useState<string | null>(params.supplierName ?? null);
  const [invoiceNo, setInvoiceNo] = useState('');
  const [freight, setFreight] = useState('');
  const [receiveNow, setReceiveNow] = useState(true);
  const [lines, setLines] = useState<PurchaseLineForm[]>([]);
  const [meta, setMeta] = useState<Record<string, LineMeta>>({});

  const form: PurchaseForm = {
    supplierId,
    supplierInvoiceNo: invoiceNo,
    additionalCosts: freight,
    lines,
    receiveNow,
  };
  const patch = (key: string, p: Partial<PurchaseLineForm>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...p } : l)));

  async function save() {
    const problem = validatePurchaseForm(form);
    if (problem) return setError(problem);
    const created = await run<{ id: string }>('/purchases', buildPurchasePayload(form));
    if (created) router.replace({ pathname: '/purchase/[id]', params: { id: created.id } });
  }

  return (
    <Screen
      footer={
        <Button
          title={receiveNow ? 'Save and receive the goods' : 'Save as a draft'}
          onPress={save}
          busy={busy}
        />
      }
    >
      <Stack.Screen options={{ title: 'New purchase' }} />
      <FormHeader
        art={illustrations.supplierTruck}
        title="New purchase"
        note="Add what arrived from the supplier. Stock goes up when you save."
      />

      <SectionTitle>Supplier</SectionTitle>
      {supplierId ? (
        <Card>
          <Text style={{ fontSize: 16, fontWeight: '600', color: colors.text }}>
            {supplierName}
          </Text>
          <Button title="Change supplier" variant="secondary" onPress={() => setSupplierId(null)} />
        </Card>
      ) : (
        <SupplierPicker
          onPick={(s) => {
            setSupplierId(s.id);
            setSupplierName(s.name);
          }}
        />
      )}

      <SectionTitle>Items bought</SectionTitle>
      {lines.map((l) => {
        const m = meta[l.key];
        const unit = m?.units.find((u) => u.unitId === l.unitId);
        return (
          <Card key={l.key}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ flex: 1, fontSize: 16, fontWeight: '600', color: colors.text }}>
                {l.name}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${l.name}`}
                onPress={() => setLines((prev) => prev.filter((x) => x.key !== l.key))}
                hitSlop={10}
              >
                <Ionicons name="trash-outline" size={22} color={colors.danger} />
              </Pressable>
            </View>
            {m && m.units.length > 1 ? (
              <Choice
                label="Bought in"
                options={m.units.map((u) => ({ key: u.unitId, label: u.unitCode }))}
                value={l.unitId}
                onChange={(unitId) =>
                  patch(l.key, {
                    unitId,
                    unitCode: m.units.find((u) => u.unitId === unitId)?.unitCode ?? l.unitCode,
                  })
                }
              />
            ) : null}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Field
                  label={`How many (${l.unitCode})`}
                  value={l.quantity}
                  onChangeText={(v) => patch(l.key, { quantity: v })}
                  keyboardType="decimal-pad"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Field
                  label={`Price of 1 ${l.unitCode} ₹`}
                  value={l.unitCost}
                  onChangeText={(v) => patch(l.key, { unitCost: v })}
                  keyboardType="decimal-pad"
                />
              </View>
            </View>
            {unit &&
            m &&
            unit.unitId !==
              m.units.find((u) => u.factorToBase === '1' || u.factorToBase === '1.000000')
                ?.unitId ? (
              <Text style={{ color: colors.textMuted, marginBottom: 8 }}>
                1 {unit.unitCode} = {trimZeros(unit.factorToBase)} {m.baseUnitCode}
              </Text>
            ) : null}
            <Field
              label="Discount ₹ (optional)"
              value={l.discount}
              onChangeText={(v) => patch(l.key, { discount: v })}
              keyboardType="decimal-pad"
            />
            {m?.tracked ? (
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Batch no."
                    value={l.batchNumber}
                    onChangeText={(v) => patch(l.key, { batchNumber: v })}
                    autoCapitalize="characters"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Field
                    label="Expiry (YYYY-MM-DD)"
                    value={l.expiryDate}
                    onChangeText={(v) => patch(l.key, { expiryDate: v })}
                    keyboardType="numbers-and-punctuation"
                  />
                </View>
              </View>
            ) : null}
          </Card>
        );
      })}
      <ItemPicker
        onError={setError}
        onPick={(line, m) => {
          setLines((prev) => [...prev, line]);
          setMeta((prev) => ({ ...prev, [line.key]: m }));
        }}
      />

      <SectionTitle>Bill details</SectionTitle>
      <Field
        label="Supplier’s bill number (optional)"
        value={invoiceNo}
        onChangeText={setInvoiceNo}
      />
      <Field
        label="Freight and other costs ₹ (optional)"
        value={freight}
        onChangeText={setFreight}
        keyboardType="decimal-pad"
        hint="Shared across the items so each one carries its true cost."
      />
      <Choice
        label="The goods have…"
        options={[
          { key: 'yes', label: 'arrived' },
          { key: 'no', label: 'not arrived yet' },
        ]}
        value={receiveNow ? 'yes' : 'no'}
        onChange={(v) => setReceiveNow(v === 'yes')}
      />
      <Text style={{ color: colors.textMuted, marginBottom: 8 }}>
        The total, tax and each item’s cost are worked out by the server when you save. Stock and
        what you owe change only when goods are received.
      </Text>
      <ErrorText message={error} />
    </Screen>
  );
}

function SupplierPicker({ onPick }: { onPick: (s: SupplierRow) => void }) {
  const [search, setSearch] = useState('');
  const list = usePagedList<SupplierRow>(
    `/suppliers${query({ q: search.trim(), isActive: true })}`,
    8,
  );
  return (
    <>
      <SearchBox value={search} onChangeText={setSearch} placeholder="Search supplier" />
      {list.items.map((s) => (
        <View key={s.id} style={{ marginBottom: 8 }}>
          <ListRow title={s.name} subtitle={s.phone ?? undefined} onPress={() => onPick(s)} />
        </View>
      ))}
      {list.items.length === 0 && !list.loading ? (
        <Text style={{ color: colors.textMuted, marginBottom: 8 }}>
          No supplier found. Add one from More → Suppliers.
        </Text>
      ) : null}
      <ErrorText message={list.error} />
    </>
  );
}

function ItemPicker({
  onPick,
  onError,
}: {
  onPick: (line: PurchaseLineForm, meta: LineMeta) => void;
  onError: (message: string | null) => void;
}) {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const list = usePagedList<ProductRow>(
    open ? `/products${query({ q: search.trim(), status: 'ACTIVE', sort: 'name' })}` : null,
    8,
  );

  async function pick(p: ProductRow) {
    try {
      const d = await getData<ProductDetail>(`/products/${p.id}`);
      const units = d.conversions
        .filter((c) => c.isPurchaseUnit)
        .map((c) => ({ unitId: c.unitId, unitCode: c.unitCode, factorToBase: c.factorToBase }));
      if (units.length === 0) return onError(`${p.name} has no unit set up for buying.`);
      const first = units.find((u) => u.unitId === d.baseUnit.id) ?? units[0]!;
      onPick(
        {
          key: newKey(),
          productId: d.id,
          name: d.name,
          unitId: first.unitId,
          unitCode: first.unitCode,
          quantity: '',
          unitCost: '',
          discount: '',
          batchNumber: '',
          expiryDate: '',
        },
        { units, baseUnitCode: d.baseUnit.code, tracked: d.trackBatch || d.trackExpiry },
      );
      onError(null);
      setOpen(false);
      setSearch('');
    } catch (e) {
      onError(friendlyError(e));
    }
  }

  if (!open)
    return <Button title="Add an item" variant="secondary" onPress={() => setOpen(true)} />;
  return (
    <Card>
      <SearchBox
        value={search}
        onChangeText={setSearch}
        placeholder="Search name, SKU or barcode"
      />
      {list.items.map((p) => (
        <View key={p.id} style={{ marginBottom: 8 }}>
          <ListRow title={p.name} subtitle={p.sku} onPress={() => void pick(p)} />
        </View>
      ))}
      {list.items.length === 0 && !list.loading ? (
        <Text style={{ color: colors.textMuted }}>
          No product found. Add it first from the Stock tab.
        </Text>
      ) : null}
      <Button title="Close" variant="secondary" onPress={() => setOpen(false)} />
    </Card>
  );
}
