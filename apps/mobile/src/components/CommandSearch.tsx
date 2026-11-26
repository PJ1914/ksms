import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, ScrollView, Text, TextInput, View } from 'react-native';
import { getPage, query } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { colors, radius } from '@/theme/colors';
import { MAX_FONT_SCALE } from './ui';
import { WorkspaceButton } from './WorkspaceButton';

type Result = { label: string; href: Href };
export function CommandSearch({ adjust, onClose }: { adjust: boolean; onClose: () => void }) {
  const { can } = useAuth();
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [message, setMessage] = useState('');
  useEffect(() => {
    const q = term.trim();
    if (!q) return;
    let live = true;
    const timer = setTimeout(async () => {
      const suffix = query({ q, pageSize: 6 });
      const jobs: Promise<Result[]>[] = [];
      for (const [section, path, permission, detail] of [
        ['Product', '/products', 'product.read', '/product/[id]'],
        ['Customer', '/customers', 'customer.read', '/customer/[id]'],
        ['Supplier', '/suppliers', 'supplier.read', '/supplier/[id]'],
      ] as const) {
        if (!can(permission) || (adjust && section !== 'Product')) continue;
        jobs.push(
          getPage<{ id: string; name: string }>(path + suffix).then((page) =>
            page.data.map((row) => ({
              label: section + ' · ' + row.name,
              href: adjust
                ? { pathname: '/stock-adjust', params: { productId: row.id, mode: 'ADD' } }
                : { pathname: detail, params: { id: row.id } },
            })),
          ),
        );
      }
      if (!adjust && can('sale.read'))
        jobs.push(
          getPage<{ id: string; saleNumber: string }>('/sales' + suffix).then((page) =>
            page.data.map((row) => ({
              label: 'Bill · ' + row.saleNumber,
              href: { pathname: '/sale/[id]', params: { id: row.id } },
            })),
          ),
        );
      const pages = await Promise.allSettled(jobs);
      if (!live) return;
      const hits = pages.flatMap((page) => (page.status === 'fulfilled' ? page.value : []));
      setResults(hits);
      setMessage(
        pages.some((page) => page.status === 'rejected')
          ? 'Some results could not be loaded.'
          : hits.length
            ? ''
            : 'No matches.',
      );
    }, 220);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [term, adjust, can]);
  const title = adjust ? 'Choose a product to adjust' : 'Search the workspace';
  return (
    <Modal transparent animationType="none" visible onRequestClose={onClose}>
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
          backgroundColor: colors.scrim,
        }}
      >
        <View
          accessibilityViewIsModal
          style={{
            width: '100%',
            maxWidth: 600,
            maxHeight: '80%',
            padding: 18,
            gap: 8,
            borderRadius: radius.lg,
            backgroundColor: colors.surface,
          }}
        >
          <View
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
          >
            <Text
              accessibilityRole="header"
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={{ fontSize: 18, color: colors.text, fontWeight: '700' }}
            >
              {title}
            </Text>
            <WorkspaceButton label="Close search" icon="close" compact onPress={onClose} />
          </View>
          <TextInput
            autoFocus
            accessibilityLabel={title}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            placeholder={
              adjust ? 'Product name or SKU' : 'Product, customer, supplier or bill number'
            }
            value={term}
            onChangeText={(v) => {
              setTerm(v);
              setResults([]);
              setMessage(v.trim() ? 'Searching…' : '');
            }}
            style={{
              minHeight: 44,
              borderColor: colors.primary,
              borderWidth: 1,
              borderRadius: radius.sm,
              paddingHorizontal: 12,
              color: colors.text,
            }}
          />
          <ScrollView keyboardShouldPersistTaps="handled">
            {results.map((hit) => (
              <WorkspaceButton
                key={JSON.stringify(hit.href)}
                label={hit.label}
                icon="arrow-forward-outline"
                onPress={() => {
                  onClose();
                  router.push(hit.href);
                }}
              />
            ))}
          </ScrollView>
          {!!message && (
            <Text
              accessibilityLiveRegion="polite"
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={{ color: colors.textMuted }}
            >
              {message}
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
}
