import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Text, View } from 'react-native';
import { getData } from '@/api/client';
import type { ProductDetail, StockDetail } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  EntryRow,
  Group,
  Hero,
  IconTile,
  KeyValue,
  Loading,
  QuickActions,
  Screen,
  SectionTitle,
  Stats,
} from '@/components/ui';
import { categoryArt, icons, illustrations } from '@/theme/art';
import { colors } from '@/theme/colors';
import { useLoad } from '@/hooks/useLoad';
import { formatDate, formatDateTime, trimZeros, words } from '@/utils/format';
import { formatINR, isPositive } from '@/utils/currency';

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const { data, loading, error, refreshing, reload } = useLoad(async () => {
    const [product, stock] = await Promise.all([
      getData<ProductDetail>(`/products/${id}`),
      can('stock.read') ? getData<StockDetail>(`/inventory/balances/${id}`) : Promise.resolve(null),
    ]);
    return { product, stock };
  }, [id]);

  if (loading) return <Loading />;
  if (!data) return <ErrorText message={error ?? 'Could not load this product.'} />;
  const { product: p, stock } = data;
  const goAdjust = (mode: 'OPENING' | 'ADD' | 'REMOVE') =>
    router.push({ pathname: '/stock-adjust', params: { productId: p.id, mode } });

  const activePrices = p.prices.filter((x) => x.isActive);
  const firstPrice = activePrices[0];

  return (
    <Screen onRefresh={() => void reload(true)} refreshing={refreshing}>
      <Stack.Screen options={{ title: p.name }} />
      <ErrorText message={error} />

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 14 }}>
        <IconTile art={categoryArt(p.category?.name ?? p.name)} tint="mango" size={76} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 12, fontWeight: '700', color: colors.warning }}>
            {(p.category?.name ?? 'Product').toUpperCase()}
            {p.isTaxable && p.gstRatePercent ? ` · ${trimZeros(p.gstRatePercent)}% GST` : ''}
          </Text>
          <Text style={{ fontSize: 22, fontWeight: '800', color: colors.text }}>{p.name}</Text>
          {p.localName ? (
            <Text style={{ fontSize: 14, color: colors.textMuted }}>{p.localName}</Text>
          ) : null}
          {p.status !== 'ACTIVE' ? <Badge text={words(p.status)} tone="warn" /> : null}
        </View>
      </View>

      {stock ? (
        <Hero
          label="In stock in this branch"
          value={`${trimZeros(stock.quantityOnHand)} ${stock.baseUnitCode}`}
          valueTone={stock.isLowStock ? 'danger' : undefined}
          tint={stock.isLowStock ? 'tomato' : 'green'}
          art={stock.isLowStock ? icons.lowStock : icons.repStock}
          sub={
            isPositive(stock.minStockLevel)
              ? `Reorder when below ${trimZeros(stock.minStockLevel)} ${stock.baseUnitCode}${stock.isLowStock ? ' · running low' : ''}`
              : 'No reorder level set'
          }
        />
      ) : null}

      <Stats
        items={[
          {
            label: firstPrice
              ? `Selling (${trimZeros(firstPrice.quantity)} ${firstPrice.unitCode ?? ''})`
              : 'Selling price',
            value: firstPrice ? formatINR(firstPrice.price) : 'Not set',
            tint: firstPrice ? 'green' : 'tomato',
          },
          { label: 'MRP', value: p.mrp ? formatINR(p.mrp) : '—', tint: 'blue', hidden: !p.mrp },
          {
            label: 'Avg cost',
            value: stock?.averageCost ? formatINR(stock.averageCost) : '—',
            tint: 'mango',
            hidden: !stock?.averageCost,
          },
          {
            label: 'Stock value',
            value: formatINR(stock?.stockValue ?? '0'),
            tint: 'lavender',
            hidden: !stock?.averageCost,
          },
        ]}
      />

      {stock && can('stock.adjust') ? (
        <QuickActions
          actions={[
            {
              label: 'Opening stock',
              icon: 'flag-outline',
              primary: true,
              hidden: stock.recentMovements.length > 0,
              onPress: () => goAdjust('OPENING'),
            },
            {
              label: 'Add stock',
              icon: 'add-circle-outline',
              primary: stock.recentMovements.length > 0,
              onPress: () => goAdjust('ADD'),
            },
            {
              label: 'Remove stock',
              icon: 'remove-circle-outline',
              onPress: () => goAdjust('REMOVE'),
            },
            {
              label: 'Edit',
              icon: 'create-outline',
              hidden: !can('product.manage'),
              onPress: () => router.push({ pathname: '/product-edit', params: { id: p.id } }),
            },
          ]}
        />
      ) : can('product.manage') ? (
        <Button
          title="Edit product & prices"
          icon="create-outline"
          variant="secondary"
          onPress={() => router.push({ pathname: '/product-edit', params: { id: p.id } })}
        />
      ) : null}

      {activePrices.length > 1 || p.conversions.some((c) => !c.isBase) ? (
        <>
          <SectionTitle>Prices & units</SectionTitle>
          <Card>
            {activePrices.map((x) => (
              <KeyValue
                key={x.id}
                label={`${trimZeros(x.quantity)} ${x.unitCode ?? ''}`}
                value={formatINR(x.price)}
                bold
              />
            ))}
            {p.conversions
              .filter((c) => !c.isBase)
              .map((c) => (
                <KeyValue
                  key={c.unitId}
                  label={`1 ${c.unitCode}`}
                  value={`${trimZeros(c.factorToBase)} ${p.baseUnit.code}${c.isPurchaseUnit ? ' · bought' : ''}${c.isSaleUnit ? ' · sold' : ''}`}
                  tone="muted"
                />
              ))}
          </Card>
        </>
      ) : null}

      {stock && stock.batches.length > 0 ? (
        <>
          <SectionTitle>Batches</SectionTitle>
          <Group>
            {stock.batches.map((b) => (
              <View
                key={b.id}
                style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 12, gap: 10 }}
              >
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: colors.text }}>
                    {b.batchNumber}
                  </Text>
                  <Text style={{ fontSize: 12, color: colors.textMuted }}>
                    {b.expiryDate ? `Expires ${formatDate(b.expiryDate)}` : 'No expiry date'}
                  </Text>
                </View>
                {b.expiryStatus === 'EXPIRED' ? <Badge text="Expired" tone="bad" /> : null}
                {b.expiryStatus === 'EXPIRING_SOON' ? (
                  <Badge text="Expiring soon" tone="warn" />
                ) : null}
                <Text style={{ fontSize: 15, fontWeight: '800', color: colors.text }}>
                  {trimZeros(b.quantity)} {stock.baseUnitCode}
                </Text>
              </View>
            ))}
          </Group>
        </>
      ) : null}

      <SectionTitle>Details</SectionTitle>
      <Card>
        <KeyValue label="SKU" value={p.sku} />
        <KeyValue label="Sold by" value={p.baseUnit.code} />
        <KeyValue
          label="GST"
          value={
            p.isTaxable && p.gstRatePercent
              ? `${trimZeros(p.gstRatePercent)}%${p.taxMode ? ` (${words(p.taxMode)})` : ''}`
              : 'Exempt / 0%'
          }
        />
        {p.hsnCode ? <KeyValue label="HSN" value={p.hsnCode} /> : null}
        {p.barcodes.length > 0 ? (
          <KeyValue label="Barcodes" value={p.barcodes.map((b) => b.barcode).join(', ')} />
        ) : null}
      </Card>

      {stock ? (
        <>
          <SectionTitle>Recent movements</SectionTitle>
          {stock.recentMovements.length === 0 ? (
            <EmptyState art={illustrations.emptyMovement} title="No stock movements yet" />
          ) : (
            <Group>
              {stock.recentMovements.slice(0, 10).map((m) => (
                <EntryRow
                  key={m.id}
                  title={words(m.type)}
                  subtitle={formatDateTime(m.occurredAt)}
                  amount={`${isPositive(m.quantity) ? '+' : ''}${trimZeros(m.quantity)}`}
                  direction={isPositive(m.quantity) ? 'in' : 'out'}
                />
              ))}
            </Group>
          )}
        </>
      ) : null}
    </Screen>
  );
}
