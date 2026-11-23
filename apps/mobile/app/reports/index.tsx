import { router } from 'expo-router';
import { View } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import { EmptyState, ListRow, Screen } from '@/components/ui';

const ITEMS = [
  {
    perm: 'report.sales',
    title: 'Sales',
    note: 'By day, product, category, customer, payment',
    to: '/reports/sales',
  },
  {
    perm: 'report.profit',
    title: 'Profit and expenses',
    note: 'Revenue, gross and net profit (estimates)',
    to: '/reports/profit',
  },
  {
    perm: 'report.financial',
    title: 'Cash flow',
    note: 'Money in and out, by payment mode',
    to: '/reports/cash',
  },
  {
    perm: 'report.financial',
    title: 'Money owed',
    note: 'Customer khata and supplier dues',
    to: '/reports/dues',
  },
  {
    perm: 'report.financial',
    title: 'Collections',
    note: 'Khata money collected, by agent',
    to: '/reports/collections',
  },
  {
    perm: 'report.financial',
    title: 'Day book',
    note: 'Everything that happened on a day',
    to: '/reports/day-book',
  },
  {
    perm: 'report.purchases',
    title: 'Purchases',
    note: 'What you bought, by day',
    to: '/reports/purchases',
  },
  {
    perm: 'report.inventory',
    title: 'Stock',
    note: 'Stock value, expiry, fast and slow sellers',
    to: '/reports/stock',
  },
] as const;

/** The reports this role may open. The server checks the same permissions again on every request. */
export default function ReportsHub() {
  const { can } = useAuth();
  const allowed = ITEMS.filter((i) => can(i.perm));
  if (allowed.length === 0) {
    return <EmptyState icon="lock-closed-outline" title="No reports are available for your role" />;
  }
  return (
    <Screen>
      <View style={{ gap: 8 }}>
        {allowed.map((i) => (
          <ListRow key={i.to} title={i.title} subtitle={i.note} onPress={() => router.push(i.to)} />
        ))}
      </View>
    </Screen>
  );
}
