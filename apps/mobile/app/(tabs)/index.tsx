import { router } from 'expo-router';
import { Image, type ImageSourcePropType, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getData, getPage } from '@/api/client';
import type { Dashboard, ExpiringRow } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { useCart } from '@/cart/CartProvider';
import {
  Avatar,
  Button,
  LinkText,
  Screen,
  SectionTitle,
  useLayout,
  MAX_FONT_SCALE,
  QuickActions,
} from '@/components/ui';
import { SyncBanner } from '@/components/SyncBanner';
import { DesktopHome } from '@/components/DesktopHome';
import { formatINR, isNegative } from '@/utils/currency';
import { useLoad } from '@/hooks/useLoad';
import { icons, illustrations } from '@/theme/art';
import { colors, radius, shadow, tints, type Tint } from '@/theme/colors';
import { todayInIndia } from '@/utils/today';

interface Counts {
  billsToday: number | null;
  lowStock: number | null;
  expiring: number | null;
  customersOwing: number | null;
  suppliersOwed: number | null;
}

/** Home: today at a glance. Counts for everyone; money figures only for roles that may see them. */
export default function HomeScreen() {
  const { profile, branch, can } = useAuth();
  const { cart } = useCart();
  const today = todayInIndia();
  const layout = useLayout();
  const tileW = layout.tileWidth(layout.columns(150, 2, 4));

  const { data, refreshing, reload } = useLoad<Counts>(
    async () => {
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
    },
    [today, branch?.id],
    `home-counts:${today}`,
  );

  const money = useLoad<Dashboard | null>(
    () =>
      can('report.financial') ? getData<Dashboard>('/reports/dashboard') : Promise.resolve(null),
    [today, branch?.id],
    `home-dashboard:${today}`,
  );
  const d = money.data;

  const fullName = profile?.user.fullName ?? '';
  const firstName = fullName.split(' ')[0] ?? '';

  if (layout.mode !== 'phone')
    return (
      <DesktopHome
        shop={`${profile?.organization.name ?? ''}${branch ? ` · ${branch.name}` : ''}`}
        d={d}
        counts={data ?? undefined}
      />
    );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
      <Screen
        onRefresh={() => {
          void reload(true);
          void money.reload(true);
        }}
        refreshing={refreshing || money.refreshing}
      >
        {/* Greeting */}
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Your profile"
            onPress={() => router.push('/(tabs)/more')}
          >
            <Avatar name={fullName || 'You'} size={46} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.shop} numberOfLines={1}>
              {profile?.organization.name}
              {branch ? ` · ${branch.name}` : ''}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.hello} numberOfLines={1}>
              Namaste, {firstName}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Notifications"
            onPress={() => router.push('/notifications')}
            style={styles.bell}
          >
            <Ionicons name="notifications-outline" size={22} color={colors.text} />
          </Pressable>
        </View>

        <SyncBanner />

        {/* Hero: today's sales (money roles) or today's bill count */}
        <View style={styles.hero}>
          <View style={styles.heroBlob} />
          <View style={styles.heroTop}>
            <View style={{ flex: 1 }}>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.heroLabel}>
                {d?.sales ? "Today's sales" : 'Bills today'}
              </Text>
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={styles.heroValue}
                adjustsFontSizeToFit
                numberOfLines={1}
              >
                {d?.sales ? formatINR(d.sales.netSales) : (data?.billsToday ?? '…')}
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.heroSub}>
                {d?.sales
                  ? `${data?.billsToday ?? '…'} bills${
                      d.profit ? ` · ${formatINR(d.profit.today.netProfit)} profit` : ''
                    }`
                  : `${profile?.role.name ?? ''}`}
              </Text>
            </View>
            <Image source={illustrations.basket} style={styles.heroArt} resizeMode="contain" />
          </View>
          {d ? (
            <View style={styles.heroRow}>
              <View style={styles.heroChip}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.heroChipLabel}>
                  Cash in
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.heroChipValue}>
                  {formatINR(d.cashToday.moneyIn)}
                </Text>
              </View>
              <View style={styles.heroChip}>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.heroChipLabel}>
                  Cash out
                </Text>
                <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.heroChipValue}>
                  {formatINR(d.cashToday.moneyOut)}
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Open reports"
                onPress={() => router.push('/reports')}
                style={styles.heroGo}
              >
                <Ionicons name="chevron-forward" size={22} color={colors.text} />
              </Pressable>
            </View>
          ) : null}
        </View>

        <View style={{ marginTop: 12 }}>
          <QuickActions
            actions={[
              {
                label: 'Scan & sell',
                icon: 'barcode-outline',
                primary: true,
                hidden: !can('sale.create'),
                onPress: () => router.push('/sale/scan'),
              },
              {
                label: 'Add product',
                icon: 'cube-outline',
                hidden: !can('product.manage'),
                onPress: () => router.push('/product-new'),
              },
              {
                label: 'Add customer',
                icon: 'person-add-outline',
                hidden: !can('customer.manage'),
                onPress: () => router.push('/customer-new'),
              },
              {
                label: 'Calculator',
                icon: 'calculator-outline',
                onPress: () => router.push('/calculator'),
              },
            ]}
          />
        </View>

        {cart.lines.length && can('sale.create') ? (
          <Button
            icon="receipt-outline"
            variant="accent"
            title={`Continue the bill (${cart.lines.length} item${cart.lines.length === 1 ? '' : 's'})`}
            onPress={() => router.push('/sale/new')}
          />
        ) : null}

        <SectionTitle
          action={
            can('sale.read') ? (
              <LinkText title="Today's bills" onPress={() => router.push('/(tabs)/billing')} />
            ) : undefined
          }
        >
          Needs attention
        </SectionTitle>
        <View style={styles.grid}>
          <Tile
            width={tileW}
            art={icons.lowStock}
            tint="mango"
            label="Low stock"
            value={data?.lowStock}
            warn
            onPress={() => router.push('/(tabs)/stock')}
          />
          <Tile
            width={tileW}
            art={icons.expiring}
            tint="tomato"
            label="Expiring in 30 days"
            value={data?.expiring}
            warn
            onPress={() => router.push('/(tabs)/stock')}
          />
          <Tile
            width={tileW}
            art={icons.repDues}
            tint="green"
            label="Customers owing"
            value={data?.customersOwing}
            onPress={() => router.push('/(tabs)/khata')}
          />
          <Tile
            width={tileW}
            art={icons.addSupplier}
            tint="blue"
            label="Suppliers you owe"
            value={data?.suppliersOwed}
            onPress={() => router.push('/suppliers')}
          />
        </View>

        {d ? (
          <View style={styles.owed}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/reports/dues')}
              style={[styles.owedHalf, { borderRightWidth: 1, borderRightColor: colors.border }]}
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.owedLabel}>
                Customers owe you
              </Text>
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={[styles.owedValue, { color: colors.danger }]}
              >
                {formatINR(d.owed.customerDue)}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push('/reports/dues')}
              style={styles.owedHalf}
            >
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.owedLabel}>
                You owe suppliers
              </Text>
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.owedValue}>
                {formatINR(d.owed.supplierPayable)}
              </Text>
            </Pressable>
          </View>
        ) : null}
        {d?.stock ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.footNote}>
            Stock value at cost: {formatINR(d.stock.stockValue)}
            {d.profit && isNegative(d.profit.today.netProfit)
              ? ' · Today is running at a loss'
              : ''}
          </Text>
        ) : null}
      </Screen>
    </SafeAreaView>
  );
}

function Tile({
  width,
  art,
  tint,
  label,
  value,
  warn,
  onPress,
}: {
  width: number;
  art: ImageSourcePropType;
  tint: Tint;
  label: string;
  value: number | null | undefined;
  warn?: boolean;
  onPress: () => void;
}) {
  if (value === null) return null; // not allowed for this role
  const quiet = warn && (value ?? 0) === 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? 'loading'}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tile,
        { width },
        { backgroundColor: quiet ? colors.surface : tints[tint].bg },
        pressed && { opacity: 0.8 },
      ]}
    >
      <View style={styles.tileTop}>
        <View style={styles.tileArt}>
          <Image source={art} style={{ width: 34, height: 34 }} resizeMode="contain" />
        </View>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.tileValue}>
          {value ?? '…'}
        </Text>
      </View>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.tileLabel}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  shop: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  hello: { fontSize: 24, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },
  bell: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  hero: {
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    padding: 20,
    overflow: 'hidden',
    marginBottom: 6,
    gap: 14,
  },
  heroBlob: {
    position: 'absolute',
    right: -40,
    top: -40,
    width: 170,
    height: 170,
    borderRadius: 85,
    backgroundColor: '#26895A',
  },
  heroTop: { flexDirection: 'row', alignItems: 'center' },
  heroLabel: { color: colors.onPrimaryMuted, fontSize: 13, fontWeight: '700' },
  heroValue: { color: colors.onPrimary, fontSize: 36, fontWeight: '800', letterSpacing: -0.5 },
  heroSub: { color: colors.onPrimaryMuted, fontSize: 13, marginTop: 2 },
  heroArt: { width: 112, height: 104, marginLeft: 8 },
  heroRow: { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  heroChip: {
    flex: 1,
    backgroundColor: '#17633D',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  heroChipLabel: { color: '#C4E6D1', fontSize: 12 },
  heroChipValue: { color: colors.onPrimary, fontWeight: '800', fontSize: 15 },
  heroGo: {
    width: 48,
    borderRadius: 14,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { borderRadius: radius.lg, padding: 14, gap: 8, minHeight: 108 },
  tileTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileArt: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileValue: { fontSize: 26, fontWeight: '800', color: colors.text },
  tileLabel: { fontSize: 13, fontWeight: '700', color: '#3D4C43' },
  owed: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    marginTop: 12,
    ...shadow.card,
  },
  owedHalf: { flex: 1, paddingVertical: 14, paddingHorizontal: 16 },
  owedLabel: { fontSize: 13, color: colors.textMuted },
  owedValue: { fontSize: 19, fontWeight: '800', color: colors.text, marginTop: 2 },
  footNote: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: 14 },
});
