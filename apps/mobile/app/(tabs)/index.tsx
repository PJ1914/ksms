import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import { colors } from '@/theme/colors';

export default function HomeScreen() {
  const { profile } = useAuth();
  const firstName = profile?.user.fullName.split(' ')[0] ?? '';
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Namaste, {firstName}</Text>
      <Text style={styles.shop}>{profile?.organization.name}</Text>
      <Text style={styles.note}>
        Today&apos;s sales, low stock and dues will appear here in a later phase. Open the Stock tab
        to see and add products.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, backgroundColor: colors.background },
  title: { fontSize: 24, fontWeight: '700', color: colors.text },
  shop: { fontSize: 16, color: colors.primary, marginTop: 4, fontWeight: '600' },
  note: { fontSize: 14, color: colors.textMuted, marginTop: 16, lineHeight: 20 },
});
