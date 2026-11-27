import '@/theme/font';
import { router, Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { illustrations } from '@/theme/art';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { CartProvider } from '@/cart/CartProvider';
import { SlowServerNotice } from '@/components/SlowServerNotice';
import { API_URL } from '@/config';
import { draftScopeKey } from '@/sync/cache-store';
import { SyncProvider } from '@/sync/SyncProvider';
import { colors } from '@/theme/colors';
import { WorkspaceButton } from '@/components/WorkspaceButton';
import { MAX_FONT_SCALE, useLayout } from '@/components/ui';
import { DesktopShell } from '@/components/DesktopShell';

export default function RootLayout() {
  return (
    <AuthProvider>
      <SyncProvider>
        <StatusBar style="dark" />
        <RootStack />
        <SlowServerNotice />
      </SyncProvider>
    </AuthProvider>
  );
}

/** Every screen outside the five tabs shows a header with a back arrow; screens set their own title. */
const SCREEN_OPTIONS = {
  headerShown: true,
  headerTintColor: colors.text,
  headerTitleStyle: { color: colors.text, fontWeight: '800' as const, fontSize: 18 },
  headerStyle: { backgroundColor: colors.background },
  headerShadowVisible: false,
  headerBackTitle: 'Back',
  contentStyle: { backgroundColor: colors.background },
};

function RootStack() {
  const { mode } = useLayout();
  const desktopPicker =
    mode === 'desktop'
      ? {
          presentation: 'transparentModal' as const,
          headerShown: false,
          contentStyle: { backgroundColor: colors.scrim },
        }
      : {};
  const { status, retry, profile, branch } = useAuth();

  if (status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }
  if (status === 'offline') {
    return (
      <View style={styles.center}>
        <Image
          source={illustrations.offline}
          style={{ width: 200, height: 200 }}
          resizeMode="contain"
        />
        <Text style={styles.title}>Cannot reach the server</Text>
        <Text style={styles.note}>
          Check the API is running on the PC and this phone is on the same Wi-Fi.
        </Text>
        <Text style={styles.note}>{API_URL}</Text>
        <Pressable style={styles.button} onPress={retry}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const signedIn = status === 'signedIn';
  const scopeKey =
    profile && branch ? draftScopeKey(profile.organization.id, profile.user.id, branch.id) : null;
  return (
    // a new cart for every sign-in and branch: an unfinished bill never crosses users or branches
    <CartProvider
      key={`${profile?.organization.id ?? 'no-org'}:${profile?.user.id ?? 'signed-out'}:${branch?.id ?? 'no-branch'}`}
      scopeKey={scopeKey}
    >
      <DesktopShell>
        <Stack
          screenOptions={{ headerShown: false }}
          screenLayout={({ route, children }) => {
            if (
              mode !== 'desktop' ||
              (route.name !== 'sale/add-item' && route.name !== 'sale/customer')
            )
              return <>{children}</>;
            return (
              <View
                accessibilityViewIsModal
                style={{
                  alignSelf: 'flex-end',
                  width: '64%',
                  maxWidth: 720,
                  flex: 1,
                  backgroundColor: colors.background,
                }}
              >
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    paddingHorizontal: 20,
                    paddingVertical: 6,
                    backgroundColor: colors.surface,
                  }}
                >
                  <Text
                    maxFontSizeMultiplier={MAX_FONT_SCALE}
                    accessibilityRole="header"
                    style={{ fontWeight: '700', fontSize: 18, color: colors.text }}
                  >
                    {route.name === 'sale/add-item' ? 'Add items' : 'Choose customer'}
                  </Text>
                  <WorkspaceButton
                    compact
                    label="Close picker"
                    icon="close"
                    onPress={() =>
                      router.canGoBack() ? router.back() : router.replace('/sale/new')
                    }
                  />
                </View>
                {children}
              </View>
            );
          }}
        >
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen
              name="sync"
              options={{ ...SCREEN_OPTIONS, title: 'Sync & offline cache' }}
            />
            <Stack.Screen
              name="notifications"
              options={{ ...SCREEN_OPTIONS, title: 'Notifications' }}
            />
            <Stack.Screen
              name="product-edit"
              options={{ ...SCREEN_OPTIONS, title: 'Edit product' }}
            />
            <Stack.Screen name="categories" options={{ ...SCREEN_OPTIONS, title: 'Categories' }} />
            <Stack.Screen
              name="product-new"
              options={{ ...SCREEN_OPTIONS, title: 'Add product', presentation: 'modal' }}
            />
            <Stack.Screen name="product/[id]" options={{ ...SCREEN_OPTIONS, title: 'Product' }} />
            <Stack.Screen
              name="stock-adjust"
              options={{ ...SCREEN_OPTIONS, title: 'Change stock' }}
            />
            <Stack.Screen name="sale/new" options={{ ...SCREEN_OPTIONS, title: 'New bill' }} />
            <Stack.Screen
              name="sale/add-item"
              options={{ ...SCREEN_OPTIONS, ...desktopPicker, title: 'Add items' }}
            />
            <Stack.Screen
              name="sale/scan"
              options={{ ...SCREEN_OPTIONS, title: 'Scan barcodes' }}
            />
            <Stack.Screen
              name="sale/customer"
              options={{ ...SCREEN_OPTIONS, ...desktopPicker, title: 'Customer' }}
            />
            <Stack.Screen name="sale/[id]" options={{ ...SCREEN_OPTIONS, title: 'Bill' }} />
            <Stack.Screen
              name="sale/return"
              options={{ ...SCREEN_OPTIONS, title: 'Return goods' }}
            />
            <Stack.Screen name="held-bills" options={{ ...SCREEN_OPTIONS, title: 'Held bills' }} />
            <Stack.Screen
              name="customer-new"
              options={{ ...SCREEN_OPTIONS, title: 'Add customer', presentation: 'modal' }}
            />
            <Stack.Screen name="customer/[id]" options={{ ...SCREEN_OPTIONS, title: 'Customer' }} />
            <Stack.Screen
              name="customer/pay"
              options={{ ...SCREEN_OPTIONS, title: 'Collect payment' }}
            />
            <Stack.Screen
              name="customer/adjust"
              options={{ ...SCREEN_OPTIONS, title: 'Add khata entry' }}
            />
            <Stack.Screen
              name="collections"
              options={{ ...SCREEN_OPTIONS, title: 'Collections' }}
            />
            <Stack.Screen
              name="collection-agents"
              options={{ ...SCREEN_OPTIONS, title: 'Collection agents' }}
            />
            <Stack.Screen name="expenses" options={{ ...SCREEN_OPTIONS, title: 'Expenses' }} />
            <Stack.Screen name="cashbook" options={{ ...SCREEN_OPTIONS, title: 'Cashbook' }} />
            <Stack.Screen
              name="daily-closing"
              options={{ ...SCREEN_OPTIONS, title: 'Daily closing' }}
            />
            <Stack.Screen
              name="gst-settings"
              options={{ ...SCREEN_OPTIONS, title: 'GST & billing settings' }}
            />
            <Stack.Screen name="suppliers" options={{ ...SCREEN_OPTIONS, title: 'Suppliers' }} />
            <Stack.Screen
              name="supplier-new"
              options={{ ...SCREEN_OPTIONS, title: 'Add supplier', presentation: 'modal' }}
            />
            <Stack.Screen name="supplier/[id]" options={{ ...SCREEN_OPTIONS, title: 'Supplier' }} />
            <Stack.Screen
              name="supplier/pay"
              options={{ ...SCREEN_OPTIONS, title: 'Pay supplier' }}
            />
            <Stack.Screen name="purchases" options={{ ...SCREEN_OPTIONS, title: 'Purchases' }} />
            <Stack.Screen
              name="purchase/new"
              options={{ ...SCREEN_OPTIONS, title: 'New purchase' }}
            />
            <Stack.Screen name="purchase/[id]" options={{ ...SCREEN_OPTIONS, title: 'Purchase' }} />
            <Stack.Screen
              name="purchase/return"
              options={{ ...SCREEN_OPTIONS, title: 'Send goods back' }}
            />
            <Stack.Screen name="reports/index" options={{ ...SCREEN_OPTIONS, title: 'Reports' }} />
            <Stack.Screen
              name="reports/sales"
              options={{ ...SCREEN_OPTIONS, title: 'Sales report' }}
            />
            <Stack.Screen
              name="reports/profit"
              options={{ ...SCREEN_OPTIONS, title: 'Profit and expenses' }}
            />
            <Stack.Screen name="reports/cash" options={{ ...SCREEN_OPTIONS, title: 'Cash flow' }} />
            <Stack.Screen
              name="reports/dues"
              options={{ ...SCREEN_OPTIONS, title: 'Money owed' }}
            />
            <Stack.Screen
              name="reports/collections"
              options={{ ...SCREEN_OPTIONS, title: 'Collections report' }}
            />
            <Stack.Screen
              name="reports/day-book"
              options={{ ...SCREEN_OPTIONS, title: 'Day book' }}
            />
            <Stack.Screen
              name="reports/purchases"
              options={{ ...SCREEN_OPTIONS, title: 'Purchases report' }}
            />
            <Stack.Screen
              name="reports/stock"
              options={{ ...SCREEN_OPTIONS, title: 'Stock report' }}
            />
          </Stack.Protected>
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="login" />
          </Stack.Protected>
        </Stack>
      </DesktopShell>
    </CartProvider>
  );
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.background,
  },
  title: { fontSize: 22, fontWeight: '800', color: colors.text, marginTop: 8 },
  note: {
    marginTop: 8,
    fontSize: 14,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  button: {
    marginTop: 24,
    backgroundColor: colors.primary,
    paddingHorizontal: 32,
    minHeight: 54,
    justifyContent: 'center',
    borderRadius: 14,
  },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
