import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { quantityString } from '@ksms/validation';
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
import { formatINR, isPositive } from '@/utils/currency';
import { friendlyError } from '@/utils/errors';
import { trimZeros } from '@/utils/format';

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
  const { cart, add } = useCart();
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

  function quickAdd(item: ProductRow) {
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
            onTap={(item) =>
              item.basePrice && !isLoose(item.baseUnit.code) ? quickAdd(item) : setSelected(item.id)
            }
            onQuantity={(item) => setSelected(item.id)}
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
  onTap,
  onQuantity,
}: {
  embedded?: boolean;
  search: string;
  categoryId: string | null;
  inBill: Map<string, string>;
  onTap: (item: ProductRow) => void;
  onQuantity: (item: ProductRow) => void;
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
      {embedded ? null : (
        <Text style={styles.tip}>Tap a packet to add one. Tap again to add more.</Text>
      )}
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
          if (embedded)
            return (
              <ProductCard
                item={item}
                loose={loose}
                onBill={qty}
                onAdd={() => onTap(item)}
                onQuantity={() => onQuantity(item)}
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
                <View style={styles.rowRight}>
                  {qty ? <Badge text={`On bill: ${qty}`} tone="good" /> : null}
                  <View style={[styles.addBtn, !item.basePrice && { opacity: 0.4 }]}>
                    <Ionicons
                      name={loose ? 'scale-outline' : 'add'}
                      size={28}
                      color={colors.onPrimary}
                    />
                  </View>
                </View>
              }
              actions={
                item.basePrice && !loose ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Choose quantity for ${item.name}`}
                    onPress={() => onQuantity(item)}
                    hitSlop={8}
                    style={styles.qtyBtn}
                  >
                    <Text style={styles.qtyBtnText}>Qty</Text>
                  </Pressable>
                ) : undefined
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
  onAdd,
  onQuantity,
}: {
  item: ProductRow;
  loose: boolean;
  onBill?: string;
  onAdd: () => void;
  onQuantity: () => void;
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
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Choose quantity for ${item.name}`}
          disabled={!priced || loose}
          onPress={onQuantity}
          style={({ pressed }) => [
            styles.cardQty,
            (!priced || loose) && { opacity: 0.35 },
            pressed && { opacity: 0.85 },
          ]}
        >
          <Text style={styles.qtyBtnText}>Qty</Text>
        </Pressable>
      </View>
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
  cardQty: {
    minHeight: 52,
    minWidth: 64,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: colors.primarySoft,
  },
  embedded: { flex: 1, minWidth: 0, paddingHorizontal: 24, paddingTop: 16 },
  tip: { fontSize: 12, color: colors.textMuted, marginBottom: 8 },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  qtyBtn: {
    minHeight: 52,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
    justifyContent: 'center',
  },
  qtyBtnText: { color: colors.primary, fontWeight: '800', fontSize: 16 },
  addBtn: {
    width: 52,
    height: 52,
    borderRadius: 12,
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
