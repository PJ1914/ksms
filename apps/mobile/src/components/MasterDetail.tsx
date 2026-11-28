import { router } from 'expo-router';
import { View } from 'react-native';
import { colors } from '@/theme/colors';

type DetailRoute = '/customer/[id]' | '/supplier/[id]' | '/product/[id]';

export function useOpenDetail(pathname: DetailRoute) {
  return (id: string) => router.push({ pathname, params: { id } } as never);
}

/** Full-width list workspace. Details open as a full-page route on every device. */
export function MasterDetail({
  children,
}: {
  children: React.ReactNode;
  renderDetail?: (id: string) => React.ReactNode;
  emptyTitle?: string;
  emptyNote?: string;
}) {
  return <View style={{ flex: 1, backgroundColor: colors.background }}>{children}</View>;
}
