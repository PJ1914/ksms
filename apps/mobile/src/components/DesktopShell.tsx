import { appIcon } from '@/theme/art';
import { router, usePathname, type Href } from 'expo-router';
import { useState } from 'react';
import { Image, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/auth/AuthProvider';
import { useShortcut } from '@/hooks/useShortcut';
import { colors, workspace } from '@/theme/colors';
import { MAX_FONT_SCALE, NavigationWidth, useLayout } from './ui';
import { SIDEBAR_WIDTH, RAIL_WIDTH } from './layout';
import { WorkspaceButton } from './WorkspaceButton';
import { SyncBanner } from './SyncBanner';
import { CommandSearch } from './CommandSearch';

type Icon = React.ComponentProps<typeof WorkspaceButton>['icon'];
type Entry = [string, Icon, Href, RegExp, ...string[]];
const groups: [string, Entry[]][] = [
  ['Workspace', [['Overview', 'home-outline', '/(tabs)', /^\/$/]]],
  [
    'Sales',
    [
      ['New bill', 'add', '/sale/new', /^\/sale\/(new|add-item|customer|scan)$/, 'sale.create'],
      ['Held bills', 'pause-circle-outline', '/held-bills', /^\/held-bills$/, 'sale.create'],
      [
        'Sales',
        'receipt-outline',
        '/(tabs)/billing',
        /^\/(billing$|sale\/(?!new$|add-item$|customer$|scan$))/,
        'sale.read',
      ],
    ],
  ],
  [
    'Relationships',
    [
      [
        'Customers',
        'people-outline',
        '/(tabs)/khata',
        /^\/(khata|customer|collections)/,
        'customer.read',
      ],
      ['Products', 'cube-outline', '/(tabs)/stock', /^\/(stock|product)/, 'stock.read'],
      ['Suppliers', 'business-outline', '/suppliers', /^\/(supplier|purchase)/, 'supplier.read'],
      [
        'Money',
        'wallet-outline',
        '/cashbook',
        /^\/(cashbook|expenses|daily-closing)/,
        'cashbook.read',
      ],
    ],
  ],
  [
    'Insights',
    [
      [
        'Reports',
        'bar-chart-outline',
        '/reports',
        /^\/reports/,
        'report.sales',
        'report.profit',
        'report.financial',
        'report.inventory',
        'report.purchases',
      ],
      [
        'More',
        'grid-outline',
        '/(tabs)/more',
        /^\/(more|categories|gst-settings|sync|notifications|collection-agents|stock-adjust)/,
      ],
    ],
  ],
];

function Sidebar({
  compact,
  toggle,
  adjust,
}: {
  compact: boolean;
  toggle?: () => void;
  adjust: () => void;
}) {
  const path = usePathname();
  const { can } = useAuth();
  return (
    <ScrollView
      style={{
        width: compact ? RAIL_WIDTH : SIDEBAR_WIDTH,
        flexGrow: 0,
        backgroundColor: colors.surfaceMuted,
        borderRightWidth: 1,
        borderColor: colors.border,
      }}
      contentContainerStyle={{ padding: compact ? 8 : 14, gap: 2, flexGrow: 1 }}
    >
      {toggle ? (
        <WorkspaceButton
          compact={compact}
          label={compact ? 'Expand navigation' : 'Collapse navigation'}
          icon="menu"
          onPress={toggle}
        />
      ) : (
        <View
          style={{
            flexDirection: 'row',
            gap: 9,
            alignItems: 'center',
            padding: 8,
            marginBottom: 18,
          }}
        >
          <Image
            source={appIcon}
            style={{ width: 30, height: 30, borderRadius: workspace.radius }}
          />
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}
          >
            Yapaaram
          </Text>
        </View>
      )}
      {groups.map(([title, entries], groupIndex) => {
        const visible = entries.filter(
          ([, , , , ...permissions]) => !permissions.length || permissions.some(can),
        );
        if (!visible.length) return null;
        return (
          <View key={groupIndex} style={{ marginTop: groupIndex ? 10 : 0, gap: 2 }}>
            {!!title && !compact && (
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={{
                  color: colors.textMuted,
                  fontSize: workspace.caption,
                  fontWeight: '600',
                  paddingHorizontal: 14,
                  paddingVertical: 8,
                }}
              >
                {title}
              </Text>
            )}
            {visible.map(([label, icon, href, match]) => (
              <WorkspaceButton
                key={label}
                label={label}
                icon={icon}
                compact={compact}
                active={match.test(path)}
                primary={href === '/sale/new'}
                onPress={() => (href === '/stock-adjust' ? adjust() : router.navigate(href))}
              />
            ))}
          </View>
        );
      })}
    </ScrollView>
  );
}

function TopBar({
  search,
  menu,
  toggle,
}: {
  search: () => void;
  menu: boolean;
  toggle: () => void;
}) {
  const { branch, profile, signOut } = useAuth();
  return (
    <View
      style={{
        backgroundColor: colors.surface,
        borderBottomWidth: 1,
        borderColor: colors.border,
        paddingHorizontal: 12,
      }}
    >
      <View style={{ minHeight: 56, flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <WorkspaceButton label="Search (Ctrl+K)" icon="search-outline" onPress={search} />
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          numberOfLines={1}
          style={{ flex: 1, color: colors.text, fontWeight: '600', fontSize: workspace.body }}
        >
          {branch?.name}
        </Text>
        <View style={{ flexShrink: 1, maxWidth: 220 }}>
          <SyncBanner inTopBar />
        </View>
        <WorkspaceButton
          compact
          label="Notifications"
          icon="notifications-outline"
          onPress={() => router.navigate('/notifications')}
        />
        <WorkspaceButton
          compact
          label={'Account menu for ' + profile?.user.fullName}
          icon="person-circle-outline"
          onPress={toggle}
        />
      </View>
      {menu && (
        <View style={{ alignSelf: 'flex-end', paddingBottom: 8 }}>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={{ color: colors.text }}>
            {profile?.user.fullName}
          </Text>
          <WorkspaceButton label="Sign out" icon="log-out-outline" onPress={() => void signOut()} />
        </View>
      )}
    </View>
  );
}

export function DesktopShell({ children }: { children: React.ReactNode }) {
  const { mode } = useLayout();
  const insets = useSafeAreaInsets();
  const { status, can } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch] = useState<'all' | 'adjust' | null>(null);
  const [menu, setMenu] = useState(false);
  const wide = mode !== 'phone' && status === 'signedIn';
  const compact = mode === 'tablet' && !expanded;
  const path = usePathname();
  useShortcut(
    'Ctrl+k',
    wide
      ? () => {
          setMenu(false);
          setSearch('all');
        }
      : undefined,
  );
  useShortcut(
    'Ctrl+n',
    wide && !search && can('sale.create') ? () => router.navigate('/sale/new') : undefined,
  );
  const inPicker = mode === 'desktop' && ['/sale/add-item', '/sale/customer'].includes(path);
  useShortcut(
    'Escape',
    wide && (search || menu || inPicker)
      ? () => {
          if (search) setSearch(null);
          else if (menu) setMenu(false);
          else if (router.canGoBack()) router.back();
        }
      : undefined,
  );
  return (
    <NavigationWidth.Provider value={wide ? (compact ? RAIL_WIDTH : SIDEBAR_WIDTH) : 0}>
      <View
        style={{
          flex: 1,
          flexDirection: 'row',
          paddingTop: wide ? insets.top : 0,
          backgroundColor: colors.background,
        }}
      >
        {wide && (
          <Sidebar
            compact={compact}
            toggle={mode === 'tablet' ? () => setExpanded(!expanded) : undefined}
            adjust={() => setSearch('adjust')}
          />
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          {wide && (
            <TopBar search={() => setSearch('all')} menu={menu} toggle={() => setMenu(!menu)} />
          )}
          {children}
        </View>
        {wide && search && (
          <CommandSearch
            key={search}
            adjust={search === 'adjust'}
            onClose={() => setSearch(null)}
          />
        )}
      </View>
    </NavigationWidth.Provider>
  );
}
