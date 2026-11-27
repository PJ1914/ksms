import { Stack } from 'expo-router';
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MAX_FONT_SCALE } from '@/components/ui';
import { colors } from '@/theme/colors';
import {
  addGst,
  backspace,
  changeDue,
  evaluate,
  formatNumber,
  prettyExpression,
  pressKey,
  removeGst,
  resultToExpr,
  type GstBreakup,
  type Key,
} from '@/utils/calc';
import { formatINR } from '@/utils/currency';
import { haptic } from '@/utils/haptics';

type Cell =
  | { label: string; key: Key; kind?: 'op' | 'num' }
  | { label: string; action: 'clear' | 'back' | 'equals'; kind: 'fn' | 'equals' };

const ROWS: Cell[][] = [
  [
    { label: 'C', action: 'clear', kind: 'fn' },
    { label: '⌫', action: 'back', kind: 'fn' },
    { label: '%', key: '%', kind: 'op' },
    { label: '÷', key: '÷', kind: 'op' },
  ],
  [
    { label: '7', key: '7' },
    { label: '8', key: '8' },
    { label: '9', key: '9' },
    { label: '×', key: '×', kind: 'op' },
  ],
  [
    { label: '4', key: '4' },
    { label: '5', key: '5' },
    { label: '6', key: '6' },
    { label: '−', key: '-', kind: 'op' },
  ],
  [
    { label: '1', key: '1' },
    { label: '2', key: '2' },
    { label: '3', key: '3' },
    { label: '+', key: '+', kind: 'op' },
  ],
  [
    { label: '00', key: '00' },
    { label: '0', key: '0' },
    { label: '.', key: '.' },
    { label: '=', action: 'equals', kind: 'equals' },
  ],
];

const GST_RATES = [5, 12, 18, 28] as const;
const HISTORY_MAX = 20;

interface Entry {
  expr: string;
  result: string;
}

/** A quick shop calculator: shop-style percentages, GST add/remove, change to give back, and a tape. */
export default function CalculatorScreen() {
  const insets = useSafeAreaInsets();
  const [expr, setExpr] = useState('');
  const [done, setDone] = useState(false); // the last press was "="
  const [history, setHistory] = useState<Entry[]>([]);
  const [rate, setRate] = useState<number>(18);
  const [gst, setGst] = useState<{ mode: 'add' | 'remove'; b: GstBreakup } | null>(null);
  const [given, setGiven] = useState('');
  // true: the keypad types the cash the customer hands over, instead of the sum (no phone keyboard needed)
  const [typingGiven, setTypingGiven] = useState(false);

  const res = evaluate(expr);
  const value = res.ok ? res.value : null;
  const hasOperation = /[0-9.]%|[+\-×÷]/.test(expr.replace(/^-/, ''));

  function pressGiven(key: Key) {
    if (!/^[0-9.]/.test(key)) return; // only digits and a dot make sense here
    haptic('tap');
    setGiven((g) => {
      if (key === '.') return g.includes('.') ? g : (g === '' ? '0' : g) + '.';
      if (g.replace('.', '').length >= 9) return g;
      if (g === '0') return key === '0' || key === '00' ? g : key;
      return g === '' && key === '00' ? '0' : g + key;
    });
  }

  function press(key: Key) {
    if (typingGiven) return pressGiven(key);
    haptic('tap');
    setGst(null);
    const isDigit = /^[0-9.]/.test(key);
    setExpr((e) => pressKey(done && isDigit ? '' : e, key));
    setDone(false);
  }

  function clearAll() {
    haptic('tap');
    if (typingGiven) return setGiven('');
    setExpr('');
    setDone(false);
    setGst(null);
    setGiven('');
  }

  function equals() {
    if (typingGiven) {
      haptic('success');
      setTypingGiven(false);
      return;
    }
    if (!value || !hasOperation) return;
    haptic('success');
    const shown = formatNumber(value);
    setHistory((h) =>
      [{ expr: prettyExpression(expr), result: shown }, ...h].slice(0, HISTORY_MAX),
    );
    setExpr(resultToExpr(value));
    setDone(true);
    setGst(null);
  }

  function onCell(c: Cell) {
    if ('key' in c) return press(c.key);
    if (c.action === 'clear') return clearAll();
    if (c.action === 'back') {
      haptic('tap');
      if (typingGiven) return setGiven((g) => g.slice(0, -1));
      setGst(null);
      setExpr((e) => (done ? '' : backspace(e)));
      setDone(false);
      return;
    }
    equals();
  }

  function applyGst(mode: 'add' | 'remove') {
    if (!value) return;
    haptic('tap');
    const b = mode === 'add' ? addGst(value, rate) : removeGst(value, rate);
    setGst({ mode, b });
  }

  const mainText =
    expr === '' ? '0' : value !== null ? formatNumber(value) : res.ok ? '0' : "Can't divide by 0";
  const small = expr === '' ? ' ' : hasOperation && !done ? prettyExpression(expr) : ' ';
  const change = value && given.trim() !== '' ? changeDue(value, given.trim()) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ title: 'Calculator' }} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, paddingBottom: 8, gap: 12 }}
        keyboardShouldPersistTaps="handled"
      >
        {/* display */}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to the sum"
          onPress={() => setTypingGiven(false)}
          style={{
            backgroundColor: colors.surface,
            borderRadius: 18,
            borderWidth: 1.5,
            borderColor: colors.border,
            padding: 16,
            alignItems: 'flex-end',
            gap: 4,
          }}
        >
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            style={{ fontSize: 16, color: colors.textMuted, minHeight: 22 }}
          >
            {small}
          </Text>
          <Text
            numberOfLines={1}
            adjustsFontSizeToFit
            maxFontSizeMultiplier={MAX_FONT_SCALE}
            accessibilityLiveRegion="polite"
            style={{
              fontSize: 44,
              fontWeight: '800',
              color: value === null && expr !== '' ? colors.danger : colors.text,
              maxWidth: '100%',
            }}
          >
            {mainText}
          </Text>
        </Pressable>

        {/* GST */}
        {value ? (
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 14,
              borderWidth: 1.5,
              borderColor: colors.border,
              padding: 12,
              gap: 10,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#3D4C43' }}>
              GST on this amount
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {GST_RATES.map((r) => (
                <Pressable
                  key={r}
                  accessibilityRole="button"
                  accessibilityState={{ selected: rate === r }}
                  onPress={() => {
                    haptic('tap');
                    setRate(r);
                    setGst(null);
                  }}
                  style={{
                    flex: 1,
                    minHeight: 40,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 999,
                    borderWidth: 1.5,
                    borderColor: rate === r ? colors.text : colors.border,
                    backgroundColor: rate === r ? colors.text : colors.surface,
                  }}
                >
                  <Text
                    style={{
                      fontWeight: '700',
                      color: rate === r ? colors.surface : colors.text,
                    }}
                  >
                    {r}%
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Tool label={`Add ${rate}% GST`} onPress={() => applyGst('add')} />
              <Tool label={`Remove ${rate}% GST`} onPress={() => applyGst('remove')} />
            </View>
            {gst ? (
              <View style={{ gap: 4 }}>
                <Line
                  label={gst.mode === 'add' ? 'Price without GST' : 'Price without GST'}
                  value={formatINR(gst.b.taxable)}
                />
                <Line label={`CGST ${rate / 2}%`} value={formatINR(gst.b.cgst)} />
                <Line label={`SGST ${rate / 2}%`} value={formatINR(gst.b.sgst)} />
                <Line label="Price with GST" value={formatINR(gst.b.total)} bold />
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    haptic('tap');
                    setExpr(gst.mode === 'add' ? gst.b.total : gst.b.taxable);
                    setDone(true);
                    setGst(null);
                  }}
                  style={{ minHeight: 40, justifyContent: 'center' }}
                >
                  <Text style={{ color: colors.primary, fontWeight: '700' }}>
                    {gst.mode === 'add' ? 'Use the price with GST' : 'Use the price without GST'}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* change to give back */}
        {value && value.gt(0) ? (
          <View
            style={{
              backgroundColor: colors.surface,
              borderRadius: 14,
              borderWidth: 1.5,
              borderColor: colors.border,
              padding: 12,
            }}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#3D4C43', marginBottom: 8 }}>
              Customer gives (₹)
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Type the cash the customer gives"
              onPress={() => {
                haptic('tap');
                setTypingGiven(true);
              }}
              style={{
                minHeight: 52,
                justifyContent: 'center',
                paddingHorizontal: 14,
                borderRadius: 12,
                borderWidth: 1.5,
                borderColor: typingGiven ? colors.primary : colors.border,
                backgroundColor: typingGiven ? colors.primarySoft : colors.surface,
                marginBottom: 8,
              }}
            >
              <Text
                style={{
                  fontSize: 18,
                  fontWeight: given ? '700' : '400',
                  color: given ? colors.text : colors.textMuted,
                }}
              >
                {given ? formatNumber(given) : 'Tap here, then use the keypad'}
              </Text>
            </Pressable>
            {typingGiven ? (
              <Text style={{ fontSize: 12, color: colors.textMuted, marginBottom: 6 }}>
                Typing the cash given. Press = when done.
              </Text>
            ) : null}
            {change !== null ? (
              <Text
                style={{
                  fontSize: 20,
                  fontWeight: '800',
                  color: change.startsWith('-') ? colors.danger : colors.success,
                }}
              >
                {change.startsWith('-')
                  ? `Still to pay ${formatINR(change.slice(1))}`
                  : `Give back ${formatINR(change)}`}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* tape */}
        {history.length > 0 ? (
          <View style={{ gap: 6 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#3D4C43' }}>Earlier</Text>
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => setHistory([])}>
                <Text style={{ color: colors.primary, fontWeight: '700' }}>Clear</Text>
              </Pressable>
            </View>
            {history.map((h, i) => (
              <Pressable
                key={`${i}-${h.expr}`}
                accessibilityRole="button"
                accessibilityLabel={`Use ${h.result}`}
                onPress={() => {
                  haptic('tap');
                  setExpr(h.result.replace(/,/g, ''));
                  setDone(true);
                  setGst(null);
                }}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  paddingVertical: 6,
                }}
              >
                <Text style={{ color: colors.textMuted, flexShrink: 1 }} numberOfLines={1}>
                  {h.expr}
                </Text>
                <Text style={{ fontWeight: '800', color: colors.text }}> = {h.result}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </ScrollView>

      {/* keypad, always in thumb reach */}
      <View
        style={{
          padding: 12,
          paddingBottom: Math.max(insets.bottom, 12),
          gap: 8,
          width: '100%',
          maxWidth: 460,
          alignSelf: 'center',
        }}
      >
        {ROWS.map((row, r) => (
          <View key={r} style={{ flexDirection: 'row', gap: 8 }}>
            {row.map((c) => (
              <KeyButton key={c.label} cell={c} onPress={() => onCell(c)} />
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

function KeyButton({ cell, onPress }: { cell: Cell; onPress: () => void }) {
  const kind = cell.kind ?? 'num';
  const bg =
    kind === 'equals'
      ? colors.primary
      : kind === 'op'
        ? colors.primarySoft
        : kind === 'fn'
          ? colors.surfaceMuted
          : colors.surface;
  const ink = kind === 'equals' ? colors.onPrimary : kind === 'op' ? colors.primary : colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        cell.label === '⌫' ? 'Backspace' : cell.label === 'C' ? 'Clear' : cell.label
      }
      onPress={onPress}
      onLongPress={cell.label === '⌫' ? () => onPress() : undefined}
      style={({ pressed }) => ({
        flex: 1,
        height: 58,
        borderRadius: 16,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
        borderWidth: kind === 'num' ? 1.5 : 0,
        borderColor: colors.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {cell.label === '⌫' ? (
        <Ionicons name="backspace-outline" size={26} color={ink} />
      ) : (
        <Text
          maxFontSizeMultiplier={1.1}
          style={{ fontSize: 26, fontWeight: kind === 'num' ? '600' : '800', color: ink }}
        >
          {cell.label}
        </Text>
      )}
    </Pressable>
  );
}

function Tool({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: 44,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: colors.primarySoft,
      }}
    >
      <Text style={{ color: colors.primary, fontWeight: '800', fontSize: 14 }}>{label}</Text>
    </Pressable>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: colors.textMuted, fontWeight: bold ? '800' : '400' }}>{label}</Text>
      <Text style={{ color: colors.text, fontWeight: bold ? '800' : '600' }}>{value}</Text>
    </View>
  );
}
