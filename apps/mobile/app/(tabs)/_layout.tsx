import { router, Tabs } from 'expo-router';
import { MAX_FONT_SCALE } from '@/components/ui';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/auth/AuthProvider';
import { colors, shadow } from '@/theme/colors';
import { useLayout } from '@/components/ui';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

const TABS: { name: string; title: string; icon: IconName; active: IconName }[] = [
  { name: 'index', title: 'Home', icon: 'home-outline', active: 'home' },
  { name: 'stock', title: 'Stock', icon: 'cube-outline', active: 'cube' },
  { name: 'billing', title: 'New bill', icon: 'add', active: 'add' },
  { name: 'khata', title: 'Khata', icon: 'book-outline', active: 'book' },
  { name: 'more', title: 'More', icon: 'grid-outline', active: 'grid' },
];

/**
 * Five tabs with a raised "New bill" button in the middle. The middle tab opens a new bill straight
 * away for roles that can bill; for others it shows the Billing tab (today's bills).
 */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  const { can } = useAuth();
  const layout = useLayout();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // the tab bar would otherwise ride up on top of the keyboard
        tabBarHideOnKeyboard: true,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
        tabBarStyle: [
          styles.bar,
          layout.mode !== 'phone' && styles.desktopHidden,
          { height: 68 + insets.bottom, paddingBottom: Math.max(insets.bottom, 10) },
        ],
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      {TABS.map((t) =>
        t.name === 'billing' ? (
          <Tabs.Screen
            key={t.name}
            name={t.name}
            options={{
              title: t.title,
              tabBarButton: (props) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="New bill"
                  onPress={(e) => {
                    if (can('sale.create')) router.push('/sale/new');
                    else props.onPress?.(e);
                  }}
                  style={styles.centerWrap}
                >
                  <View style={styles.centerBtn}>
                    <Ionicons name="add" size={30} color={colors.onPrimary} />
                  </View>
                  <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.centerLabel}>
                    New bill
                  </Text>
                </Pressable>
              ),
            }}
          />
        ) : (
          <Tabs.Screen
            key={t.name}
            name={t.name}
            options={{
              title: t.title,
              tabBarIcon: ({ color, focused }) => (
                <Ionicons
                  name={focused ? t.active : t.icon}
                  color={typeof color === 'string' ? color : colors.textMuted}
                  size={24}
                />
              ),
            }}
          />
        ),
      )}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopWidth: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    ...shadow.card,
    shadowOffset: { width: 0, height: -4 },
  },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'flex-start' },
  centerBtn: {
    marginTop: -26,
    width: 60,
    height: 60,
    borderRadius: 20,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.raised,
  },
  centerLabel: { fontSize: 11, fontWeight: '700', color: colors.primary, marginTop: 4 },
  desktopHidden: { display: 'none' },
});
