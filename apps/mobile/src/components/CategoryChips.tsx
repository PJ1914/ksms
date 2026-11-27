import { Image, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { MAX_FONT_SCALE } from '@/components/ui';
import { categoryArt } from '@/theme/art';
import { colors } from '@/theme/colors';

export interface CategoryChipItem {
  id: string;
  name: string;
  productCount?: number;
}

/** Horizontal scrollable category filter chips (`All` + each shop category, with its picture). */
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
      <Chip label="All" selected={value === null} onPress={() => onChange(null)} />
      {categories.map((c) => (
        <Chip
          key={c.id}
          label={c.name}
          art
          selected={value === c.id}
          onPress={() => onChange(value === c.id ? null : c.id)}
        />
      ))}
    </ScrollView>
  );
}

/** The same chip row for any short list of choices (for example a sort order). */
export function OptionChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { key: T; label: string }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.bar}
      contentContainerStyle={styles.content}
    >
      {options.map((o) => (
        <Chip
          key={o.key}
          label={o.label}
          selected={value === o.key}
          onPress={() => onChange(o.key)}
        />
      ))}
    </ScrollView>
  );
}

function Chip({
  label,
  art,
  selected,
  onPress,
}: {
  label: string;
  art?: boolean;
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
      {art ? <Image source={categoryArt(label)} style={styles.art} resizeMode="contain" /> : null}
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.text, selected && styles.textSelected]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // flexShrink: 0 stops the flex:1 list below from squashing the row and clipping the chips.
  bar: { flexGrow: 0, flexShrink: 0, minHeight: 48, marginBottom: 12 },
  content: { gap: 8, paddingVertical: 2, paddingRight: 8 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    minHeight: 40,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: { borderColor: colors.text, backgroundColor: colors.text },
  art: { width: 22, height: 22 },
  text: { fontSize: 14, color: colors.text, fontWeight: '600' },
  textSelected: { color: colors.surface },
});
