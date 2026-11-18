import { router, Stack, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';
import { getData } from '@/api/client';
import type { ProductDetail, StockDetail } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  KeyValue,
  Loading,
  Screen,
  SectionTitle,
} from '@/components/ui';
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

  return (
    <Screen onRefresh={() => void reload(true)} refreshing={refreshing}>
      <Stack.Screen options={{ title: p.name }} />
      <ErrorText message={error} />

      <Card>
        <KeyValue label="SKU" value={p.sku} />
        {p.localName ? <KeyValue label="Local name" value={p.localName} /> : null}
        {p.category ? <KeyValue label="Category" value={p.category.name} /> : null}
        <KeyValue label="Sold by" value={p.baseUnit.code} />
        {p.mrp ? <KeyValue label="MRP (per unit)" value={formatINR(p.mrp)} /> : null}
        {p.status !== 'ACTIVE' ? <Badge text={words(p.status)} tone="warn" /> : null}
      </Card>

      <SectionTitle>Selling prices</SectionTitle>
      <Card>
        {p.prices.length === 0 ? (
          <KeyValue label="No price set" value="" tone="danger" />
        ) : (
          p.prices
            .filter((x) => x.isActive)
            .map((x) => (
              <KeyValue
                key={x.id}
                label={`${trimZeros(x.quantity)} ${x.unitCode ?? ''}`}
                value={formatINR(x.price)}
                bold
              />
            ))
        )}
        <View style={{ height: 4 }} />
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

      {stock ? (
        <>
          <SectionTitle>Stock in this branch</SectionTitle>
          <Card>
            <KeyValue
              label="On hand"
              value={`${trimZeros(stock.quantityOnHand)} ${stock.baseUnitCode}`}
              bold
              tone={stock.isLowStock ? 'danger' : undefined}
            />
            {isPositive(stock.minStockLevel) ? (
              <KeyValue
                label="Reorder level"
                value={`${trimZeros(stock.minStockLevel)} ${stock.baseUnitCode}`}
              />
            ) : null}
            {stock.isLowStock ? <Badge text="Low stock" tone="bad" /> : null}
            {stock.averageCost ? (
              <>
                <KeyValue
                  label="Average cost"
                  value={`${formatINR(stock.averageCost)} / ${stock.baseUnitCode}`}
                />
                <KeyValue label="Stock value" value={formatINR(stock.stockValue ?? '0')} />
              </>
            ) : null}
          </Card>

          {stock.batches.length > 0 ? (
            <>
              <SectionTitle>Batches</SectionTitle>
              <Card>
                {stock.batches.map((b) => (
                  <View key={b.id} style={{ paddingVertical: 4 }}>
                    <KeyValue
                      label={`${b.batchNumber}${b.expiryDate ? ` · ${formatDate(b.expiryDate)}` : ''}`}
                      value={`${trimZeros(b.quantity)} ${stock.baseUnitCode}`}
                    />
                    {b.expiryStatus === 'EXPIRED' ? <Badge text="Expired" tone="bad" /> : null}
                    {b.expiryStatus === 'EXPIRING_SOON' ? (
                      <Badge text="Expiring soon" tone="warn" />
                    ) : null}
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          {can('stock.adjust') ? (
            <>
              <SectionTitle>Change stock</SectionTitle>
              {stock.movements.length === 0 ? (
                <Button title="Set opening stock" onPress={() => goAdjust('OPENING')} />
              ) : null}
              <Button title="Add stock" variant="secondary" onPress={() => goAdjust('ADD')} />
              <Button
                title="Remove stock (damage, loss, expiry)"
                variant="secondary"
                onPress={() => goAdjust('REMOVE')}
              />
            </>
          ) : null}

          <SectionTitle>Recent movements</SectionTitle>
          <Card>
            {stock.movements.length === 0 ? (
              <EmptyState title="No stock movements yet" />
            ) : (
              stock.movements
                .slice(0, 10)
                .map((m) => (
                  <KeyValue
                    key={m.id}
                    label={`${words(m.type)} · ${formatDateTime(m.occurredAt)}`}
                    value={`${isPositive(m.quantity) ? '+' : ''}${trimZeros(m.quantity)}`}
                    tone={isPositive(m.quantity) ? 'success' : 'danger'}
                  />
                ))
            )}
          </Card>
        </>
      ) : null}
    </Screen>
  );
}
