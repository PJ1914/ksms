import { router } from 'expo-router';
import { useState } from 'react';
import { Image, type ImageSourcePropType, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/auth/AuthProvider';
import {
  Choice,
  Screen,
  SectionTitle,
  TabHeader,
  MAX_FONT_SCALE,
  useLayout,
} from '@/components/ui';
import { getData } from '@/api/client';
import { useLoad } from '@/hooks/useLoad';
import { useSync } from '@/sync/SyncProvider';
import { icons, illustrations } from '@/theme/art';
import { colors, radius, shadow, tints, type Tint } from '@/theme/colors';

interface Item {
  title: string;
  art: ImageSourcePropType;
  href: Parameters<typeof router.push>[0];
  badge?: number;
  show: boolean;
}

/** Everything that is not a main tab, as picture tiles grouped by job. Hidden when the role can't use it. */
export default function MoreScreen() {
  const { profile, branch, switchBranch, signOut, can } = useAuth();
  const { stats } = useSync();
  const [busy, setBusy] = useState(false);
  const layout = useLayout();
  const tileW = layout.tileWidth(layout.columns(100, 3, 6));
  const unread = useLoad(
    () =>
      getData<{ unreadCount: number }>('/notifications/unread-count')
        .then((r) => r.unreadCount)
        .catch(() => 0),
    [branch?.id],
  );

  const anyReport =
    can('report.sales') ||
    can('report.financial') ||
    can('report.profit') ||
    can('report.purchases') ||
    can('report.inventory');

  const groups: { title: string; tint: Tint; items: Item[] }[] = [
    {
      title: 'Buying',
      tint: 'mango',
      items: [
        {
          title: 'Suppliers',
          art: icons.addSupplier,
          href: '/suppliers',
          show: can('supplier.read'),
        },
        {
          title: 'Purchases',
          art: icons.repPurchases,
          href: '/purchases',
          show: can('purchase.read'),
        },
        { title: 'Held bills', art: icons.hold, href: '/held-bills', show: can('sale.create') },
      ],
    },
    {
      title: 'Khata & collections',
      tint: 'tomato',
      items: [
        {
          title: 'Collections',
          art: icons.payReceived,
          href: '/collections',
          show: can('collection.read'),
        },
        {
          title: 'Agents',
          art: icons.roleAgent,
          href: '/collection-agents',
          show: can('collection.read'),
        },
        { title: 'Reports', art: icons.repSales, href: '/reports', show: anyReport },
      ],
    },
    {
      title: 'Money',
      tint: 'green',
      items: [
        { title: 'Expenses', art: icons.expenses, href: '/expenses', show: can('expense.read') },
        { title: 'Cashbook', art: icons.cashbook, href: '/cashbook', show: can('cashbook.read') },
        {
          title: 'Day closing',
          art: icons.repDayBook,
          href: '/daily-closing',
          show: can('cashbook.read') || can('closing.manage'),
        },
      ],
    },
    {
      title: 'Shop',
      tint: 'blue',
      items: [
        {
          title: 'Shop & bill details',
          art: icons.gstInvoice,
          href: '/gst-settings',
          show: can('organization.read'),
        },
        {
          title: 'Categories',
          art: icons.categories,
          href: '/categories',
          show: can('category.manage'),
        },
        {
          title: 'Alerts',
          art: icons.notification,
          href: '/notifications',
          badge: unread.data ?? 0,
          show: true,
        },
        {
          title: 'Sync',
          art: illustrations.sync,
          href: '/sync',
          badge: stats.failedOutbox + stats.pendingOutbox,
          show: true,
        },
      ],
    },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <TabHeader title="More" />
      <Screen>
        <View style={styles.profile}>
          <Image source={icons.roleOwner} style={styles.profileArt} resizeMode="contain" />
          <View style={{ flex: 1 }}>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.name} numberOfLines={1}>
              {profile?.user.fullName}
            </Text>
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.meta} numberOfLines={2}>
              {profile?.role.name} · {profile?.organization.name}
              {branch ? ` · ${branch.name}` : ''}
            </Text>
            {profile?.user.phone ? (
              <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.meta}>
                {profile.user.phone}
              </Text>
            ) : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            disabled={busy}
            onPress={() => {
              setBusy(true);
              void signOut();
            }}
            style={({ pressed }) => [styles.signOut, (pressed || busy) && { opacity: 0.7 }]}
          >
            <Ionicons name="log-out-outline" size={22} color={colors.onPrimary} />
          </Pressable>
        </View>

        {(profile?.branches.length ?? 0) > 1 ? (
          <Choice
            label="Working in branch"
            options={profile!.branches.map((b) => ({ key: b.id, label: b.name }))}
            value={branch?.id ?? ''}
            onChange={switchBranch}
          />
        ) : null}

        {groups.map((g) => {
          const items = g.items.filter((i) => i.show);
          if (!items.length) return null;
          return (
            <View key={g.title}>
              <SectionTitle>{g.title}</SectionTitle>
              <View style={styles.grid}>
                {items.map((i) => (
                  <Pressable
                    key={i.title}
                    accessibilityRole="button"
                    accessibilityLabel={i.badge ? `${i.title}, ${i.badge} new` : i.title}
                    onPress={() => router.push(i.href)}
                    style={({ pressed }) => [
                      styles.tile,
                      { width: tileW },
                      pressed && { opacity: 0.8 },
                    ]}
                  >
                    <View style={[styles.tileArt, { backgroundColor: tints[g.tint].bg }]}>
                      <Image
                        source={i.art}
                        style={{ width: 40, height: 40 }}
                        resizeMode="contain"
                      />
                    </View>
                    <Text
                      maxFontSizeMultiplier={MAX_FONT_SCALE}
                      style={styles.tileText}
                      numberOfLines={2}
                    >
                      {i.title}
                    </Text>
                    {i.badge ? (
                      <View style={styles.badge}>
                        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.badgeText}>
                          {i.badge > 99 ? '99+' : i.badge}
                        </Text>
                      </View>
                    ) : null}
                  </Pressable>
                ))}
              </View>
            </View>
          );
        })}
      </Screen>
    </View>
  );
}

const styles = StyleSheet.create({
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.primary,
    borderRadius: radius.xl,
    padding: 16,
    marginBottom: 4,
  },
  profileArt: { width: 56, height: 56 },
  name: { fontSize: 18, fontWeight: '800', color: colors.onPrimary },
  meta: { fontSize: 13, color: colors.onPrimaryMuted, marginTop: 2 },
  signOut: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#17633D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 12,
    gap: 8,
    minHeight: 112,
    ...shadow.card,
    shadowOpacity: 0.04,
  },
  tileArt: {
    width: 52,
    height: 52,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileText: { fontSize: 13, fontWeight: '700', color: colors.text },
  badge: {
    position: 'absolute',
    top: 10,
    right: 10,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: '#E4572E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
