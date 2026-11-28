import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { illustrations, loginHero } from '@/theme/art';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '@ksms/api-client';
import { useAuth } from '@/auth/AuthProvider';
import { Select } from '@/components/Select';
import { Button, Choice, ErrorText, Field } from '@/components/ui';
import { colors } from '@/theme/colors';
import { passwordChecks, passwordOk, phoneDigits, phoneProblem } from '@/utils/auth-rules';
import { friendlyError } from '@/utils/errors';
import * as SecureStore from '@/auth/secure-store';
import { useLayout } from '@/components/ui';

const REMEMBER_LOGIN_KEY = 'ksms.rememberedLogin';

type Mode = 'signIn' | 'register' | 'join';
const SHOP_TYPES = [
  { key: 'KIRANA', label: 'Kirana store' },
  { key: 'GENERAL_STORE', label: 'General store' },
  { key: 'MEDICAL', label: 'Medical shop' },
  { key: 'OTHER', label: 'Other' },
] as const;

interface ShopChoice {
  id: string;
  name: string;
}

export default function LoginScreen() {
  const auth = useAuth();
  const layout = useLayout();
  const desktop = layout.mode !== 'phone';
  const [mode, setMode] = useState<Mode>('signIn');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [shopName, setShopName] = useState('');
  const [shopType, setShopType] = useState<string>('KIRANA');
  const [confirm, setConfirm] = useState('');
  const [taken, setTaken] = useState(false);
  const [code, setCode] = useState('');
  const [shops, setShops] = useState<ShopChoice[]>([]);
  const [organizationId, setOrganizationId] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rememberLogin, setRememberLogin] = useState(false);

  useEffect(() => {
    void SecureStore.getItemAsync(REMEMBER_LOGIN_KEY).then((stored) => {
      if (!stored) return;
      try {
        const saved = JSON.parse(stored) as { phone?: string; password?: string };
        if (saved.phone && saved.password) {
          setPhone(saved.phone);
          setPassword(saved.password);
          setRememberLogin(true);
        }
      } catch {
        void SecureStore.deleteItemAsync(REMEMBER_LOGIN_KEY);
      }
    });
  }, []);

  const registering = mode === 'register';
  const joining = mode === 'join';

  function check(): string | null {
    if (joining) {
      if (code.replace(/[^a-zA-Z0-9]/g, '').length < 8)
        return 'Enter the invitation code the owner gave you.';
      if (fullName.trim().length < 2) return 'Enter your name.';
      if (password.length < 8) return 'Password must be at least 8 characters.';
      return null;
    }
    if (phone.length !== 10 || phoneProblem(phone))
      return phoneProblem(phone) ?? 'Enter your 10-digit mobile number.';
    if (registering) {
      if (fullName.trim().length < 2) return 'Enter your name.';
      if (shopName.trim().length < 2) return 'Enter the shop name.';
      if (!passwordOk(password, phone)) return 'Choose a stronger password (see the checklist).';
      if (confirm !== password) return 'The two passwords do not match.';
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
      if (joining) await auth.join({ code, fullName, password });
      else if (registering)
        await auth.register({ fullName, phone, password, shopName, businessType: shopType });
      else {
        await auth.signIn(phone, password, organizationId);
        if (rememberLogin) {
          await SecureStore.setItemAsync(REMEMBER_LOGIN_KEY, JSON.stringify({ phone, password }));
        } else {
          await SecureStore.deleteItemAsync(REMEMBER_LOGIN_KEY);
        }
      }
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
      const conflict = e instanceof ApiError && e.code === 'CONFLICT';
      setTaken(conflict && registering);
      setError(conflict ? 'This mobile number already has an account.' : friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* the app root lifts this screen above the keyboard */}
      <View style={[{ flex: 1 }, desktop && styles.shellDesktop]}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={[styles.container, desktop && styles.containerDesktop]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.hero, desktop && styles.heroDesktop]}>
            {desktop ? (
              <Image source={loginHero} style={styles.heroScene} resizeMode="cover" />
            ) : null}
            <Image
              source={illustrations.shopfront}
              style={[styles.heroArt, desktop && styles.heroArtDesktop]}
              resizeMode="contain"
              accessibilityIgnoresInvertColors
            />
            {/* Desktop: the picture speaks for itself; the text card is shown on phones only. */}
            {!desktop && (
              <View style={styles.heroCopyPhone}>
                <Text style={styles.appName} accessibilityRole="header">
                  Yapaaram
                </Text>
                <Text style={styles.brand}>
                  {joining
                    ? 'Join your shop'
                    : registering
                      ? 'Set up your shop'
                      : 'Your shop, in your pocket'}
                </Text>
                <Text style={styles.subtitle}>
                  {joining
                    ? 'Enter the code the shop owner gave you.'
                    : registering
                      ? 'Takes a minute. You can add products and customers after.'
                      : 'Billing, stock and khata — even when the internet is down.'}
                </Text>
              </View>
            )}
          </View>

          <View style={[styles.form, desktop && styles.formDesktop]}>
            {joining && (
              <Field
                label="Invitation code"
                value={code}
                onChangeText={setCode}
                autoCapitalize="characters"
                autoComplete="off"
                placeholder="XXXX-XXXX-XXXX"
                maxLength={20}
              />
            )}
            {joining && (
              <Field
                label="Your name"
                value={fullName}
                onChangeText={setFullName}
                autoCapitalize="words"
              />
            )}
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
                <Select
                  label="What kind of shop is it?"
                  options={SHOP_TYPES}
                  value={shopType}
                  onChange={setShopType}
                />
              </>
            )}
            {!joining && (
              <Field
                label="Mobile number"
                value={phone}
                onChangeText={(v) => {
                  setPhone(phoneDigits(v));
                  setShops([]);
                  setOrganizationId(undefined);
                  setTaken(false);
                }}
                prefix="+91"
                error={phoneProblem(phone)}
                keyboardType="number-pad"
                autoComplete="tel"
                placeholder="98765 43210"
                maxLength={16}
              />
            )}
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete={registering || joining ? 'new-password' : 'current-password'}
              placeholder={registering || joining ? 'At least 8 characters' : undefined}
              hint={
                joining
                  ? 'New here? Choose a password. Already have an account with this number? Enter your existing password.'
                  : undefined
              }
              onSubmitEditing={registering ? undefined : submit}
            />
            {registering && password.length > 0 && (
              <View style={{ marginTop: -6, marginBottom: 14, gap: 3 }}>
                {passwordChecks(password, phone).map((c) => (
                  <View
                    key={c.label}
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                  >
                    <Ionicons
                      name={c.ok ? 'checkmark-circle' : 'ellipse-outline'}
                      size={16}
                      color={c.ok ? colors.success : colors.textMuted}
                    />
                    <Text style={{ fontSize: 13, color: c.ok ? colors.success : colors.textMuted }}>
                      {c.label}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            {registering && (
              <Field
                label="Type the password again"
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="off"
                error={
                  confirm.length > 0 && confirm !== password
                    ? 'The two passwords do not match.'
                    : null
                }
                onSubmitEditing={submit}
              />
            )}
            {!registering && !joining && shops.length > 0 && (
              <Choice
                label="Choose shop"
                options={shops.map((s) => ({ key: s.id, label: s.name }))}
                value={organizationId ?? shops[0]?.id ?? ''}
                onChange={setOrganizationId}
              />
            )}
            {!registering && !joining ? (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: rememberLogin }}
                onPress={() => setRememberLogin((value) => !value)}
                style={styles.remember}
              >
                <Ionicons
                  name={rememberLogin ? 'checkbox' : 'square-outline'}
                  size={20}
                  color={rememberLogin ? colors.primary : colors.textMuted}
                />
                <Text style={styles.rememberText}>Remember password on this device</Text>
              </Pressable>
            ) : null}
            <ErrorText message={error} />
            {taken ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setMode('signIn');
                  setTaken(false);
                  setError(null);
                  setConfirm('');
                }}
                style={styles.switch}
              >
                <Text style={styles.switchText}>Sign in with this number instead</Text>
              </Pressable>
            ) : null}
            {registering ? (
              <Text style={styles.consent}>
                By creating a shop you agree to the Terms of Use and Privacy Policy.
              </Text>
            ) : null}
            <Button
              title={joining ? 'Join the shop' : registering ? 'Create shop' : 'Sign in'}
              icon={
                joining ? 'people-outline' : registering ? 'storefront-outline' : 'arrow-forward'
              }
              onPress={submit}
              busy={busy}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => {
                setMode(registering || joining ? 'signIn' : 'register');
                setConfirm('');
                setTaken(false);
                setShops([]);
                setOrganizationId(undefined);
                setError(null);
              }}
              style={styles.switch}
            >
              <Text style={styles.switchText}>
                {joining
                  ? 'Back to sign in'
                  : registering
                    ? 'I already have an account'
                    : 'New here? Create your shop'}
              </Text>
            </Pressable>
            {mode === 'signIn' && (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  setMode('join');
                  setShops([]);
                  setOrganizationId(undefined);
                  setError(null);
                }}
                style={styles.switch}
              >
                <Text style={styles.switchText}>I have an invitation code</Text>
              </Pressable>
            )}
          </View>
          <View style={[styles.trust, desktop && styles.trustDesktop]}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.textMuted} />
            <Text style={styles.trustText}>Your data is backed up safely</Text>
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  shellDesktop: { flexDirection: 'row', alignItems: 'stretch' },
  container: { flexGrow: 1, paddingBottom: 24 },
  // Desktop/tablet: picture on the left takes the leftover width and may shrink; the form keeps a
  // steady width on the right. No fixed page width, so nothing overflows or collapses at any size.
  containerDesktop: {
    flexDirection: 'row',
    alignItems: 'stretch',
    minHeight: '100%',
    paddingBottom: 0,
  },
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
  heroDesktop: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    minHeight: '100%',
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    padding: 42,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    overflow: 'hidden',
  },
  heroScene: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  heroArtDesktop: { display: 'none' },
  heroCopyPhone: { alignItems: 'center' },
  appName: {
    fontSize: 15,
    fontWeight: '800',
    color: colors.primary,
    letterSpacing: 2,
    textTransform: 'uppercase',
    marginTop: 8,
  },
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
  formDesktop: {
    width: 480,
    maxWidth: 480,
    flexGrow: 0,
    flexShrink: 0,
    alignSelf: 'stretch',
    justifyContent: 'center',
    paddingHorizontal: 40,
    paddingVertical: 32,
  },
  trustDesktop: { display: 'none' },
  switch: { minHeight: 48, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  switchText: { fontSize: 15, fontWeight: '700', color: colors.primary },
  consent: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginBottom: 10 },
  trust: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 12,
  },
  trustText: { fontSize: 12, color: colors.textMuted },
  remember: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44, marginBottom: 4 },
  rememberText: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
});
