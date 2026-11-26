import { createContext, useContext } from 'react';
import { layoutMode } from './layout';
import { Ionicons } from '@expo/vector-icons';
import {
  ActivityIndicator,
  Image,
  type ImageSourcePropType,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, shadow, tints, type Tint } from '@/theme/colors';
import { formatINR } from '@/utils/currency';

/** Shared building blocks (Fresh Mandi style). Every screen is built from these. */

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * Responsive rules (phones 320 dp wide up to tablets and foldables):
 * - content never stretches wider than CONTENT_MAX; on wide screens it sits centred;
 * - sizes come from the live window (useWindowDimensions), so rotation and folding update the layout;
 * - grids pick their column count from the available width instead of fixed percentages;
 * - text follows the phone's text-size setting, capped at MAX_FONT_SCALE so layouts stay readable.
 */
export const CONTENT_MAX = 720;
export const DESKTOP_CONTENT_MAX = 1440;
export const NavigationWidth = createContext(0);
export const MAX_FONT_SCALE = 1.35;

export function useLayout() {
  const { width, height, fontScale } = useWindowDimensions();
  const mode = layoutMode(width);
  const navWidth = useContext(NavigationWidth);
  const contentWidth =
    Math.min(width - navWidth, mode === 'phone' ? CONTENT_MAX : DESKTOP_CONTENT_MAX) -
    (mode === 'phone' ? 40 : 64);
  return {
    width,
    height,
    fontScale,
    mode,
    isSmall: width < 360,
    contentWidth,
    /** How many tiles of at least `minTile` dp fit in a row (clamped to [min, max]). */
    columns(minTile: number, min = 2, max = 6) {
      const gap = 10;
      return Math.max(min, Math.min(max, Math.floor((contentWidth + gap) / (minTile + gap))));
    },
    /** Width of one tile when `cols` tiles share a row with 10 dp gaps. */
    tileWidth(cols: number) {
      return Math.floor((contentWidth - 10 * (cols - 1)) / cols);
    },
  };
}

/** Style for full-height list pages: centred, width-capped on tablets, standard padding. */
export const pageStyle: ViewStyle = {
  flex: 1,
  width: '100%',
  maxWidth: CONTENT_MAX,
  alignSelf: 'center',
  paddingHorizontal: 20,
  paddingTop: 8,
  backgroundColor: colors.background,
};

/** Centres its children and caps their width on tablets. Use around FlatList pages. */
export function Page({ children }: { children: React.ReactNode }) {
  const layout = useLayout();
  return (
    <View
      style={[
        styles.page,
        layout.mode !== 'phone' && { maxWidth: DESKTOP_CONTENT_MAX, paddingHorizontal: 32 },
      ]}
    >
      {children}
    </View>
  );
}

export function Field({
  label,
  hint,
  ...input
}: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.label}>
        {label}
      </Text>
      <TextInput
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, input.multiline && { minHeight: 96, textAlignVertical: 'top' }]}
        autoCorrect={false}
        {...input}
      />
      {hint ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.hint}>
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

export function Button({
  title,
  onPress,
  busy,
  disabled,
  variant = 'primary',
  icon,
}: {
  title: string;
  onPress: () => void;
  busy?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'secondary' | 'danger' | 'accent';
  icon?: IconName;
}) {
  const palette = {
    primary: { bg: colors.primary, fg: colors.onPrimary, border: colors.primary },
    accent: { bg: colors.accent, fg: colors.text, border: colors.accent },
    secondary: { bg: colors.primarySoft, fg: colors.primary, border: colors.primarySoft },
    danger: { bg: colors.surface, fg: colors.danger, border: '#F3C9C1' },
  }[variant];
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!(busy || disabled), busy: !!busy }}
      disabled={busy || disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border },
        variant === 'primary' && !disabled && shadow.raised,
        (pressed || busy || disabled) && { opacity: disabled ? 0.45 : 0.8 },
      ]}
    >
      {busy ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <Ionicons name={icon} size={20} color={palette.fg} /> : null}
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.buttonText, { color: palette.fg }]}
          >
            {title}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

export function ErrorText({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View accessibilityLiveRegion="polite" style={styles.errorBox}>
      <Ionicons name="alert-circle" size={18} color={colors.danger} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.error}>
        {message}
      </Text>
    </View>
  );
}

/** A scrolling page with the standard padding; pass `onRefresh` for pull-to-refresh. */
export function Screen({
  children,
  onRefresh,
  refreshing,
  footer,
  padded = true,
}: {
  children: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  /** Pinned under the scrolling content (for the main action button). */
  footer?: React.ReactNode;
  padded?: boolean;
}) {
  const layout = useLayout();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={
          padded
            ? [styles.screenPad, layout.mode !== 'phone' && styles.desktopScreenPad]
            : { paddingBottom: 32 }
        }
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={!!refreshing}
              onRefresh={onRefresh}
              colors={[colors.primary]}
              tintColor={colors.primary}
            />
          ) : undefined
        }
      >
        <View style={[styles.column, layout.mode !== 'phone' && styles.desktopColumn]}>
          {children}
        </View>
      </ScrollView>
      {footer ? (
        <View style={styles.footer}>
          <View style={styles.column}>{footer}</View>
        </View>
      ) : null}
    </View>
  );
}

export function Card({
  children,
  style,
  tint,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  /** A soft coloured card instead of the white one. */
  tint?: Tint;
}) {
  return (
    <View style={[styles.card, tint && { backgroundColor: tints[tint].bg, ...noShadow }, style]}>
      {children}
    </View>
  );
}

export function SectionTitle({ children, action }: { children: string; action?: React.ReactNode }) {
  return (
    <View style={styles.sectionRow}>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={styles.sectionTitle}
        accessibilityRole="header"
      >
        {children}
      </Text>
      {action}
    </View>
  );
}

/** A small text link, e.g. "See all" next to a section title. */
export function LinkText({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="link" onPress={onPress} hitSlop={10}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.link}>
        {title}
      </Text>
    </Pressable>
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
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.kvLabel, bold && { fontWeight: '700', color: colors.text }]}
      >
        {label}
      </Text>
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={[styles.kvValue, { color }, bold && { fontWeight: '800', fontSize: 16 }]}
      >
        {value}
      </Text>
    </View>
  );
}

export function Money({ value, style }: { value: string; style?: object }) {
  return (
    <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={style}>
      {formatINR(value)}
    </Text>
  );
}

type Tone = 'neutral' | 'good' | 'warn' | 'bad';
export function Badge({ text, tone = 'neutral' }: { text: string; tone?: Tone }) {
  const p = {
    neutral: { bg: colors.surfaceMuted, fg: colors.textMuted },
    good: { bg: colors.successSoft, fg: colors.success },
    warn: { bg: colors.warningSoft, fg: colors.warning },
    bad: { bg: colors.dangerSoft, fg: colors.danger },
  }[tone];
  return (
    <View style={[styles.badge, { backgroundColor: p.bg }]}>
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.badgeText, { color: p.fg }]}>
        {text}
      </Text>
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
      {label ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.label}>
          {label}
        </Text>
      ) : null}
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
              <Text
                maxFontSizeMultiplier={MAX_FONT_SCALE}
                style={[styles.pillText, selected && styles.pillTextSelected]}
              >
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Segmented control: 2–4 equal options in one rounded track (periods, filters). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segTrack} accessibilityRole="tablist">
      {options.map((o) => {
        const selected = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => onChange(o.key)}
            style={[styles.seg, selected && styles.segOn]}
          >
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[styles.segText, selected && styles.segTextOn]}
              numberOfLines={1}
              adjustsFontSizeToFit
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function EmptyState({
  icon = 'file-tray-outline',
  art,
  title,
  note,
  action,
}: {
  icon?: IconName;
  /** An illustration from `@/theme/art`; shown instead of the icon. */
  art?: ImageSourcePropType;
  title: string;
  note?: string;
  action?: { title: string; onPress: () => void };
}) {
  return (
    <View style={styles.empty}>
      {art ? (
        <Image
          source={art}
          style={styles.emptyArt}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
      ) : (
        <View style={styles.emptyIcon}>
          <Ionicons name={icon} size={36} color={colors.primary} />
        </View>
      )}
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.emptyTitle}>
        {title}
      </Text>
      {note ? (
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.emptyNote}>
          {note}
        </Text>
      ) : null}
      {action ? (
        <View style={{ marginTop: 16, alignSelf: 'stretch' }}>
          <Button title={action.title} onPress={action.onPress} variant="secondary" />
        </View>
      ) : null}
    </View>
  );
}

export function Loading() {
  return <ActivityIndicator style={{ marginTop: 40 }} color={colors.primary} />;
}

/** A rounded square with a tinted background holding an icon or a piece of art. */
export function IconTile({
  icon,
  art,
  tint = 'green',
  size = 44,
}: {
  icon?: IconName;
  art?: ImageSourcePropType;
  tint?: Tint;
  size?: number;
}) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        backgroundColor: tints[tint].bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {art ? (
        <Image
          source={art}
          style={{ width: size * 0.82, height: size * 0.82 }}
          resizeMode="contain"
        />
      ) : icon ? (
        <Ionicons name={icon} size={size * 0.5} color={tints[tint].fg} />
      ) : null}
    </View>
  );
}

/** Initials in a coloured circle (customers, suppliers, staff). */
export function Avatar({ name, size = 44 }: { name: string; size?: number }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');
  const palette: Tint[] = ['mango', 'tomato', 'blue', 'green', 'lavender'];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const t = tints[palette[h % palette.length]!];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: t.bg,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text
        maxFontSizeMultiplier={MAX_FONT_SCALE}
        style={{ fontWeight: '800', color: t.fg, fontSize: size * 0.34 }}
      >
        {initials || '?'}
      </Text>
    </View>
  );
}

/** A tappable row for lists, drawn as its own rounded card. */
export function ListRow({
  title,
  subtitle,
  right,
  rightSub,
  onPress,
  leading,
  icon,
  art,
  tint,
}: {
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
  rightSub?: string;
  onPress?: () => void;
  /** Anything on the left (an Avatar, IconTile…). `icon`/`art` are shortcuts for an IconTile. */
  leading?: React.ReactNode;
  icon?: IconName;
  art?: ImageSourcePropType;
  tint?: Tint;
}) {
  const lead = leading ?? (icon || art ? <IconTile icon={icon} art={art} tint={tint} /> : null);
  const content = (
    <View style={styles.listRow}>
      {lead ? <View style={{ marginRight: 12 }}>{lead}</View> : null}
      <View style={{ flex: 1 }}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.listTitle} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.listSub} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right || rightSub ? (
        <View style={{ alignItems: 'flex-end', marginLeft: 12 }}>
          {typeof right === 'string' ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.listRight}>
              {right}
            </Text>
          ) : (
            right
          )}
          {rightSub ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.listSub}>
              {rightSub}
            </Text>
          ) : null}
        </View>
      ) : null}
      {onPress ? (
        <Ionicons name="chevron-forward" size={18} color="#A3B1A8" style={{ marginLeft: 6 }} />
      ) : null}
    </View>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => pressed && { opacity: 0.75 }}
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
    <View style={styles.searchRow}>
      <View style={styles.searchBox}>
        <Ionicons name="search" size={20} color={colors.textMuted} />
        <TextInput
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          style={styles.search}
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel={placeholder}
        />
        {value ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => onChangeText('')}
            hitSlop={10}
          >
            <Ionicons name="close-circle" size={20} color={colors.textMuted} />
          </Pressable>
        ) : null}
      </View>
      {onScan ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Scan a barcode"
          onPress={onScan}
          style={({ pressed }) => [styles.scanBtn, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="barcode-outline" size={24} color={colors.text} />
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
  icon?: IconName;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.fab, pressed && { opacity: 0.85 }]}
      onPress={onPress}
    >
      <Ionicons name={icon} size={24} color={colors.onPrimary} />
      <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.fabText}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Title bar for the tab screens (they have no navigation header). Handles the top safe area. */
export function TabHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  /** A compact primary action on the right, e.g. "+ Product". */
  action?: { label: string; icon?: IconName; onPress: () => void };
}) {
  const insets = useSafeAreaInsets();
  const layout = useLayout();
  return (
    <View
      style={[
        styles.tabHeader,
        layout.mode !== 'phone' && styles.desktopTabHeader,
        {
          paddingTop: insets.top + 14,
          paddingLeft: (layout.mode !== 'phone' ? 32 : 20) + insets.left,
          paddingRight: (layout.mode !== 'phone' ? 32 : 20) + insets.right,
        },
      ]}
    >
      <View style={{ flex: 1 }}>
        <Text
          maxFontSizeMultiplier={MAX_FONT_SCALE}
          style={styles.tabTitle}
          accessibilityRole="header"
        >
          {title}
        </Text>
        {subtitle ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.tabSub}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          style={({ pressed }) => [styles.tabAction, pressed && { opacity: 0.85 }]}
        >
          <Ionicons name={action.icon ?? 'add'} size={20} color={colors.onPrimary} />
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.tabActionText}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The headline card of a detail or report screen: one big number, a label, and a picture. */
export function Hero({
  label,
  value,
  sub,
  art,
  tint = 'green',
  valueTone,
  children,
}: {
  label: string;
  value: string;
  sub?: string;
  art?: ImageSourcePropType;
  tint?: Tint;
  valueTone?: 'danger' | 'success';
  children?: React.ReactNode;
}) {
  const { isSmall } = useLayout();
  const valueColor =
    valueTone === 'danger' ? colors.danger : valueTone === 'success' ? colors.success : colors.text;
  return (
    <View style={[styles.hero, { backgroundColor: tints[tint].bg }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.heroLabel, { color: tints[tint].fg }]}
          >
            {label}
          </Text>
          <Text
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={[styles.heroValue, { color: valueColor }]}
            adjustsFontSizeToFit
            numberOfLines={1}
          >
            {value}
          </Text>
          {sub ? (
            <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.heroSub}>
              {sub}
            </Text>
          ) : null}
        </View>
        {art && !isSmall ? (
          <Image
            source={art}
            style={styles.heroArt}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
          />
        ) : null}
      </View>
      {children ? <View style={{ marginTop: 12 }}>{children}</View> : null}
    </View>
  );
}

/** A row of round quick-action buttons with a label under each (Call, Remind, Pay…). */
export function QuickActions({
  actions,
}: {
  actions: {
    label: string;
    icon: IconName;
    onPress: () => void;
    primary?: boolean;
    hidden?: boolean;
  }[];
}) {
  const shown = actions.filter((a) => !a.hidden);
  if (!shown.length) return null;
  return (
    <View style={styles.qaRow}>
      {shown.map((a) => (
        <Pressable
          key={a.label}
          accessibilityRole="button"
          accessibilityLabel={a.label}
          onPress={a.onPress}
          style={({ pressed }) => [styles.qa, pressed && { opacity: 0.75 }]}
        >
          <View style={[styles.qaIcon, a.primary && { backgroundColor: colors.primary }]}>
            <Ionicons
              name={a.icon}
              size={22}
              color={a.primary ? colors.onPrimary : colors.primary}
            />
          </View>
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.qaText} numberOfLines={2}>
            {a.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/**
 * One line of a statement (khata, stock movement, cashbook): an up/down tile, what happened,
 * when, and a signed amount coloured by direction.
 */
export function EntryRow({
  title,
  subtitle,
  amount,
  direction,
  right,
  onPress,
}: {
  title: string;
  subtitle?: string;
  amount: string;
  /** 'in' = money or stock coming in (green), 'out' = going out / owed (red), 'neutral' = grey. */
  direction: 'in' | 'out' | 'neutral';
  right?: React.ReactNode;
  onPress?: () => void;
}) {
  const t =
    direction === 'in'
      ? tints.green
      : direction === 'out'
        ? tints.tomato
        : { bg: colors.surfaceMuted, fg: colors.textMuted };
  const icon: IconName =
    direction === 'in' ? 'arrow-down' : direction === 'out' ? 'arrow-up' : 'remove';
  const body = (
    <View style={styles.entry}>
      <View style={[styles.entryIcon, { backgroundColor: t.bg }]}>
        <Ionicons name={icon} size={18} color={t.fg} />
      </View>
      <View style={{ flex: 1 }}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.entryTitle} numberOfLines={2}>
          {title}
        </Text>
        {subtitle ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.entrySub} numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={{ alignItems: 'flex-end', gap: 4 }}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={[styles.entryAmt, { color: t.fg }]}>
          {amount}
        </Text>
        {right}
      </View>
    </View>
  );
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => pressed && { opacity: 0.75 }}
    >
      {body}
    </Pressable>
  ) : (
    body
  );
}

/** A grid of small tinted number boxes (Profit / Expenses / Collected…). Columns adapt to width. */
export function Stats({
  items,
}: {
  items: { label: string; value: string; tint?: Tint; hidden?: boolean }[];
}) {
  const layout = useLayout();
  const shown = items.filter((i) => !i.hidden);
  if (!shown.length) return null;
  const cols = Math.min(shown.length, layout.columns(140, 2, 4));
  const w = layout.tileWidth(cols);
  return (
    <View style={styles.stats}>
      {shown.map((i) => {
        const t = tints[i.tint ?? 'green'];
        return (
          <View key={i.label} style={[styles.stat, { width: w, backgroundColor: t.bg }]}>
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={[styles.statLabel, { color: t.fg }]}
            >
              {i.label}
            </Text>
            <Text
              maxFontSizeMultiplier={MAX_FONT_SCALE}
              style={styles.statValue}
              adjustsFontSizeToFit
              numberOfLines={1}
            >
              {i.value}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** A friendly header for forms: a picture, what this screen does, and one line of help. */
export function FormHeader({
  art,
  title,
  note,
}: {
  art: ImageSourcePropType;
  title: string;
  note?: string;
}) {
  return (
    <View style={styles.formHeader}>
      <View style={styles.formArt}>
        <Image source={art} style={{ width: 52, height: 52 }} resizeMode="contain" />
      </View>
      <View style={{ flex: 1 }}>
        <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.formTitle}>
          {title}
        </Text>
        {note ? (
          <Text maxFontSizeMultiplier={MAX_FONT_SCALE} style={styles.formNote}>
            {note}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** A white card that groups EntryRows / KeyValues with thin dividers. */
export function Group({ children }: { children: React.ReactNode }) {
  const kids = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean);
  return (
    <View style={styles.group}>
      {kids.map((k, i) => (
        <View key={i} style={i > 0 ? styles.groupDivider : undefined}>
          {k}
        </View>
      ))}
    </View>
  );
}

const noShadow = { shadowOpacity: 0, elevation: 0 };

const styles = StyleSheet.create({
  screenPad: { padding: 20, paddingBottom: 40 },
  desktopScreenPad: { padding: 32, paddingBottom: 48 },
  field: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: '700', color: '#3D4C43', marginBottom: 8 },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 6 },
  input: {
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 14,
    fontSize: 16,
    color: colors.text,
  },
  button: {
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: 18,
    alignItems: 'center',
    marginTop: 8,
    minHeight: 54,
    justifyContent: 'center',
  },
  buttonInner: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buttonText: { fontWeight: '700', fontSize: 16 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: colors.dangerSoft,
    borderRadius: radius.sm,
    padding: 12,
    marginBottom: 14,
  },
  error: { flex: 1, color: colors.danger, fontSize: 14, fontWeight: '500' },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 16,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    ...shadow.card,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 16,
    marginBottom: 12,
    ...shadow.card,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    marginBottom: 10,
  },
  sectionTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  link: { fontSize: 14, fontWeight: '700', color: colors.primary },
  kv: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, gap: 12 },
  kvLabel: { flex: 1, fontSize: 14, color: colors.textMuted },
  kvValue: { fontSize: 15, fontWeight: '600' },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.pill,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 12, fontWeight: '700' },
  pills: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingVertical: 10,
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: 'center',
  },
  pillSelected: { borderColor: colors.text, backgroundColor: colors.text },
  pillText: { fontSize: 14, fontWeight: '600', color: colors.text },
  pillTextSelected: { color: colors.surface },
  segTrack: {
    flexDirection: 'row',
    backgroundColor: '#E3EBE5',
    borderRadius: radius.md,
    padding: 4,
    gap: 4,
    marginBottom: 14,
  },
  seg: { flex: 1, minHeight: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  segOn: { backgroundColor: colors.surface, ...shadow.card },
  segText: { fontSize: 14, fontWeight: '700', color: colors.textMuted },
  segTextOn: { color: colors.text },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 36, paddingHorizontal: 28 },
  emptyArt: { width: 180, height: 180 },
  emptyIcon: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.text,
    marginTop: 14,
    textAlign: 'center',
  },
  emptyNote: {
    fontSize: 14,
    color: colors.textMuted,
    marginTop: 6,
    textAlign: 'center',
    lineHeight: 20,
  },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 18,
    minHeight: 64,
    ...shadow.card,
    shadowOpacity: 0.04,
  },
  listTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  listSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  listRight: { fontSize: 15, fontWeight: '800', color: colors.text },
  searchRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    minHeight: 52,
  },
  search: { flex: 1, paddingVertical: 12, fontSize: 16, color: colors.text },
  scanBtn: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
    height: 56,
    paddingHorizontal: 20,
    borderRadius: 18,
    backgroundColor: colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    ...shadow.raised,
  },
  fabText: { color: colors.onPrimary, fontWeight: '700', fontSize: 15 },
  tabHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 12,
    backgroundColor: colors.background,
    gap: 12,
    width: '100%',
    maxWidth: CONTENT_MAX,
    alignSelf: 'center',
  },
  desktopTabHeader: { maxWidth: DESKTOP_CONTENT_MAX, paddingBottom: 20 },
  column: { width: '100%', maxWidth: CONTENT_MAX - 40, alignSelf: 'center' },
  desktopColumn: { maxWidth: DESKTOP_CONTENT_MAX - 64 },
  hero: { borderRadius: radius.xl, padding: 18, marginBottom: 12 },
  heroLabel: { fontSize: 13, fontWeight: '700' },
  heroValue: { fontSize: 32, fontWeight: '800', letterSpacing: -0.4, marginTop: 2 },
  heroSub: { fontSize: 13, color: '#3D4C43', marginTop: 4, lineHeight: 18 },
  heroArt: { width: 96, height: 96 },
  qaRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 8, gap: 4 },
  qa: { flex: 1, alignItems: 'center', gap: 6, minHeight: 80, paddingVertical: 4 },
  qaIcon: {
    width: 54,
    height: 54,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow.card,
  },
  qaText: { fontSize: 12, fontWeight: '700', color: colors.text, textAlign: 'center' },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    minHeight: 60,
  },
  entryIcon: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  entryTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  entrySub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  entryAmt: { fontSize: 15, fontWeight: '800' },
  stats: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  stat: { borderRadius: radius.lg, paddingVertical: 12, paddingHorizontal: 14 },
  statLabel: { fontSize: 12, fontWeight: '700' },
  statValue: { fontSize: 19, fontWeight: '800', color: colors.text, marginTop: 2 },
  group: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingHorizontal: 14,
    marginBottom: 12,
    ...shadow.card,
  },
  groupDivider: { borderTopWidth: 1, borderTopColor: '#EEF3EF' },
  formHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    padding: 14,
    marginBottom: 18,
  },
  formArt: {
    width: 64,
    height: 64,
    borderRadius: 18,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  formTitle: { fontSize: 17, fontWeight: '800', color: colors.text },
  formNote: { fontSize: 13, color: '#3D4C43', marginTop: 2, lineHeight: 18 },
  page: {
    flex: 1,
    width: '100%',
    maxWidth: CONTENT_MAX,
    alignSelf: 'center',
    paddingHorizontal: 20,
  },
  tabTitle: { fontSize: 26, fontWeight: '800', color: colors.text, letterSpacing: -0.3 },
  tabSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  tabAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: colors.primary,
  },
  tabActionText: { color: colors.onPrimary, fontWeight: '700', fontSize: 14 },
});
