import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSync } from '@/sync/SyncProvider';
import { colors } from '@/theme/colors';
import { formatDateTime } from '@/utils/format';

/** Compact status pill showing offline/syncing/pending/failed state. Tapping opens `/sync`. */
export function SyncBanner() {
  const { syncState, stats } = useSync();

  const hasFailed = stats.failedOutbox > 0;
  const hasPending = stats.pendingOutbox > 0;
  const isOffline = syncState === 'offline';
  const isSyncing = syncState === 'syncing';

  let bg: string = colors.surface;
  let border: string = colors.border;
  let fg: string = colors.textMuted;
  let icon: React.ComponentProps<typeof Ionicons>['name'] = 'cloud-done-outline';
  let title = stats.lastSyncedAt ? `Synced · ${formatDateTime(stats.lastSyncedAt)}` : 'Online';

  if (hasFailed) {
    bg = colors.dangerSoft;
    border = colors.danger;
    fg = colors.danger;
    icon = 'alert-circle-outline';
    title = `${stats.failedOutbox} held bill${stats.failedOutbox === 1 ? '' : 's'} failed to sync · Tap to review`;
  } else if (isOffline) {
    bg = colors.warningSoft;
    border = colors.warning;
    fg = colors.warning;
    icon = 'cloud-offline-outline';
    title = hasPending
      ? `Offline · ${stats.pendingOutbox} held bill${stats.pendingOutbox === 1 ? '' : 's'} waiting`
      : 'Offline · Using saved data';
  } else if (isSyncing) {
    icon = 'sync-outline';
    fg = colors.primary;
    title = 'Syncing catalog and held bills…';
  } else if (hasPending) {
    bg = colors.warningSoft;
    border = colors.warning;
    fg = colors.warning;
    icon = 'cloud-upload-outline';
    title = `${stats.pendingOutbox} held bill${stats.pendingOutbox === 1 ? '' : 's'} waiting to upload`;
  }

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push('/sync')}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        backgroundColor: bg,
        borderColor: border,
        borderWidth: 1,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 9,
        marginBottom: 12,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
        <Ionicons name={icon} size={18} color={fg} />
        <Text style={{ color: fg, fontWeight: '600', fontSize: 13, flex: 1 }} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={fg} />
    </Pressable>
  );
}
