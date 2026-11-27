import { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MAX_FONT_SCALE } from '@/components/ui';
import { colors } from '@/theme/colors';

/** A drop-down: looks like a text box, opens a list of choices to pick one from. */
export function Select({
  label,
  options,
  value,
  onChange,
  hint,
}: {
  label: string;
  options: readonly { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.key === value);
  return (
    <View style={{ marginBottom: 16 }}>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{ fontSize: 13, fontWeight: '700', color: '#3D4C43', marginBottom: 8 }}
      >
        {label}
      </Text>
      <Pressable
        accessibilityRole="combobox"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderWidth: 1.5,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          borderRadius: 12,
          paddingHorizontal: 14,
          minHeight: 52,
        }}
      >
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={{ fontSize: 16, color: current ? colors.text : colors.textMuted }}
        >
          {current?.label ?? 'Choose'}
        </Text>
        <Ionicons name="chevron-down" size={20} color={colors.textMuted} />
      </Pressable>
      {hint ? (
        <Text style={{ fontSize: 12, color: colors.textMuted, marginTop: 6 }}>{hint}</Text>
      ) : null}

      <Modal transparent animationType="fade" visible={open} onRequestClose={() => setOpen(false)}>
        <Pressable
          accessibilityLabel="Close"
          onPress={() => setOpen(false)}
          style={{
            flex: 1,
            backgroundColor: 'rgba(0,0,0,0.4)',
            justifyContent: 'center',
            padding: 24,
          }}
        >
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 16,
              maxHeight: '70%',
              width: '100%',
              maxWidth: 420,
              alignSelf: 'center',
              paddingVertical: 8,
            }}
          >
            <Text
              style={{
                fontSize: 15,
                fontWeight: '800',
                color: colors.text,
                paddingHorizontal: 18,
                paddingVertical: 10,
              }}
            >
              {label}
            </Text>
            <ScrollView>
              {options.map((o) => {
                const on = o.key === value;
                return (
                  <Pressable
                    key={o.key}
                    accessibilityRole="menuitem"
                    accessibilityState={{ selected: on }}
                    onPress={() => {
                      onChange(o.key);
                      setOpen(false);
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingHorizontal: 18,
                      minHeight: 52,
                      backgroundColor: on ? colors.primarySoft : undefined,
                    }}
                  >
                    <Text
                      style={{
                        fontSize: 16,
                        fontWeight: on ? '800' : '500',
                        color: on ? colors.primary : colors.text,
                      }}
                    >
                      {o.label}
                    </Text>
                    {on ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}
