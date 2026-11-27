import { router } from 'expo-router';
import { createContext, useContext, useState } from 'react';
import { Text, View } from 'react-native';
import { colors } from '@/theme/colors';
import { MAX_FONT_SCALE, useLayout } from './ui';

const SelectContext = createContext<((id: string) => void) | null>(null);

type DetailRoute = '/customer/[id]' | '/supplier/[id]' | '/product/[id]';

/**
 * Returns a function that opens a record. Inside a desktop MasterDetail it shows the record in
 * the right-hand pane; everywhere else (phone, tablet) it navigates to the record's own screen.
 */
export function useOpenDetail(pathname: DetailRoute) {
  const select = useContext(SelectContext);
  return (id: string) => (select ? select(id) : router.push({ pathname, params: { id } } as never));
}

/** Desktop: list on the left, the chosen record on the right. Other sizes: just the list. */
export function MasterDetail({
  children,
  renderDetail,
  emptyTitle,
  emptyNote,
}: {
  children: React.ReactNode;
  renderDetail: (id: string) => React.ReactNode;
  emptyTitle: string;
  emptyNote: string;
}) {
  const { mode } = useLayout();
  const [id, setId] = useState<string | null>(null);
  if (mode !== 'desktop') return <>{children}</>;
  return (
    <View style={{ flex: 1, flexDirection: 'row', backgroundColor: colors.background }}>
      <View
        style={{
          width: 420,
          borderRightWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.background,
        }}
      >
        <SelectContext.Provider value={setId}>{children}</SelectContext.Provider>
      </View>
      <View style={{ flex: 1, minWidth: 0, backgroundColor: colors.surface }}>
        {id ? (
          <View key={id} style={{ flex: 1 }}>
            {renderDetail(id)}
          </View>
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 }}>
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={{ fontSize: 20, fontWeight: '700', color: colors.text }}
            >
              {emptyTitle}
            </Text>
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={{ marginTop: 6, color: colors.textMuted }}
            >
              {emptyNote}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}
