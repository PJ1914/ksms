import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { colors } from '@/theme/colors';

export interface CategoryChipItem {
  id: string;
  name: string;
  productCount?: number;
}

/** Horizontal scrollable category filter chips (`All` + each shop category). */
export function CategoryChips({
  categories,
  value,
  onChange,
}: {
  categories: CategoryChipItem[];
  value: string | null;
  onChange: (id: string | null) => void;
}) {
  if (categories.length === 0) return null;

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.bar}
      contentContainerStyle={styles.content}
    >
      <Chip label="All categories" selected={value === null} onPress={() => onChange(null)} />
      {categories.map((c) => (
        <Chip
          key={c.id}
          label={c.productCount !== undefined ? `${c.name} (${c.productCount})` : c.name}
          selected={value === c.id}
          onPress={() => onChange(value === c.id ? null : c.id)}
        />
      ))}
    </ScrollView>
  );
}

function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.chipSelected]}
    >
      <Text style={[styles.text, selected && styles.textSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { flexGrow: 0, marginBottom: 10 },
  content: { gap: 8, paddingVertical: 2 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    borderColor: colors.primary,
    backgroundColor: '#E6F1EC',
  },
  text: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  textSelected: { color: colors.primary },
});
