import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { buildCustomerPayload, validateCustomerForm } from '@ksms/validation';
import { postData } from '@/api/client';
import { Button, ErrorText, Field, Screen } from '@/components/ui';
import { friendlyError } from '@/utils/errors';

export default function NewCustomerScreen() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const form = { name, phone, creditLimit };
    const problem = validateCustomerForm(form);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      await postData('/customers', buildCustomerPayload(form));
      router.back();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <Screen footer={<Button title="Save customer" onPress={save} busy={busy} />}>
      <Stack.Screen options={{ title: 'Add customer' }} />
      <Field
        label="Name"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        placeholder="e.g. Lakshmi"
      />
      <Field
        label="Mobile number (optional)"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="10-digit number"
      />
      <Field
        label="Credit limit ₹ (optional)"
        value={creditLimit}
        onChangeText={setCreditLimit}
        keyboardType="decimal-pad"
        placeholder="e.g. 5000"
        hint="The most this customer may owe on khata. Leave empty for no limit."
      />
      <ErrorText message={error} />
    </Screen>
  );
}
