import { useEffect, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { subscribeSlow } from '@/api/slow-requests';
import { MAX_FONT_SCALE } from '@/components/ui';
import { colors } from '@/theme/colors';

/**
 * Shown at the top of every screen while any request has taken more than 5 seconds: the free server
 * sleeps when nobody uses it and needs a moment to start (FIXES F20).
 */
export function SlowServerNotice() {
  const [slow, setSlow] = useState(false);
  useEffect(() => subscribeSlow(setSlow), []);
  if (!slow) return null;
  return (
    <View
      accessibilityRole="alert"
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 48,
        left: 16,
        right: 16,
        zIndex: 100,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: colors.warningSoft,
        borderRadius: 12,
        paddingVertical: 10,
        paddingHorizontal: 14,
      }}
    >
      <ActivityIndicator size="small" color={colors.warning} />
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{ color: colors.warning, fontWeight: '700' }}
      >
        Waking up the server… this can take up to a minute.
      </Text>
    </View>
  );
}
