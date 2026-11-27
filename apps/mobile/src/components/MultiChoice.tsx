import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme/colors';
import { MAX_FONT_SCALE } from '@/components/ui';

/** Pick any number of options (tick boxes in a row of pills). The first one picked is the "main" one. */
export function MultiChoice({
  label,
  options,
  value,
  onChange,
  note,
}: {
  label: string;
  options: readonly { key: string; label: string }[];
  value: string[];
  onChange: (next: string[]) => void;
  note?: string;
}) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{ fontSize: 13, fontWeight: '700', color: '#3D4C43', marginBottom: 8 }}
      >
        {label}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => {
          const on = value.includes(o.key);
          return (
            <Pressable
              key={o.key}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: on }}
              onPress={() => onChange(on ? value.filter((k) => k !== o.key) : [...value, o.key])}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                minHeight: 44,
                paddingHorizontal: 14,
                borderRadius: 12,
                borderWidth: 1.5,
                borderColor: on ? colors.primary : colors.border,
                backgroundColor: on ? colors.primarySoft : colors.surface,
              }}
            >
              <Ionicons
                name={on ? 'checkbox' : 'square-outline'}
                size={20}
                color={on ? colors.primary : colors.textMuted}
              />
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={{
                  fontSize: 15,
                  fontWeight: '700',
                  color: on ? colors.primary : colors.text,
                }}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {note ? (
        <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 6 }}>{note}</Text>
      ) : null}
    </View>
  );
}
