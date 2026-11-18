import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { quantityString } from '@ksms/validation';
import { getData, query } from '@/api/client';
import type { ProductDetail, ProductRow } from '@/api/types';
import { useCart } from '@/cart/CartProvider';
import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  ListRow,
  Loading,
  Money,
  SearchBox,
  Choice,
} from '@/components/ui';
import { useLoad, usePagedList } from '@/hooks/useLoad';
import { colors } from '@/theme/colors';
import { formatINR, isPositive } from '@/utils/currency';
import { friendlyError } from '@/utils/errors';
import { trimZeros } from '@/utils/format';

interface Quote {
  amount: string;
  rounded: boolean;
}

export default function AddItemScreen() {
  const { cart, add } = useCart();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 12 }}
    >
      <Stack.Screen
        options={{
          title: 'Add items',
          headerRight: () => (
            <Text
              accessibilityRole="button"
              onPress={() => router.back()}
              style={{ color: colors.primary, fontWeight: '700', fontSize: 16 }}
            >
              Done ({cart.lines.length})
            </Text>
          ),
        }}
      />
      {added ? (
        <Card style={{ backgroundColor: colors.successSoft, borderColor: colors.success }}>
          <Text style={{ color: colors.success, fontWeight: '600' }}>Added: {added}</Text>
        </Card>
      ) : null}
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
          />
          <Results search={search} onPick={setSelected} />
        </>
      )}
    </View>
  );
}

function Results({ search, onPick }: { search: string; onPick: (id: string) => void }) {
  const list = usePagedList<ProductRow>(
    `/products${query({ q: search.trim(), status: 'ACTIVE', sort: 'name' })}`,
  );
  if (list.loading) return <Loading />;
  return (
    <>
      <ErrorText message={list.error} />
      <FlatList
        data={list.items}
        keyExtractor={(p) => p.id}
        keyboardShouldPersistTaps="handled"
        onEndReachedThreshold={0.5}
        onEndReached={() => void list.loadMore()}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        ListEmptyComponent={
          <EmptyState
            icon="search-outline"
            title="No products match"
            note="Check the spelling, or scan the barcode."
          />
        }
        renderItem={({ item }) => (
          <ListRow
            title={item.name}
            subtitle={item.sku}
            right={
              item.basePrice ? (
                <Text style={{ fontWeight: '700' }}>
                  {formatINR(item.basePrice)} / {item.baseUnit.code}
                </Text>
              ) : (
                <Text style={{ color: colors.danger }}>No price</Text>
              )
            }
            onPress={() => onPick(item.id)}
          />
        )}
      />
    </>
  );
}

/** Choose the unit and the quantity; the price shown is the server's price for exactly that quantity. */
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
  const {
    data: p,
    loading,
    error,
  } = useLoad(() => getData<ProductDetail>(`/products/${productId}`), [productId]);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState('1');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  const saleUnits = p?.conversions.filter((c) => c.isSaleUnit) ?? [];
  const chosen = unitId ?? saleUnits.find((c) => c.isBase)?.unitId ?? saleUnits[0]?.unitId ?? null;
  const qtyOk = quantityString.safeParse(quantity.trim()).success && isPositive(quantity);

  // The price comes from the server's own pricing rules for this exact quantity.
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
        .catch((e) => alive && setQuoteError(friendlyError(e)));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [productId, chosen, quantity, qtyOk]);

  if (loading) return <Loading />;
  if (!p) return <ErrorText message={error ?? 'Could not load this product.'} />;
  const unit = saleUnits.find((c) => c.unitId === chosen);

  return (
    <Card>
      <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>{p.name}</Text>
      <Text style={{ color: colors.textMuted, marginBottom: 12 }}>{p.sku}</Text>
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
          <Field
            label={`Quantity${unit ? ` (${unit.unitCode})` : ''}`}
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="decimal-pad"
            autoFocus
            hint={
              unit && !unit.isBase
                ? `1 ${unit.unitCode} = ${trimZeros(unit.factorToBase)} ${p.baseUnit.code}`
                : undefined
            }
          />
          {quote ? (
            <Text
              style={{ fontSize: 22, fontWeight: '700', color: colors.primary, marginBottom: 8 }}
            >
              <Money value={quote.amount} />
            </Text>
          ) : null}
          <ErrorText message={quoteError ?? (qtyOk ? null : 'Enter a quantity, like 1 or 0.5.')} />
          <Button
            title="Add to bill"
            disabled={!quote || !chosen}
            onPress={() =>
              onAdd(
                {
                  productId: p.id,
                  name: p.name,
                  unitId: chosen!,
                  unitCode: unit!.unitCode,
                  quantity: quantity.trim(),
                },
                `${p.name}, ${trimZeros(quantity.trim())} ${unit!.unitCode}`,
              )
            }
          />
        </>
      )}
      <Button title="Choose another item" variant="secondary" onPress={onCancel} />
    </Card>
  );
}
