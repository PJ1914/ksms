import Decimal from 'decimal.js';
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { getData, getPage, query } from '@/api/client';
import type { SalesSummary, SaleRow } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { useLoad } from '@/hooks/useLoad';
import { colors, workspace } from '@/theme/colors';
import { formatINR } from '@/utils/currency';
import { addDays } from '@/utils/period';
import { todayInIndia } from '@/utils/today';
import { MAX_FONT_SCALE, useLayout } from './ui';

const card = {
  minWidth: 0,
  padding: 16,
  borderRadius: workspace.radius,
  borderWidth: 1,
  borderColor: colors.border,
  backgroundColor: colors.surface,
} as const;

function Heading({ children, onPress }: { children: string; onPress?: () => void }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 }}>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{ fontSize: 15, fontWeight: '600', color: colors.text }}
      >
        {children}
      </Text>
      {onPress ? (
        <Pressable accessibilityRole="link" onPress={onPress}>
          <Text style={{ color: colors.primary, fontWeight: '700' }}>View all</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Desktop-only home panels: 7-day sales bars and the latest bills. Phones never render this. */
export function DesktopDashboard() {
  const { mode } = useLayout();
  const { can, branch } = useAuth();
  const today = todayInIndia();
  const from = addDays(today, -6);
  const showSales = can('report.sales') || can('report.financial');
  const trend = useLoad<SalesSummary | null>(
    () =>
      showSales
        ? getData<SalesSummary>(`/reports/sales/summary${query({ from, to: today })}`)
        : Promise.resolve(null),
    [today, branch?.id],
  );
  const bills = useLoad<SaleRow[]>(
    () =>
      can('sale.read')
        ? getPage<SaleRow>('/sales?pageSize=8').then((p) => p.data)
        : Promise.resolve([]),
    [branch?.id],
  );
  if (mode === 'phone') return null;

  const series = trend.data?.series ?? [];
  const max = series.reduce((m, s) => Decimal.max(m, s.billValue), new Decimal(0));
  return (
    <View style={{ gap: 16 }}>
      {can('sale.read') ? (
        <View style={card}>
          <Heading onPress={() => router.push('/(tabs)/billing')}>Recent bills</Heading>
          <View
            style={{
              flexDirection: 'row',
              backgroundColor: colors.surfaceMuted,
              paddingHorizontal: 8,
              paddingVertical: 7,
            }}
          >
            {['Bill', 'Customer', 'Amount'].map((label, index) => (
              <Text
                key={label}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={{
                  flex: 1,
                  textAlign: index === 2 ? 'right' : 'left',
                  color: colors.textMuted,
                  fontSize: workspace.caption,
                }}
              >
                {label}
              </Text>
            ))}
          </View>
          {(bills.data ?? []).map((b) => (
            <Pressable
              key={b.id}
              accessibilityRole="button"
              onPress={() => router.push({ pathname: '/sale/[id]', params: { id: b.id } })}
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                paddingHorizontal: 8,
                minHeight: workspace.control,
                alignItems: 'center',
                borderTopWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={{ flex: 1, color: colors.text, fontWeight: '500' }}
              >
                {b.saleNumber}
              </Text>
              <Text
                numberOfLines={1}
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={{ flex: 1, color: colors.textMuted }}
              >
                {b.customer?.name ?? 'Walk-in'}
              </Text>
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={{
                  flex: 1,
                  textAlign: 'right',
                  fontVariant: ['tabular-nums'],
                  color: colors.text,
                  fontWeight: '600',
                }}
              >
                {formatINR(b.total)}
              </Text>
            </Pressable>
          ))}
          {bills.data && !bills.data.length ? (
            <Text style={{ color: colors.textMuted }}>No bills yet.</Text>
          ) : null}
        </View>
      ) : null}
      {showSales ? (
        <View style={card}>
          <Heading onPress={() => router.push('/reports/sales')}>Sales, last 7 days</Heading>
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 10, height: 124 }}>
            {series.map((s) => {
              const pct = max.isZero() ? 0 : new Decimal(s.billValue).div(max).mul(100).toNumber();
              return (
                <View key={s.date} style={{ flex: 1, alignItems: 'center', gap: 6 }}>
                  <Text style={{ fontSize: 11, color: colors.textMuted }}>
                    {formatINR(s.billValue).replace('.00', '')}
                  </Text>
                  <View
                    style={{
                      width: '70%',
                      minHeight: 4,
                      height: Math.max(4, (pct / 100) * 80),
                      borderRadius: 6,
                      backgroundColor: colors.primary,
                    }}
                  />
                  <Text style={{ fontSize: 11, color: colors.textMuted }}>{s.date.slice(5)}</Text>
                </View>
              );
            })}
            {!series.length ? (
              <Text style={{ color: colors.textMuted }}>No sales in the last 7 days.</Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </View>
  );
}
