import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui';
import { colors } from '@/theme/colors';

export default function MoreScreen() {
  const { profile, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const branch = profile?.branches.find((b) => b.isDefault) ?? profile?.branches[0];

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.name}>{profile?.user.fullName}</Text>
        <Text style={styles.meta}>{profile?.user.phone}</Text>
        <Text style={styles.meta}>
          {profile?.role.name} · {profile?.organization.name}
          {branch ? ` · ${branch.name}` : ''}
        </Text>
      </View>
      <Text style={styles.note}>Purchases, suppliers, reports and settings arrive later.</Text>
      <Button
        title="Sign out"
        variant="secondary"
        busy={busy}
        onPress={() => {
          setBusy(true);
          void signOut();
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16, backgroundColor: colors.background },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.border,
  },
  name: { fontSize: 18, fontWeight: '600', color: colors.text },
  meta: { fontSize: 14, color: colors.textMuted, marginTop: 4 },
  note: { fontSize: 14, color: colors.textMuted, marginVertical: 16 },
});
