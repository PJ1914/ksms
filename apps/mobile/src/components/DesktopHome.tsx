import { Ionicons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { Dashboard } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { colors, workspace, tints, type Tint } from '@/theme/colors';
import { formatINR } from '@/utils/currency';
import { DesktopDashboard } from './DesktopDashboard';
import { MAX_FONT_SCALE, useLayout } from './ui';

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
        minHeight: workspace.control,
        paddingHorizontal: 12,
        borderRadius: workspace.radius,
        borderWidth: 1,
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
      <Ionicons name={icon} size={17} color={primary ? colors.onPrimary : colors.primary} />
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{
          fontSize: workspace.body,
          fontWeight: '600',
          color: primary ? colors.onPrimary : colors.text,
        }}
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
  row = false,
}: {
  label: string;
  value: string | number | null | undefined;
  note?: string;
  icon: Icon;
  tint: Tint;
  to: Href;
  row?: boolean;
}) {
  const t = tints[tint];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value ?? 'loading'}. ${note ?? ''}`}
      onPress={() => router.push(to)}
      style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
        flexGrow: row ? 0 : 1,
        flexBasis: row ? 'auto' : 160,
        minHeight: row ? 54 : 84,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        padding: 12,
        borderRadius: row ? 0 : workspace.radius,
        borderWidth: row ? 0 : 1,
        borderTopWidth: 1,
        borderColor: hovered ? colors.primary : colors.border,
        backgroundColor: colors.surface,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View
        style={{
          width: 30,
          height: 30,
          borderRadius: workspace.radius,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: t.bg,
        }}
      >
        <Ionicons name={icon} size={16} color={t.fg} />
      </View>
      <View
        style={{
          flex: 1,
          minWidth: 0,
          flexDirection: row ? 'row' : 'column',
          alignItems: row ? 'center' : 'flex-start',
          gap: 3,
        }}
      >
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          numberOfLines={1}
          style={{
            flex: row ? 1 : undefined,
            fontSize: row ? workspace.body : workspace.caption,
            fontWeight: '500',
            color: colors.textMuted,
          }}
        >
          {label}
        </Text>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          numberOfLines={1}
          style={{
            fontSize: row ? workspace.body : 22,
            fontVariant: ['tabular-nums'],
            fontWeight: '600',
            color: colors.text,
          }}
        >
          {value ?? '…'}
        </Text>
        {note && !row ? (
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            numberOfLines={1}
            style={{ fontSize: workspace.caption, color: colors.textMuted }}
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
        fontSize: 15,
        fontWeight: '600',
        color: colors.text,
        padding: 14,
      }}
    >
      {children}
    </Text>
  );
}

/** The desktop/tablet home: a compact control-room view, not a stretched phone screen. */
export function DesktopHome({
  shop,
  d,
  counts,
}: {
  shop: string;
  d: Dashboard | null | undefined;
  counts: HomeCounts | undefined;
}) {
  const { can } = useAuth();
  const { contentWidth } = useLayout();
  const hasActivity = can('sale.read') || can('report.sales') || can('report.financial');
  const sideBySide = hasActivity && contentWidth >= 800;
  const date = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={{
        padding: workspace.gutter,
        gap: 16,
        alignSelf: 'center',
        paddingBottom: 32,
        maxWidth: 1440,
        width: '100%',
      }}
    >
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 20 }}>
        <View style={{ flexGrow: 1, minWidth: 200 }}>
          <Text
            accessibilityRole="header"
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={{
              fontSize: workspace.title,
              letterSpacing: -0.6,
              fontWeight: '600',
              color: colors.text,
            }}
          >
            Shop overview
          </Text>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={{ fontSize: workspace.caption, color: colors.textMuted, marginTop: 2 }}
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
          <Action label="Calculator" icon="calculator-outline" to="/calculator" />
        </View>
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
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

      <View style={{ flexDirection: sideBySide ? 'row' : 'column', gap: 16 }}>
        {hasActivity && (
          <View style={{ flex: sideBySide ? 1 : undefined, minWidth: 0 }}>
            <DesktopDashboard />
          </View>
        )}
        <View
          style={{
            width: sideBySide ? 284 : '100%',
            alignSelf: 'flex-start',
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: workspace.radius,
            overflow: 'hidden',
            backgroundColor: colors.surface,
          }}
        >
          <Title>Needs attention</Title>
          <Kpi
            row
            label="Low stock"
            value={counts?.lowStock}
            icon="alert-circle-outline"
            tint="mango"
            to="/(tabs)/stock"
          />
          <Kpi
            row
            label="Expiring in 30 days"
            value={counts?.expiring}
            icon="time-outline"
            tint="tomato"
            to="/(tabs)/stock"
          />
          <Kpi
            row
            label="Owed to you"
            value={d ? formatINR(d.owed.customerDue) : counts?.customersOwing}
            note={`${counts?.customersOwing ?? '…'} customers`}
            icon="people-outline"
            tint="tomato"
            to="/(tabs)/khata"
          />
          <Kpi
            row
            label="You owe"
            value={d ? formatINR(d.owed.supplierPayable) : counts?.suppliersOwed}
            note={`${counts?.suppliersOwed ?? '…'} suppliers`}
            icon="business-outline"
            tint="blue"
            to="/suppliers"
          />
        </View>
      </View>
    </ScrollView>
  );
}
