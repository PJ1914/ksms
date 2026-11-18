import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '@/auth/session';
import { Button, Choice, ErrorText, Field } from '@/components/ui';
import { colors } from '@/theme/colors';
import { friendlyError } from '@/utils/errors';
import {
  SELL_BY,
  type SellBy,
  type UnitRow,
  buildProductPayload,
  validateProductForm,
} from '@ksms/validation';

const GST_RATES = [
  { key: 'NONE', label: 'No GST' },
  { key: '5', label: '5%' },
  { key: '12', label: '12%' },
  { key: '18', label: '18%' },
  { key: '28', label: '28%' },
] as const;

export default function NewProductScreen() {
  const [name, setName] = useState('');
  const [sellBy, setSellBy] = useState<SellBy>('KG');
  const [price, setPrice] = useState('');
  const [gstRate, setGstRate] = useState<string>('NONE');
  const [hsnCode, setHsnCode] = useState('');
  const [units, setUnits] = useState<UnitRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ data: UnitRow[] }>('/units')
      .then((r) => setUnits(r.data))
      .catch((e) => setError(friendlyError(e)));
  }, []);

  const unitLabel = sellBy === 'KG' ? '1 kg' : sellBy === 'L' ? '1 litre' : '1 piece';

  async function save() {
    const input = {
      name,
      sellBy,
      price,
      isTaxable: gstRate !== 'NONE',
      gstRatePercent: gstRate !== 'NONE' ? gstRate : '',
      hsnCode,
    };
    const problem = validateProductForm(input);
    if (problem) return setError(problem);
    if (!units) return setError('Still loading units. Please wait a moment.');
    setBusy(true);
    setError(null);
    try {
      await api.post('/products', buildProductPayload(input, units));
      router.back();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Field
        label="Product name"
        value={name}
        onChangeText={setName}
        placeholder="e.g. Sona Masoori Rice"
        autoCapitalize="words"
      />

      <Text style={styles.label}>Sold</Text>
      <View style={styles.choices}>
        {SELL_BY.map((s) => {
          const selected = s.key === sellBy;
          return (
            <Pressable
              key={s.key}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              onPress={() => setSellBy(s.key)}
              style={[styles.choice, selected && styles.choiceSelected]}
            >
              <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>
                {s.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <Field
        label={`Selling price for ${unitLabel} (₹)`}
        value={price}
        onChangeText={setPrice}
        keyboardType="decimal-pad"
        placeholder="e.g. 52.50"
      />

      <Choice
        label="GST rate (when shop GST is on)"
        options={GST_RATES}
        value={gstRate}
        onChange={setGstRate}
      />

      <Field
        label="HSN code (optional, 4-8 digits)"
        value={hsnCode}
        onChangeText={setHsnCode}
        keyboardType="number-pad"
        placeholder="e.g. 1006"
        maxLength={8}
      />

      <Text style={styles.note}>
        Bags, cartons and barcodes can be added later from the full product screen.
      </Text>
      <ErrorText message={error} />
      <Button title="Save product" onPress={save} busy={busy} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16 },
  label: { fontSize: 14, fontWeight: '500', color: colors.text, marginBottom: 6 },
  choices: { gap: 8, marginBottom: 14 },
  choice: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  choiceSelected: { borderColor: colors.primary, backgroundColor: '#E6F1EC' },
  choiceText: { fontSize: 15, color: colors.text },
  choiceTextSelected: { color: colors.primary, fontWeight: '600' },
  note: { fontSize: 13, color: colors.textMuted, marginBottom: 12 },
});
