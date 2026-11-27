import { router } from 'expo-router';
import { Image, type ImageSourcePropType, Pressable, StyleSheet, Text, View } from 'react-native';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthProvider';
import SalesReport from './sales';
import ProfitReport from './profit';
import CashReport from './cash';
import DuesReport from './dues';
import CollectionsReport from './collections';
import DayBookReport from './day-book';
import PurchasesReport from './purchases';
import StockReport from './stock';
import { EmptyState, MAX_FONT_SCALE, Screen, useLayout } from '@/components/ui';
import { icons, illustrations } from '@/theme/art';
import { colors, radius, shadow, tints, type Tint } from '@/theme/colors';

const ITEMS: readonly {
  perm: string;
  title: string;
  note: string;
  to: Parameters<typeof router.push>[0];
  art: ImageSourcePropType;
  tint: Tint;
}[] = [
  {
    perm: 'report.sales',
    title: 'Sales',
    note: 'By day, product, customer, payment',
    to: '/reports/sales',
    art: icons.repSales,
    tint: 'green',
  },
  {
    perm: 'report.profit',
    title: 'Profit',
    note: 'Gross and net profit, expenses',
    to: '/reports/profit',
    art: icons.repProfit,
    tint: 'mango',
  },
  {
    perm: 'report.financial',
    title: 'Cash flow',
    note: 'Money in and out by mode',
    to: '/reports/cash',
    art: icons.repCash,
    tint: 'blue',
  },
  {
    perm: 'report.financial',
    title: 'Money owed',
    note: 'Customer khata, supplier dues',
    to: '/reports/dues',
    art: icons.repDues,
    tint: 'tomato',
  },
  {
    perm: 'report.financial',
    title: 'Collections',
    note: 'Khata money collected',
    to: '/reports/collections',
    art: icons.repCollections,
    tint: 'green',
  },
  {
    perm: 'report.financial',
    title: 'Day book',
    note: 'Everything on one day',
    to: '/reports/day-book',
    art: icons.repDayBook,
    tint: 'lavender',
  },
  {
    perm: 'report.purchases',
    title: 'Purchases',
    note: 'What you bought',
    to: '/reports/purchases',
    art: icons.repPurchases,
    tint: 'mango',
  },
  {
    perm: 'report.inventory',
    title: 'Stock',
    note: 'Value, expiry, fast and slow sellers',
    to: '/reports/stock',
    art: icons.repStock,
    tint: 'blue',
  },
];

const REPORT_SCREENS: Record<string, () => React.JSX.Element> = {
  '/reports/sales': SalesReport,
  '/reports/profit': ProfitReport,
  '/reports/cash': CashReport,
  '/reports/dues': DuesReport,
  '/reports/collections': CollectionsReport,
  '/reports/day-book': DayBookReport,
  '/reports/purchases': PurchasesReport,
  '/reports/stock': StockReport,
};

/** Desktop: the report list on the left, the chosen report beside it. */
function DesktopReports({ allowed }: { allowed: typeof ITEMS }) {
  const [active, setActive] = useState(String(allowed[0]!.to));
  const Report = REPORT_SCREENS[active];
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.background }}>
      <View
        style={{
          width: 280,
          padding: 16,
          gap: 6,
          borderRightWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: '800', color: colors.text, padding: 8 }}>
          Reports
        </Text>
        {allowed.map((i) => (
          <Pressable
            key={i.title}
            accessibilityRole="button"
            accessibilityState={{ selected: active === String(i.to) }}
            onPress={() => setActive(String(i.to))}
            style={{
              padding: 12,
              borderRadius: radius.sm,
              backgroundColor: active === String(i.to) ? colors.primarySoft : 'transparent',
            }}
          >
            <Text
              style={{
                fontWeight: '700',
                color: active === String(i.to) ? colors.primary : colors.text,
              }}
            >
              {i.title}
            </Text>
            <Text style={{ fontSize: 12, color: colors.textMuted }}>{i.note}</Text>
          </Pressable>
        ))}
      </View>
      <View key={active} style={{ flex: 1, minWidth: 0 }}>
        {Report ? <Report /> : null}
      </View>
    </View>
  );
}

/** The reports this role may open, as picture tiles. The server checks the same permissions again. */
export default function ReportsHub() {
  const { can } = useAuth();
  const layout = useLayout();
  const w = layout.tileWidth(layout.columns(150, 2, 4));
  const allowed = ITEMS.filter((i) => can(i.perm as Parameters<typeof can>[0]));
  if (allowed.length === 0) {
    return (
      <EmptyState art={illustrations.roleLocked} title="No reports are available for your role" />
    );
  }
  if (layout.mode === 'desktop') return <DesktopReports allowed={allowed} />;
  return (
    <Screen>
      <View style={styles.grid}>
        {allowed.map((i) => (
          <Pressable
            key={i.title}
            accessibilityRole="button"
            accessibilityLabel={`${i.title}. ${i.note}`}
            onPress={() => router.push(i.to)}
            style={({ pressed }) => [styles.tile, { width: w }, pressed && { opacity: 0.8 }]}
          >
            <View style={[styles.art, { backgroundColor: tints[i.tint].bg }]}>
              <Image source={i.art} style={{ width: 48, height: 48 }} resizeMode="contain" />
            </View>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.title}>
              {i.title}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.note} numberOfLines={2}>
              {i.note}
            </Text>
          </Pressable>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 14,
    gap: 6,
    minHeight: 150,
    ...shadow.card,
    shadowOpacity: 0.04,
  },
  art: { width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '800', color: colors.text, marginTop: 4 },
  note: { fontSize: 12, color: colors.textMuted, lineHeight: 16 },
});
