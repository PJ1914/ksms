import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
  type ViewStyle,
} from 'react-native';
import { colors } from '@/theme/colors';
import { formatINR } from '@/utils/currency';

/** Small shared building blocks used by every screen. */

export function Field({
  label,
  hint,
  ...input
}: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        autoCorrect={false}
        {...input}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Button({
  title,
  onPress,
  busy,
  disabled,
  variant = 'primary',
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger';
}) {
  const palette = {
    primary: { bg: colors.primary, fg: '#fff', border: colors.primary },
    secondary: { bg: colors.surface, fg: colors.primary, border: colors.border },
    danger: { bg: colors.surface, fg: colors.danger, border: colors.danger },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy || disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border },
        (pressed || busy || disabled) && { opacity: disabled ? 0.45 : 0.7 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <Text style={[styles.buttonText, { color: palette.fg }]}>{title}</Text>
      )}
    </Pressable>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <Text accessibilityLiveRegion="polite" style={styles.error}>
      {message}
    </Text>
  );
}

/** A scrolling page with the standard padding; pass `onRefresh` for pull-to-refresh. */
export function Screen({
  children,
  onRefresh,
  refreshing,
  footer,
}: {
  children: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Pinned under the scrolling content (for the main action button). */
  footer?: React.ReactNode;
}) {
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} /> : undefined
        }
      >
        {children}
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({ children, action }: { children: string; action?: React.ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {action}
    </View>
  );
}

/** A label on the left and a value on the right. */
export function KeyValue({
  label,
  value,
  bold,
  tone,
}: {
  label: string;
  value: string;
  bold?: boolean;
  tone?: 'danger' | 'success' | 'muted';
}) {
  const color =
    tone === 'danger'
      ? colors.danger
      : tone === 'success'
        ? colors.success
        : tone === 'muted'
          ? colors.textMuted
          : colors.text;
  return (
    <View style={styles.kv}>
      <Text style={[styles.kvLabel, bold && { fontWeight: '700', color: colors.text }]}>
        {label}
      </Text>
      <Text style={[styles.kvValue, { color }, bold && { fontWeight: '700' }]}>{value}</Text>
    </View>
  );
}

export function Money({ value, style }: { value: string; style?: object }) {
  return <Text style={style}>{formatINR(value)}</Text>;
}

type Tone = 'neutral' | 'good' | 'warn' | 'bad';
export function Badge({ text, tone = 'neutral' }: { text: string; tone?: Tone }) {
  const p = {
    neutral: { bg: colors.border, fg: colors.text },
    good: { bg: colors.successSoft, fg: colors.success },
    warn: { bg: colors.warningSoft, fg: colors.warning },
    bad: { bg: colors.dangerSoft, fg: colors.danger },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: p.bg }]}>
      <Text style={[styles.badgeText, { color: p.fg }]}>{text}</Text>
    </View>
  );
}

/** Pick one of a few options (a row of pills). */
export function Choice<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: readonly { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.field}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.pills}>
        {options.map((o) => {
          const selected = o.key === value;
          return (
            <Pressable
              key={o.key}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => onChange(o.key)}
              style={[styles.pill, selected && styles.pillSelected]}
            >
              <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function EmptyState({
  icon = 'file-tray-outline',
  title,
  note,
}: {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  note?: string;
}) {
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={44} color={colors.textMuted} />
      <Text style={styles.emptyTitle}>{title}</Text>
      {note ? <Text style={styles.emptyNote}>{note}</Text> : null}
    </View>
  );
}

export function Loading() {
  return <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />;
}

/** A tappable row for lists. */
export function ListRow({
  title,
  subtitle,
  right,
  rightSub,
  onPress,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  rightSub?: string;
  onPress?: () => void;
}) {
  const content = (
    <View style={styles.listRow}>
      <View style={{ flex: 1 }}>
        <Text style={styles.listTitle} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? <Text style={styles.listSub}>{subtitle}</Text> : null}
      </View>
      <View style={{ alignItems: 'flex-end', marginLeft: 12 }}>
        {right}
        {rightSub ? <Text style={styles.listSub}>{rightSub}</Text> : null}
      </View>
      {onPress ? (
        <Ionicons
          name="chevron-forward"
          size={18}
          color={colors.textMuted}
          style={{ marginLeft: 6 }}
        />
      ) : null}
    </View>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => pressed && { opacity: 0.7 }}
    >
      {content}
    </Pressable>
  ) : (
    content
  );
}

export function SearchBox({
  value,
  onChangeText,
  placeholder,
  onScan,
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder: string;
  onScan?: () => void;
}) {
  return (
    <View style={styles.searchBox}>
      <Ionicons name="search" size={18} color={colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={styles.search}
        autoCorrect={false}
        returnKeyType="search"
      />
      {onScan ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scan a barcode"
          onPress={onScan}
          hitSlop={8}
        >
          <Ionicons name="barcode-outline" size={24} color={colors.primary} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function FloatingButton({
  icon = 'add',
  label,
  onPress,
}: {
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={styles.fab}
      onPress={onPress}
    >
      <Ionicons name={icon} size={30} color="#fff" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 14 },
  label: { fontSize: 14, fontWeight: '500', color: colors.text, marginBottom: 6 },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  button: {
    borderRadius: 8,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
    minHeight: 50,
    justifyContent: 'center',
  },
  buttonText: { fontWeight: '600', fontSize: 16 },
  error: { color: colors.danger, marginBottom: 12, fontSize: 14 },
  footer: {
    padding: 12,
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  kvLabel: { fontSize: 14, color: colors.textMuted },
  kvValue: { fontSize: 14, fontWeight: '500' },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, alignSelf: 'flex-start' },
  badgeText: { fontSize: 12, fontWeight: '600' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  pillSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  pillText: { fontSize: 14, color: colors.text },
  pillTextSelected: { color: colors.primary, fontWeight: '600' },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 60, paddingHorizontal: 24 },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text,
    marginTop: 12,
    textAlign: 'center',
  },
  emptyNote: { fontSize: 14, color: colors.textMuted, marginTop: 4, textAlign: 'center' },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  listTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  listSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
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
