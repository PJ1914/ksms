import { StyleSheet, Text, View } from 'react-native';
import { colors } from '@/theme/colors';

/** Temporary screen body used until each feature is built in its own phase. */
export function PlaceholderScreen({ title, note }: { title: string; note: string }) {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.note}>{note}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    backgroundColor: colors.background,
  },
  title: { fontSize: 22, fontWeight: '600', color: colors.text },
  note: { marginTop: 8, fontSize: 14, color: colors.textMuted, textAlign: 'center' },
});
