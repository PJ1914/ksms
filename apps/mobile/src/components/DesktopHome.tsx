import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Dashboard } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { colors, radius, shadow, tints, type Tint } from '@/theme/colors';
import { formatINR } from '@/utils/currency';
import { DesktopDashboard } from './DesktopDashboard';
import { MAX_FONT_SCALE } from './ui';

type Icon = React.ComponentProps<typeof Ionicons>['name'];
export interface HomeCounts {
  billsToday: number | null;
  lowStock: number | null;
  expiring: number | null;
  customersOwing: number | null;
  suppliersOwed: number | null;
}

function Action({
  label,
  icon,
  to,
  primary,
}: {
  label: string;
  icon: Icon;
  to: Href;
  primary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => router.push(to)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        minHeight: 60,
        paddingHorizontal: 22,
        borderRadius: radius.md,
        borderWidth: 2,
        borderColor: primary ? colors.primary : colors.border,
        backgroundColor: primary
          ? hovered
            ? colors.primaryDark
            : colors.primary
          : hovered
            ? colors.primarySoft
            : colors.surface,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <Ionicons name={icon} size={30} color={primary ? colors.onPrimary : colors.primary} />
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{ fontSize: 18, fontWeight: '800', color: primary ? colors.onPrimary : colors.text }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Kpi({
  label,
  value,
  note,
  icon,
  tint,
  to,
  alert,
}: {
  label: string;
  value: string | number | null | undefined;
  note?: string;
  icon: Icon;
  tint: Tint;
  to: Href;
  alert?: boolean;
}) {
  const t = tints[tint];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? 'loading'}. ${note ?? ''}`}
      onPress={() => router.push(to)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flexGrow: 1,
        flexBasis: 250,
        minWidth: 250,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
        padding: 20,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: hovered ? colors.primary : alert ? t.fg : colors.border,
        backgroundColor: colors.surface,
        opacity: pressed ? 0.85 : 1,
        ...shadow.card,
      })}
    >
      <View
        style={{
          width: 64,
          height: 64,
          borderRadius: 32,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: t.bg,
        }}
      >
        <Ionicons name={icon} size={34} color={t.fg} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          numberOfLines={1}
          style={{ fontSize: 15, fontWeight: '700', color: colors.textMuted }}
        >
          {label}
        </Text>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          numberOfLines={1}
          style={{ fontSize: 28, fontWeight: '700', color: colors.text }}
        >
          {value ?? '…'}
        </Text>
        {note ? (
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            numberOfLines={1}
            style={{ fontSize: 14, color: colors.textMuted }}
          >
            {note}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

function Title({ children }: { children: string }) {
  return (
    <Text
      accessibilityRole="header"
      maxFontSizeMultiplier={MAX_FONT_SCALE}
      style={{
        fontSize: 20,
        fontWeight: '800',
        color: colors.text,
        marginTop: 36,
        marginBottom: 16,
      }}
    >
      {children}
    </Text>
  );
}

/** The desktop/tablet home: a compact control-room view, not a stretched phone screen. */
export function DesktopHome({
  name,
  shop,
  d,
  counts,
}: {
  name: string;
  shop: string;
  d: Dashboard | null | undefined;
  counts: HomeCounts | undefined;
}) {
  const { can } = useAuth();
  const date = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{ padding: 32, paddingBottom: 56, maxWidth: 1500, width: '100%' }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 20 }}>
        <View style={{ flexGrow: 1, minWidth: 260 }}>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={{ fontSize: 32, fontWeight: '800', color: colors.text }}
          >
            Namaste, {name}
          </Text>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={{ fontSize: 16, color: colors.textMuted, marginTop: 2 }}
          >
            {shop} · {date}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
          {can('sale.create') ? (
            <Action primary label="New bill" icon="add-circle" to="/sale/new" />
          ) : null}
          {can('product.manage') ? (
            <Action label="Add product" icon="cube-outline" to="/product-new" />
          ) : null}
          {can('customer.manage') ? (
            <Action label="Add customer" icon="person-add-outline" to="/customer-new" />
          ) : null}
          {can('collection.create') ? (
            <Action label="Collect money" icon="cash-outline" to="/(tabs)/khata" />
          ) : null}
        </View>
      </View>

      <Title>Today</Title>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
        <Kpi
          label={d?.sales ? "Today's sales" : 'Bills today'}
          value={d?.sales ? formatINR(d.sales.netSales) : counts?.billsToday}
          note={d?.sales ? `${counts?.billsToday ?? '…'} bills` : undefined}
          icon="trending-up"
          tint="green"
          to="/reports/sales"
        />
        {d?.profit ? (
          <Kpi
            label="Profit today"
            value={formatINR(d.profit.today.netProfit)}
            note={d.profit.isEstimate ? 'Estimate' : undefined}
            icon="wallet-outline"
            tint="mango"
            to="/reports/profit"
          />
        ) : null}
        {d ? (
          <Kpi
            label="Cash in hand today"
            value={formatINR(d.cashToday.net)}
            icon="cash-outline"
            tint="blue"
            to="/reports/cash"
          />
        ) : null}
      </View>

      <Title>Needs your attention</Title>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>
        <Kpi
          label="Low stock"
          value={counts?.lowStock}
          icon="alert-circle-outline"
          tint="mango"
          to="/(tabs)/stock"
          alert={!!counts?.lowStock}
        />
        <Kpi
          label="Expiring in 30 days"
          value={counts?.expiring}
          icon="time-outline"
          tint="tomato"
          to="/(tabs)/stock"
          alert={!!counts?.expiring}
        />
        <Kpi
          label="Owed to you"
          value={d ? formatINR(d.owed.customerDue) : counts?.customersOwing}
          note={`${counts?.customersOwing ?? '…'} customers`}
          icon="people-outline"
          tint="tomato"
          to="/(tabs)/khata"
        />
        <Kpi
          label="You owe"
          value={d ? formatINR(d.owed.supplierPayable) : counts?.suppliersOwed}
          note={`${counts?.suppliersOwed ?? '…'} suppliers`}
          icon="business-outline"
          tint="blue"
          to="/suppliers"
        />
      </View>

      <DesktopDashboard />
    </ScrollView>
  );
}
