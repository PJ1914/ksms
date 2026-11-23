import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/ui';
import { colors } from '@/theme/colors';

/** Pagination footer for FlatList: shows "Showing X of Y", loading spinner, and a fallback "Load more" button. */
export function ListFooter({
  shown,
  total,
  loadingMore,
  fromCache,
  onLoadMore,
}: {
  shown: number;
  total: number | undefined;
  loadingMore: boolean;
  fromCache?: boolean;
  onLoadMore: () => void;
}) {
  if (shown === 0) return null;
  const hasMore = !fromCache && total !== undefined && shown < total;

  return (
    <View style={styles.wrap}>
      {total !== undefined ? (
        <Text style={styles.count}>
          Showing {shown} of {total}
          {fromCache ? ' (cached)' : ''}
        </Text>
      ) : null}
      {loadingMore ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 8 }} />
      ) : hasMore ? (
        <View style={{ width: '100%', marginTop: 8 }}>
          <Button title="Load more" variant="secondary" onPress={onLoadMore} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingVertical: 14, alignItems: 'center' },
  count: { fontSize: 12, color: colors.textMuted },
});
