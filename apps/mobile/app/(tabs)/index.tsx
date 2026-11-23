import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getData, getPage } from '@/api/client';
import type { Dashboard, ExpiringRow } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { useCart } from '@/cart/CartProvider';
import { Button, Card, KeyValue, Screen, SectionTitle } from '@/components/ui';
import { formatINR, isNegative } from '@/utils/currency';
import { useLoad } from '@/hooks/useLoad';
import { colors } from '@/theme/colors';
import { todayInIndia } from '@/utils/today';

interface Counts {
  billsToday: number | null;
  lowStock: number | null;
  expiring: number | null;
  customersOwing: number | null;
  suppliersOwed: number | null;
}

/** Home: today at a glance. Counts for everyone; money figures come from the reports and only for roles that may see them. */
export default function HomeScreen() {
  const { profile, branch, can } = useAuth();
  const { cart } = useCart();
  const today = todayInIndia();

  const { data, refreshing, reload } = useLoad<Counts>(async () => {
    const total = async (path: string) => (await getPage(path)).meta.total;
    const [billsToday, lowStock, expiring, customersOwing, suppliersOwed] = await Promise.all([
      can('sale.read')
        ? total(`/sales?from=${today}&to=${today}&status=COMPLETED&pageSize=1`).catch(() => null)
        : null,
      can('stock.read')
        ? total('/inventory/balances?lowStock=true&pageSize=1').catch(() => null)
        : null,
      can('stock.read')
        ? getData<ExpiringRow[]>('/inventory/expiring?withinDays=30')
            .then((r) => r.length)
            .catch(() => null)
        : null,
      can('customer.read') ? total('/customers?owes=true&pageSize=1').catch(() => null) : null,
      can('supplier.read') ? total('/suppliers?owed=true&pageSize=1').catch(() => null) : null,
    ]);
    return { billsToday, lowStock, expiring, customersOwing, suppliersOwed };
  }, [today, branch?.id]);

  const money = useLoad<Dashboard | null>(
    () =>
      can('report.financial') ? getData<Dashboard>('/reports/dashboard') : Promise.resolve(null),
    [today, branch?.id],
  );
  const d = money.data;

  const firstName = profile?.user.fullName.split(' ')[0] ?? '';

  return (
    <Screen
      onRefresh={() => {
        void reload(true);
        void money.reload(true);
      }}
      refreshing={refreshing || money.refreshing}
    >
      <Text style={{ fontSize: 24, fontWeight: '800', color: colors.text }}>
        Namaste, {firstName}
      </Text>
      <Text style={{ color: colors.primary, fontWeight: '600', marginBottom: 16 }}>
        {profile?.organization.name}
        {branch ? ` · ${branch.name}` : ''}
      </Text>

      {can('sale.create') ? (
        <Button
          title={cart.lines.length ? `Continue the bill (${cart.lines.length} items)` : 'New bill'}
          onPress={() => router.push('/sale/new')}
        />
      ) : null}

      {d ? (
        <>
          <SectionTitle>Today's money</SectionTitle>
          <Card>
            {d.sales ? (
              <>
                <KeyValue label="Net sales (before GST)" value={formatINR(d.sales.netSales)} bold />
                <KeyValue label="Billed to customers" value={formatINR(d.sales.billValue)} />
                <KeyValue label="Left on credit" value={formatINR(d.sales.creditGiven)} />
              </>
            ) : null}
            <KeyValue
              label="Cash book: money in"
              value={formatINR(d.cashToday.moneyIn)}
              tone="success"
            />
            <KeyValue
              label="Cash book: money out"
              value={formatINR(d.cashToday.moneyOut)}
              tone="danger"
            />
            {d.profit ? (
              <KeyValue
                label="Net profit today (estimate)"
                value={formatINR(d.profit.today.netProfit)}
                bold
                tone={isNegative(d.profit.today.netProfit) ? 'danger' : 'success'}
              />
            ) : null}
          </Card>
          <Card style={{ marginTop: 8 }}>
            <KeyValue
              label="Customers owe you"
              value={formatINR(d.owed.customerDue)}
              tone="danger"
            />
            <KeyValue
              label="You owe suppliers"
              value={formatINR(d.owed.supplierPayable)}
              tone="danger"
            />
            {d.stock ? (
              <KeyValue label="Stock value (at cost)" value={formatINR(d.stock.stockValue)} />
            ) : null}
          </Card>
          <Button title="All reports" variant="secondary" onPress={() => router.push('/reports')} />
        </>
      ) : null}

      <SectionTitle>Today</SectionTitle>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Tile
          icon="receipt-outline"
          label="Bills today"
          value={data?.billsToday}
          onPress={() => router.push('/(tabs)/billing')}
        />
        <Tile
          icon="alert-circle-outline"
          label="Low stock"
          value={data?.lowStock}
          warn
          onPress={() => router.push('/(tabs)/stock')}
        />
        <Tile
          icon="time-outline"
          label="Expired or expiring in 30 days"
          value={data?.expiring}
          warn
          onPress={() => router.push('/(tabs)/stock')}
        />
        <Tile
          icon="people-outline"
          label="Customers owing"
          value={data?.customersOwing}
          onPress={() => router.push('/(tabs)/khata')}
        />
        <Tile
          icon="business-outline"
          label="Suppliers you owe"
          value={data?.suppliersOwed}
          onPress={() => router.push('/suppliers')}
        />
      </View>
    </Screen>
  );
}

function Tile({
  icon,
  label,
  value,
  warn,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: number | null | undefined;
  warn?: boolean;
  onPress: () => void;
}) {
  if (value === null) return null; // not allowed for this role
  const bad = warn && (value ?? 0) > 0;
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        width: '48%',
        backgroundColor: bad ? colors.warningSoft : colors.surface,
        borderColor: bad ? colors.warning : colors.border,
        borderWidth: 1,
        borderRadius: 12,
        padding: 14,
      }}
    >
      <Ionicons name={icon} size={22} color={bad ? colors.warning : colors.primary} />
      <Text style={{ fontSize: 28, fontWeight: '800', color: colors.text, marginTop: 6 }}>
        {value ?? '…'}
      </Text>
      <Text style={{ color: colors.textMuted }}>{label}</Text>
    </Pressable>
  );
}
