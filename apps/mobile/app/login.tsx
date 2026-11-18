import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
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
          <Text style={styles.brand}>KSMS</Text>
          <Text style={styles.subtitle}>
            {registering ? 'Create your shop' : 'Sign in to your shop'}
          </Text>

          <View style={styles.card}>
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
            <Button title={registering ? 'Create shop' : 'Sign in'} onPress={submit} busy={busy} />
          </View>

          <Button
            variant="secondary"
            title={registering ? 'I already have an account' : 'New here? Create your shop'}
            onPress={() => {
              setMode(registering ? 'signIn' : 'register');
              setShops([]);
              setOrganizationId(undefined);
              setError(null);
            }}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  container: { flexGrow: 1, justifyContent: 'center', padding: 24 },
  brand: { fontSize: 32, fontWeight: '700', color: colors.primary, textAlign: 'center' },
  subtitle: {
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'center',
    marginTop: 4,
    marginBottom: 24,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
