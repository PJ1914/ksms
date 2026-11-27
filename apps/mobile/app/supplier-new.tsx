import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { buildSupplierPayload, validateSupplierForm } from '@ksms/validation';
import { postData } from '@/api/client';
import { Button, ErrorText, Field, FormHeader, Screen } from '@/components/ui';
import { icons } from '@/theme/art';
import { friendlyError } from '@/utils/errors';

export default function NewSupplierScreen() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const form = { name, phone, contactPerson, openingBalance };
    const problem = validateSupplierForm(form);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      await postData('/suppliers', buildSupplierPayload(form));
      router.back();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  return (
    <Screen footer={<Button title="Save supplier" onPress={save} busy={busy} />}>
      <Stack.Screen options={{ title: 'Add supplier' }} />
      <FormHeader
        art={icons.addSupplier}
        title="New supplier"
        note="Who you buy from. You can record purchases and payments after."
      />
      <Field
        label="Supplier name"
        value={name}
        onChangeText={setName}
        autoCapitalize="words"
        placeholder="e.g. Sri Ganesh Traders"
      />
      <Field
        label="Contact person (optional)"
        value={contactPerson}
        onChangeText={setContactPerson}
        autoCapitalize="words"
      />
      <Field
        label="Mobile number (optional)"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        placeholder="10-digit number"
      />
      <Field
        label="Already owed to them ₹ (optional)"
        value={openingBalance}
        onChangeText={setOpeningBalance}
        keyboardType="decimal-pad"
        hint="What you owed this supplier before you started using Yapaaram."
      />
      <ErrorText message={error} />
    </Screen>
  );
}
