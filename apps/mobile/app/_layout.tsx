import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { CartProvider } from '@/cart/CartProvider';
import { colors } from '@/theme/colors';

export default function RootLayout() {
  return (
    <AuthProvider>
      <StatusBar style="dark" />
      <RootStack />
    </AuthProvider>
  );
}

/** Every screen outside the five tabs shows a header with a back arrow; screens set their own title. */
const SCREEN_OPTIONS = {
  headerShown: true,
  headerTintColor: colors.primary,
  headerTitleStyle: { color: colors.text, fontWeight: '600' as const },
  headerStyle: { backgroundColor: colors.surface },
  headerBackTitle: 'Back',
};

function RootStack() {
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
        <Text style={styles.title}>Cannot reach the server</Text>
        <Text style={styles.note}>
          Check the API is running on the PC and this phone is on the same Wi-Fi.
        </Text>
        <Pressable style={styles.button} onPress={retry}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  const signedIn = status === 'signedIn';
  return (
    // a new cart for every sign-in and branch: an unfinished bill never crosses users or branches
    <CartProvider key={`${profile?.user.id ?? 'signed-out'}:${branch?.id ?? 'no-branch'}`}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(tabs)" />
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
          <Stack.Screen name="sale/add-item" options={{ ...SCREEN_OPTIONS, title: 'Add items' }} />
          <Stack.Screen name="sale/scan" options={{ ...SCREEN_OPTIONS, title: 'Scan barcodes' }} />
          <Stack.Screen name="sale/customer" options={{ ...SCREEN_OPTIONS, title: 'Customer' }} />
          <Stack.Screen name="sale/[id]" options={{ ...SCREEN_OPTIONS, title: 'Bill' }} />
          <Stack.Screen name="sale/return" options={{ ...SCREEN_OPTIONS, title: 'Return goods' }} />
          <Stack.Screen name="held-bills" options={{ ...SCREEN_OPTIONS, title: 'Held bills' }} />
          <Stack.Screen
            name="customer-new"
            options={{ ...SCREEN_OPTIONS, title: 'Add customer', presentation: 'modal' }}
          />
          <Stack.Screen name="customer/[id]" options={{ ...SCREEN_OPTIONS, title: 'Customer' }} />
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
        </Stack.Protected>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="login" />
        </Stack.Protected>
      </Stack>
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
  title: { fontSize: 20, fontWeight: '600', color: colors.text },
  note: { marginTop: 8, fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  button: {
    marginTop: 20,
    backgroundColor: colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
