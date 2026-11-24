import { useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { illustrations } from '@/theme/art';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '@ksms/api-client';
import { normalizeIndianPhone } from '@ksms/validation';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Choice, ErrorText, Field } from '@/components/ui';
import { colors } from '@/theme/colors';
import { friendlyError } from '@/utils/errors';

type Mode = 'signIn' | 'register';
interface ShopChoice {
  id: string;
  name: string;
}

export default function LoginScreen() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>('signIn');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [shopName, setShopName] = useState('');
  const [shops, setShops] = useState<ShopChoice[]>([]);
  const [organizationId, setOrganizationId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const registering = mode === 'register';

  function check(): string | null {
    if (!normalizeIndianPhone(phone)) return 'Enter a valid 10-digit mobile number.';
    if (registering) {
      if (fullName.trim().length < 2) return 'Enter your name.';
      if (shopName.trim().length < 2) return 'Enter the shop name.';
      if (password.length < 8) return 'Password must be at least 8 characters.';
    } else if (!password) {
      return 'Enter your password.';
    }
    return null;
  }

  async function submit() {
    const problem = check();
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      if (registering) await auth.register({ fullName, phone, password, shopName });
      else await auth.signIn(phone, password, organizationId);
      // On success the root layout switches to the tabs automatically.
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ORGANIZATION_REQUIRED') {
        const list = (e.details as { organizations?: ShopChoice[] } | undefined)?.organizations;
        const first = list?.[0];
        if (list && first) {
          setShops(list);
          setOrganizationId(first.id);
          setError('Choose which shop to sign in to, then tap Sign in.');
          return;
        }
      }
      setError(
        e instanceof ApiError && e.code === 'CONFLICT'
          ? 'This mobile number already has an account. Sign in instead.'
          : friendlyError(e),
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <Image
              source={illustrations.shopfront}
              style={styles.heroArt}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
            <Text style={styles.brand}>
              {registering ? 'Set up your shop' : 'Your shop, in your pocket'}
            </Text>
            <Text style={styles.subtitle}>
              {registering
                ? 'Takes a minute. You can add products and customers after.'
                : 'Billing, stock and khata — even when the internet is down.'}
            </Text>
          </View>

          <View style={styles.form}>
            {registering && (
              <>
                <Field
                  label="Your name"
                  value={fullName}
                  onChangeText={setFullName}
                  autoCapitalize="words"
                />
                <Field
                  label="Shop name"
                  value={shopName}
                  onChangeText={setShopName}
                  autoCapitalize="words"
                />
              </>
            )}
            <Field
              label="Mobile number"
              value={phone}
              onChangeText={(v) => {
                setPhone(v);
                setShops([]);
                setOrganizationId(undefined);
              }}
              keyboardType="phone-pad"
              autoComplete="tel"
              placeholder="10-digit mobile number"
              maxLength={14}
            />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete={registering ? 'new-password' : 'current-password'}
              placeholder={registering ? 'At least 8 characters' : undefined}
              onSubmitEditing={submit}
            />
            {!registering && shops.length > 0 && (
              <Choice
                label="Choose shop"
                options={shops.map((s) => ({ key: s.id, label: s.name }))}
                value={organizationId ?? shops[0]?.id ?? ''}
                onChange={setOrganizationId}
              />
            )}
            <ErrorText message={error} />
            <Button
              title={registering ? 'Create shop' : 'Sign in'}
              icon={registering ? 'storefront-outline' : 'arrow-forward'}
              onPress={submit}
              busy={busy}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMode(registering ? 'signIn' : 'register');
                setShops([]);
                setOrganizationId(undefined);
                setError(null);
              }}
              style={styles.switch}
            >
              <Text style={styles.switchText}>
                {registering ? 'I already have an account' : 'New here? Create your shop'}
              </Text>
            </Pressable>
          </View>
          <View style={styles.trust}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.textMuted} />
            <Text style={styles.trustText}>Your data is backed up safely</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, paddingBottom: 24 },
  hero: {
    backgroundColor: colors.primarySoft,
    borderBottomLeftRadius: 40,
    borderBottomRightRadius: 40,
    alignItems: 'center',
    paddingTop: 24,
    paddingBottom: 24,
    paddingHorizontal: 24,
  },
  heroArt: { width: 260, height: 190 },
  brand: {
    fontSize: 26,
    fontWeight: '800',
    color: colors.text,
    textAlign: 'center',
    marginTop: 8,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 14,
    color: '#3D4C43',
    textAlign: 'center',
    marginTop: 6,
    lineHeight: 20,
  },
  form: {
    paddingHorizontal: 20,
    paddingTop: 24,
    width: '100%',
    maxWidth: 480,
    alignSelf: 'center',
  },
  switch: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  switchText: { fontSize: 15, fontWeight: '700', color: colors.primary },
  trust: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
  },
  trustText: { fontSize: 12, color: colors.textMuted },
});
