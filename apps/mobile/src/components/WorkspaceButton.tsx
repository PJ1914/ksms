import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { colors, workspace } from '@/theme/colors';
import { MAX_FONT_SCALE } from './ui';

export function WorkspaceButton({
  label,
  icon,
  onPress,
  compact,
  active,
  primary,
}: {
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  compact?: boolean;
  active?: boolean;
  primary?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const ink = primary ? colors.onPrimary : active ? colors.primary : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      style={({ pressed }) => ({
        minHeight: workspace.control,
        minWidth: workspace.control,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: compact ? 'center' : 'flex-start',
        gap: 10,
        paddingHorizontal: compact ? 4 : 14,
        borderRadius: workspace.radius,
        borderWidth: 2,
        borderColor: focus ? colors.info : 'transparent',
        backgroundColor: primary
          ? hover
            ? colors.primaryDark
            : colors.primary
          : active
            ? colors.primarySoft
            : hover
              ? colors.surfaceMuted
              : 'transparent',
        opacity: pressed ? 0.8 : 1,
      })}
    >
      <Ionicons name={icon} size={19} color={ink} />
      {!compact && (
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          numberOfLines={1}
          style={{
            flexShrink: 1,
            color: ink,
            fontSize: workspace.body,
            fontWeight: active || primary ? '600' : '500',
          }}
        >
          {label}
        </Text>
      )}
    </Pressable>
  );
}
