import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '@/auth/AuthProvider';
import { api } from '@/auth/session';
import { ErrorText } from '@/components/ui';
import { colors } from '@/theme/colors';
import { formatINR } from '@/utils/currency';
import { friendlyError } from '@/utils/errors';

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  status: string;
  baseUnit: { id: string; code: string };
  category: { id: string; name: string } | null;
  basePrice: string | null;
}

interface Page {
  data: ProductRow[];
  meta: { page: number; pageSize: number; total: number };
}

const PAGE_SIZE = 30;

export default function StockScreen() {
  const { can } = useAuth();
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Ignore answers to searches the user has already typed past.
  const latest = useRef(0);

  const load = useCallback(async (q: string, nextPage: number, mode: 'replace' | 'append') => {
    const ticket = ++latest.current;
    const params = new URLSearchParams({
      page: String(nextPage),
      pageSize: String(PAGE_SIZE),
      sort: 'name',
    });
    if (q.trim()) params.set('q', q.trim());
    try {
      const res = await api.get<Page>(`/products?${params.toString()}`);
      if (ticket !== latest.current) return;
      setItems((prev) => (mode === 'append' ? [...prev, ...res.data] : res.data));
      setTotal(res.meta.total);
      setPage(nextPage);
      setError(null);
    } catch (e) {
      if (ticket === latest.current) setError(friendlyError(e));
    } finally {
      if (ticket === latest.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  // Search as the user types, after a short pause.
  useEffect(() => {
    const t = setTimeout(() => void load(query, 1, 'replace'), 300);
    return () => clearTimeout(t);
  }, [query, load]);

  // Reload when coming back from "Add product" (not on every keystroke: the query is read from a ref).
  const first = useRef(true);
  const queryRef = useRef(query);
  queryRef.current = query;
  useFocusEffect(
    useCallback(() => {
      if (first.current) {
        first.current = false;
        return;
      }
      void load(queryRef.current, 1, 'replace');
    }, [load]),
  );

  const canAdd = can('product.manage');

  return (
    <View style={styles.container}>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={18} color={colors.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search name, SKU or barcode"
          placeholderTextColor={colors.textMuted}
          style={styles.search}
          autoCorrect={false}
          returnKeyType="search"
        />
      </View>
      <ErrorText message={error} />

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(p) => p.id}
          contentContainerStyle={items.length === 0 ? styles.emptyWrap : { paddingBottom: 96 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load(query, 1, 'replace');
              }}
            />
          }
          onEndReachedThreshold={0.5}
          onEndReached={() => {
            if (items.length < total) void load(query, page + 1, 'append');
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="cube-outline" size={48} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>
                {query.trim() ? 'No products match your search' : 'No products yet'}
              </Text>
              {!query.trim() && canAdd && (
                <Text style={styles.emptyNote}>Tap + to add your first product.</Text>
              )}
            </View>
          }
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          renderItem={({ item }) => (
            <View style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{item.name}</Text>
                <Text style={styles.meta}>
                  {item.sku}
                  {item.category ? ` · ${item.category.name}` : ''}
                </Text>
              </View>
              <Text style={styles.price}>
                {item.basePrice
                  ? `${formatINR(item.basePrice)} / ${item.baseUnit.code}`
                  : 'No price'}
              </Text>
            </View>
          )}
        />
      )}

      {canAdd && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add product"
          style={styles.fab}
          onPress={() => router.push('/product-new')}
        >
          <Ionicons name="add" size={30} color="#fff" />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 12 },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  search: { flex: 1, paddingVertical: 10, fontSize: 16, color: colors.text },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  separator: { height: 8 },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  meta: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  price: { fontSize: 15, fontWeight: '600', color: colors.text, marginLeft: 12 },
  emptyWrap: { flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginTop: 12 },
  emptyNote: { fontSize: 14, color: colors.textMuted, marginTop: 4 },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
});
