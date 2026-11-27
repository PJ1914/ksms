import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { buildCustomerPayload, validateCustomerForm } from '@ksms/validation';
import { postData } from '@/api/client';
import { useCart } from '@/cart/CartProvider';
import { Button, Card, ErrorText, Field, FormHeader, Screen } from '@/components/ui';
import { icons } from '@/theme/art';
import { colors } from '@/theme/colors';
import { friendlyError } from '@/utils/errors';

/**
 * Add a customer. Opened from a bill (`forBill=1`), the new customer is put on that bill and the
 * screen goes straight back to it. A `name` param pre-fills the form (a typed search: digits go to
 * the mobile field, anything else to the name).
 */
export default function NewCustomerScreen() {
  const params = useLocalSearchParams<{ name?: string; forBill?: string }>();
  const typed = (params.name ?? '').trim();
  const typedIsPhone = /^[+\d\s-]{6,}$/.test(typed);
  const forBill = params.forBill === '1';
  const { setCustomer } = useCart();
  const [name, setName] = useState(typedIsPhone ? '' : typed);
  const [phone, setPhone] = useState(typedIsPhone ? typed : '');
  const [creditLimit, setCreditLimit] = useState('');
  const [gstin, setGstin] = useState('');
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const form = { name, phone, creditLimit, gstin };
    const problem = validateCustomerForm(form);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const created = await postData<{ id: string; name: string }>(
        '/customers',
        buildCustomerPayload(form),
      );
      if (forBill) {
        setCustomer(created.id, created.name);
        router.dismissTo('/sale/new');
      } else {
        router.back();
      }
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <Screen
      footer={
        <Button
          title={forBill ? 'Save and use on this bill' : 'Save customer'}
          icon="checkmark"
          onPress={save}
          busy={busy}
        />
      }
    >
      <Stack.Screen options={{ title: 'Add customer' }} />
      <FormHeader
        art={icons.addCustomer}
        title="New customer"
        note="Only the name is needed. Add a mobile number to send reminders."
      />
      <Field
        label="Name"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        placeholder="e.g. Lakshmi"
        autoFocus={!name}
      />
      <Field
        label="Mobile number (optional)"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="10-digit number"
      />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: more }}
        onPress={() => setMore((v) => !v)}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          minHeight: 48,
        }}
      >
        <Text style={{ fontSize: 14, fontWeight: '700', color: colors.primary }}>
          {more ? 'Hide more details' : 'More details: credit limit, GSTIN'}
        </Text>
        <Ionicons name={more ? 'chevron-up' : 'chevron-down'} size={18} color={colors.primary} />
      </Pressable>
      {more ? (
        <Card>
          <Field
            label="Credit limit ₹"
            value={creditLimit}
            onChangeText={setCreditLimit}
            keyboardType="decimal-pad"
            placeholder="e.g. 5000"
            hint="The most this customer may owe on khata. Leave empty for no limit."
          />
          <Field
            label="Customer GSTIN"
            value={gstin}
            onChangeText={setGstin}
            autoCapitalize="characters"
            placeholder="15-character GSTIN for B2B GST bills"
            maxLength={15}
          />
        </Card>
      ) : null}
      <ErrorText message={error} />
    </Screen>
  );
}
