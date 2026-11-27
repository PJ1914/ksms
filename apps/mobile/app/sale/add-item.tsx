import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { quantityString, type CartLine } from '@ksms/validation';
import { getData, query } from '@/api/client';
import type { ProductDetail, ProductRow } from '@/api/types';
import { useCart } from '@/cart/CartProvider';
import { CategoryChips, type CategoryChipItem } from '@/components/CategoryChips';
import { ListFooter } from '@/components/ListFooter';
import {
  Badge,
  Button,
  Card,
  Choice,
  EmptyState,
  ErrorText,
  Field,
  IconTile,
  ListRow,
  Loading,
  Money,
  pageStyle,
  SearchBox,
} from '@/components/ui';
import { categoryArt, illustrations } from '@/theme/art';
import { useLoad, usePagedList } from '@/hooks/useLoad';
import { isNetworkFailure } from '@/sync/backoff';
import {
  getCachedProductDetail,
  listCachedCategories,
  searchCachedProducts,
} from '@/sync/cache-store';
import { useSync } from '@/sync/SyncProvider';
import { colors, radius, shadow } from '@/theme/colors';
import { formatINR, isPositive, stepDownOrRemove } from '@/utils/currency';
import { friendlyError } from '@/utils/errors';
import { trimZeros } from '@/utils/format';
import { haptic } from '@/utils/haptics';

interface Quote {
  amount: string;
  rounded: boolean;
}

/** Loose goods (weighed or measured) need a quantity; packets and pieces are added one at a time. */
const LOOSE_UNITS = new Set(['kg', 'g', 'gm', 'l', 'ml', 'ltr', 'litre']);
const isLoose = (unitCode: string) => LOOSE_UNITS.has(unitCode.toLowerCase());

export default function AddItemScreen() {
  return <ProductPicker />;
}

/** The product search + add list. `embedded` is the desktop POS: it sits beside the bill. */
export function ProductPicker({ embedded }: { embedded?: boolean }) {
  const { cart, add, update, remove } = useCart();
  const { db } = useSync();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const cats = useLoad<CategoryChipItem[]>(async () => {
    try {
      const list = await getData<CategoryChipItem[]>('/categories');
      return list.filter((c) => (c.productCount ?? 1) > 0);
    } catch (e) {
      if (isNetworkFailure(e) && db) {
        return (await listCachedCategories(db)).map((c) => ({ id: c.id, name: c.name }));
      }
      return [];
    }
  }, [db]);

  /** How much of each product is already on the bill (shown on its row). */
  const inBill = new Map<string, string>();
  for (const l of cart.lines) {
    inBill.set(l.productId, `${trimZeros(l.quantity)} ${l.unitCode}`);
  }

  /** The plain bill line a "+" adds to: the product in its own unit, with no special price or discount. */
  const plainLines = new Map<string, CartLine>();
  for (const l of cart.lines) {
    if (l.discount === '' && l.unitPrice === '' && !plainLines.has(l.productId)) {
      plainLines.set(l.productId, l);
    }
  }

  /** "−" on a product row: one less, and at 1 the item comes off the bill. */
  function stepDown(item: ProductRow) {
    const line = plainLines.get(item.id);
    if (!line) return;
    haptic('tap');
    const next = stepDownOrRemove(line.quantity);
    if (next === null) remove(line.key);
    else update(line.key, { quantity: next });
  }

  function quickAdd(item: ProductRow) {
    haptic('tap');
    add({
      productId: item.id,
      name: item.name,
      unitId: item.baseUnit.id,
      unitCode: item.baseUnit.code,
      quantity: '1',
    });
    setAdded(item.name);
  }

  return (
    <View style={embedded ? styles.embedded : pageStyle}>
      {embedded ? null : <Stack.Screen options={{ title: 'Add items' }} />}
      {selected ? (
        <Picker
          productId={selected}
          onCancel={() => setSelected(null)}
          onAdd={(line, label) => {
            haptic('tap');
            add(line);
            setAdded(label);
            setSelected(null);
          }}
        />
      ) : (
        <>
          <SearchBox
            value={search}
            onChangeText={setSearch}
            placeholder="Search name, SKU or barcode"
            onScan={() => router.push('/sale/scan')}
            autoFocus={embedded}
          />
          <CategoryChips categories={cats.data ?? []} value={categoryId} onChange={setCategoryId} />
          <Results
            embedded={embedded}
            search={search}
            categoryId={categoryId}
            inBill={inBill}
            plainLines={plainLines}
            onTap={(item) =>
              item.basePrice && !isLoose(item.baseUnit.code) ? quickAdd(item) : setSelected(item.id)
            }
            onMinus={stepDown}
          />
        </>
      )}

      {!embedded && cart.lines.length > 0 ? (
        <View style={styles.bar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.barTitle}>
              {cart.lines.length} item{cart.lines.length === 1 ? '' : 's'} on the bill
            </Text>
            {added ? (
              <Text style={styles.barSub} numberOfLines={1}>
                Added {added}
              </Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.back()}
            style={({ pressed }) => [styles.barBtn, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.barBtnText}>View bill</Text>
            <Ionicons name="arrow-forward" size={18} color={colors.onPrimary} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function Results({
  embedded,
  search,
  categoryId,
  inBill,
  plainLines,
  onTap,
  onMinus,
}: {
  embedded?: boolean;
  search: string;
  categoryId: string | null;
  inBill: Map<string, string>;
  plainLines: Map<string, CartLine>;
  onTap: (item: ProductRow) => void;
  onMinus: (item: ProductRow) => void;
}) {
  const { db } = useSync();
  const list = usePagedList<ProductRow>(
    `/products${query({ q: search.trim(), status: 'ACTIVE', categoryId: categoryId ?? undefined, sort: 'name' })}`,
    30,
    db ? () => searchCachedProducts(db, search, true, categoryId) : undefined,
  );
  if (list.loading) return <Loading />;
  return (
    <>
      {list.fromCache ? (
        <Text style={{ color: colors.warning, fontSize: 13, marginBottom: 8 }}>
          Offline — showing saved products from this phone.
        </Text>
      ) : null}
      {embedded ? null : <Text style={styles.tip}>Tap + to add one. Tap − to take one off.</Text>}
      <ErrorText message={list.error} />
      <FlatList
        key={embedded ? 'grid' : 'list'}
        data={list.items}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        numColumns={embedded ? 3 : 1}
        columnWrapperStyle={embedded ? { gap: 14 } : undefined}
        contentContainerStyle={{ paddingBottom: embedded ? 32 : 96, gap: embedded ? 14 : 0 }}
        onEndReachedThreshold={0.5}
        onEndReached={() => void list.loadMore()}
        ItemSeparatorComponent={embedded ? undefined : () => <View style={{ height: 8 }} />}
        ListFooterComponent={
          <ListFooter
            shown={list.items.length}
            total={list.meta?.total}
            loadingMore={list.loadingMore}
            fromCache={list.fromCache}
            onLoadMore={() => void list.loadMore()}
          />
        }
        ListEmptyComponent={
          <EmptyState
            art={illustrations.emptySearch}
            title="No products match"
            note="Check the spelling, or scan the barcode."
          />
        }
        renderItem={({ item }) => {
          const qty = inBill.get(item.id);
          const loose = isLoose(item.baseUnit.code);
          // a − / + stepper for ordinary priced items already on the bill (in their own unit)
          const found = plainLines.get(item.id);
          const stepLine =
            found && item.basePrice && !loose && found.unitId === item.baseUnit.id
              ? found
              : undefined;
          if (embedded)
            return (
              <ProductCard
                item={item}
                loose={loose}
                onBill={qty}
                stepLine={stepLine}
                onAdd={() => onTap(item)}
                onMinus={() => onMinus(item)}
              />
            );
          return (
            <ListRow
              leading={<IconTile art={categoryArt(item.name)} tint="mango" size={48} />}
              title={item.name}
              subtitle={
                item.basePrice
                  ? `${formatINR(item.basePrice)} / ${item.baseUnit.code}`
                  : 'No price set'
              }
              right={
                stepLine ? (
                  <Stepper
                    name={item.name}
                    quantity={stepLine.quantity}
                    onMinus={() => onMinus(item)}
                    onPlus={() => onTap(item)}
                  />
                ) : (
                  <View style={styles.rowRight}>
                    {qty ? <Badge text={`On bill: ${qty}`} tone="good" /> : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={loose ? `Weigh ${item.name}` : `Add ${item.name}`}
                      onPress={() => onTap(item)}
                      hitSlop={6}
                      style={[styles.addBtn, !item.basePrice && { opacity: 0.4 }]}
                    >
                      <Ionicons
                        name={loose ? 'scale-outline' : 'add'}
                        size={22}
                        color={colors.onPrimary}
                      />
                    </Pressable>
                  </View>
                )
              }
              onPress={() => onTap(item)}
            />
          );
        }}
      />
    </>
  );
}

/** Desktop POS tile: every product gets the same two big buttons, so the grid stays even. */
function ProductCard({
  item,
  loose,
  onBill,
  stepLine,
  onAdd,
  onMinus,
}: {
  item: ProductRow;
  loose: boolean;
  onBill?: string;
  /** The bill line to step with − / +; when absent the tile shows the big Add button. */
  stepLine?: CartLine;
  onAdd: () => void;
  onMinus: () => void;
}) {
  const priced = !!item.basePrice;
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <IconTile art={categoryArt(item.name)} tint="mango" size={56} />
        {onBill ? <Badge text={`On bill: ${onBill}`} tone="good" /> : null}
      </View>
      <Text style={styles.cardName} numberOfLines={2}>
        {item.name}
      </Text>
      <Text style={styles.cardPrice}>
        {priced ? `${formatINR(item.basePrice!)} / ${item.baseUnit.code}` : 'No price set'}
      </Text>
      <View style={styles.cardActions}>
        {stepLine ? (
          <Stepper
            name={item.name}
            quantity={stepLine.quantity}
            onMinus={onMinus}
            onPlus={onAdd}
            wide
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={loose ? `Weigh ${item.name}` : `Add ${item.name}`}
            disabled={!priced}
            onPress={onAdd}
            style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => [
              styles.cardAdd,
              hovered && { backgroundColor: colors.primaryDark },
              !priced && { opacity: 0.4 },
              pressed && { opacity: 0.85 },
            ]}
          >
            <Ionicons name={loose ? 'scale-outline' : 'add'} size={24} color={colors.onPrimary} />
            <Text style={styles.cardAddText}>{loose ? 'Weigh' : 'Add'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/** − quantity + for an item already on the bill. At 1, the − (shown as a bin) takes it off the bill. */
function Stepper({
  name,
  quantity,
  onMinus,
  onPlus,
  wide,
}: {
  name: string;
  quantity: string;
  onMinus: () => void;
  onPlus: () => void;
  wide?: boolean;
}) {
  const shown = trimZeros(quantity);
  const last = shown === '1';
  return (
    <View style={[styles.stepper, wide && { flex: 1 }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={last ? `Remove ${name} from the bill` : `One less ${name}`}
        hitSlop={6}
        onPress={onMinus}
        style={({ pressed }) => [styles.stepMinus, pressed && { opacity: 0.7 }]}
      >
        <Ionicons
          name={last ? 'trash-outline' : 'remove'}
          size={20}
          color={last ? colors.danger : colors.primary}
        />
      </Pressable>
      <Text
        accessibilityLabel={`${shown} of ${name} on the bill`}
        style={[styles.stepQty, wide && { flex: 1 }]}
        numberOfLines={1}
      >
        {shown}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`One more ${name}`}
        hitSlop={6}
        onPress={onPlus}
        style={({ pressed }) => [styles.stepPlus, pressed && { opacity: 0.85 }]}
      >
        <Ionicons name="add" size={22} color={colors.onPrimary} />
      </Pressable>
    </View>
  );
}

const QUICK_LOOSE = ['0.25', '0.5', '1', '2', '5'] as const;
const QUICK_COUNT = ['1', '2', '3', '5', '10'] as const;

/**
 * Choose the unit and the quantity. Adding does not wait for the price: the bill screen asks the
 * server to price every line (the same code checkout uses), so the quote here is only a preview.
 */
function Picker({
  productId,
  onAdd,
  onCancel,
}: {
  productId: string;
  onAdd: (
    line: { productId: string; name: string; unitId: string; unitCode: string; quantity: string },
    label: string,
  ) => void;
  onCancel: () => void;
}) {
  const { db } = useSync();
  const {
    data: p,
    loading,
    error,
  } = useLoad(async () => {
    try {
      return await getData<ProductDetail>(`/products/${productId}`);
    } catch (e) {
      if (isNetworkFailure(e) && db) {
        const cached = await getCachedProductDetail(db, productId);
        if (cached) return cached;
      }
      throw e;
    }
  }, [productId, db]);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const saleUnits = p?.conversions.filter((c) => c.isSaleUnit) ?? [];
  const chosen = unitId ?? saleUnits.find((c) => c.isBase)?.unitId ?? saleUnits[0]?.unitId ?? null;
  const qtyOk = quantityString.safeParse(quantity.trim()).success && isPositive(quantity);

  // A live price preview from the server's pricing rules for this exact quantity.
  useEffect(() => {
    setQuote(null);
    setQuoteError(null);
    if (!chosen || !qtyOk) return;
    let alive = true;
    const t = setTimeout(() => {
      getData<Quote>(
        `/products/${productId}/quote${query({ unitId: chosen, quantity: quantity.trim() })}`,
      )
        .then((q) => alive && setQuote(q))
        .catch((e) => {
          if (alive && !isNetworkFailure(e)) setQuoteError(friendlyError(e));
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [productId, chosen, quantity, qtyOk]);

  if (loading) return <Loading />;
  if (!p) return <ErrorText message={error ?? 'Could not load this product.'} />;
  const unit = saleUnits.find((c) => c.unitId === chosen);
  const quick = unit && isLoose(unit.unitCode) ? QUICK_LOOSE : QUICK_COUNT;

  const addNow = () =>
    onAdd(
      {
        productId: p.id,
        name: p.name,
        unitId: chosen!,
        unitCode: unit!.unitCode,
        quantity: quantity.trim(),
      },
      `${p.name}, ${trimZeros(quantity.trim())} ${unit!.unitCode}`,
    );

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <IconTile art={categoryArt(p.name)} tint="mango" size={52} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text }}>{p.name}</Text>
          <Text style={{ color: colors.textMuted }}>{p.sku}</Text>
        </View>
      </View>
      {saleUnits.length === 0 ? (
        <ErrorText message="This product has no unit set up for selling." />
      ) : (
        <>
          {saleUnits.length > 1 ? (
            <Choice
              label="Sell in"
              options={saleUnits.map((c) => ({ key: c.unitId, label: c.unitCode }))}
              value={chosen!}
              onChange={setUnitId}
            />
          ) : null}
          <View style={styles.chips}>
            {quick.map((q) => (
              <Pressable
                key={q}
                accessibilityRole="button"
                accessibilityState={{ selected: quantity.trim() === q }}
                onPress={() => setQuantity(q)}
                style={[styles.chip, quantity.trim() === q && styles.chipOn]}
              >
                <Text style={[styles.chipText, quantity.trim() === q && styles.chipTextOn]}>
                  {q} {unit?.unitCode ?? ''}
                </Text>
              </Pressable>
            ))}
          </View>
          <Field
            label={`Or type the quantity${unit ? ` (${unit.unitCode})` : ''}`}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="decimal-pad"
            selectTextOnFocus
            onSubmitEditing={() => qtyOk && chosen && addNow()}
            hint={
              unit && !unit.isBase
                ? `1 ${unit.unitCode} = ${trimZeros(unit.factorToBase)} ${p.baseUnit.code}`
                : undefined
            }
          />
          {quote ? (
            <Text
              style={{ fontSize: 22, fontWeight: '800', color: colors.primary, marginBottom: 4 }}
            >
              <Money value={quote.amount} />
            </Text>
          ) : null}
          <ErrorText message={quoteError ?? (qtyOk ? null : 'Enter a quantity, like 1 or 0.5.')} />
          <Button title="Add to bill" icon="add" disabled={!chosen || !qtyOk} onPress={addNow} />
        </>
      )}
      <Button title="Back to items" variant="secondary" onPress={onCancel} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minWidth: 0,
    padding: 16,
    gap: 6,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  cardName: { fontSize: 17, fontWeight: '700', color: colors.text, minHeight: 44, marginTop: 6 },
  cardPrice: { fontSize: 16, color: colors.textMuted, fontWeight: '600' },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  cardAdd: {
    flex: 1,
    minHeight: 52,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.primary,
  },
  cardAddText: { color: colors.onPrimary, fontSize: 17, fontWeight: '800' },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
  },
  stepMinus: { width: 34, height: 36, alignItems: 'center', justifyContent: 'center' },
  stepQty: {
    minWidth: 24,
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '800',
    color: colors.text,
  },
  stepPlus: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  embedded: { flex: 1, minWidth: 0, paddingHorizontal: 24, paddingTop: 16 },
  tip: { fontSize: 12, color: colors.textMuted, marginBottom: 8 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.text,
    borderRadius: radius.lg,
    paddingVertical: 10,
    paddingLeft: 16,
    paddingRight: 10,
    ...shadow.raised,
  },
  barTitle: { color: colors.surface, fontWeight: '800', fontSize: 15 },
  barSub: { color: '#B8C7BE', fontSize: 12, marginTop: 1 },
  barBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 56,
    paddingHorizontal: 20,
    borderRadius: 14,
    backgroundColor: colors.primary,
  },
  barBtnText: { color: colors.onPrimary, fontWeight: '800', fontSize: 17 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  chip: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { fontSize: 15, fontWeight: '700', color: colors.text },
  chipTextOn: { color: colors.primary },
});
