import { router } from 'expo-router';
import { Image, type ImageSourcePropType, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
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
