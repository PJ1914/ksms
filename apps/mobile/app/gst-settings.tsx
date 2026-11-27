import { router, Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { getData, patchData } from '@/api/client';
import type { BranchDetail, OrganizationSettings } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import {
  Button,
  Card,
  Choice,
  ErrorText,
  Field,
  FormHeader,
  Loading,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { icons } from '@/theme/art';
import { useLoad } from '@/hooks/useLoad';
import { friendlyError } from '@/utils/errors';

const GST_TOGGLE = [
  { key: 'OFF', label: 'Off (Normal retail bills)' },
  { key: 'ON', label: 'On (GST Tax Invoices)' },
] as const;

const TAX_MODES = [
  { key: 'INCLUSIVE', label: 'Tax included in price' },
  { key: 'EXCLUSIVE', label: 'Tax added on top' },
] as const;

export default function GstSettingsScreen() {
  const { branch, can } = useAuth();
  const { data, loading, error, reload } = useLoad(async () => {
    const [org, branches] = await Promise.all([
      getData<OrganizationSettings>('/organization'),
      can('branch.read') ? getData<BranchDetail[]>('/branches') : Promise.resolve([]),
    ]);
    const activeBranch = branches.find((b) => b.id === branch?.id) ?? branches[0] ?? null;
    return { org, activeBranch };
  }, [branch?.id]);

  const [gstEnabled, setGstEnabled] = useState<'ON' | 'OFF'>('OFF');
  const [defaultTaxMode, setDefaultTaxMode] = useState<'INCLUSIVE' | 'EXCLUSIVE'>('INCLUSIVE');
  const [legalName, setLegalName] = useState('');
  const [gstin, setGstin] = useState('');
  const [stateCode, setStateCode] = useState('');
  const [addressLine, setAddressLine] = useState('');
  const [shopName, setShopName] = useState('');
  const [shopPhone, setShopPhone] = useState('');
  const [shopEmail, setShopEmail] = useState('');
  const [city, setCity] = useState('');
  const [stateName, setStateName] = useState('');
  const [pincode, setPincode] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setGstEnabled(data.org.gstEnabled ? 'ON' : 'OFF');
    setDefaultTaxMode(data.org.defaultTaxMode);
    setLegalName(data.org.legalName ?? '');
    setGstin(data.activeBranch?.gstin ?? '');
    setStateCode(data.activeBranch?.stateCode ?? '');
    setAddressLine(data.activeBranch?.addressLine ?? '');
    setShopName(data.org.name);
    setShopPhone(data.activeBranch?.phone ?? data.org.phone ?? '');
    setShopEmail(data.org.email ?? '');
    setCity(data.activeBranch?.city ?? '');
    setStateName(data.activeBranch?.state ?? '');
    setPincode(data.activeBranch?.pincode ?? '');
  }, [data]);

  if (loading) return <Loading />;
  if (!data) return <ErrorText message={error ?? 'Could not load shop settings.'} />;

  async function save() {
    const on = gstEnabled === 'ON';
    const cleanGstin = gstin.trim().toUpperCase();
    const cleanState = stateCode.trim() || (cleanGstin ? cleanGstin.slice(0, 2) : '');
    if (on && (!cleanGstin || !cleanState)) {
      return setProblem(
        'Enter the branch 15-character GSTIN and 2-digit state code before turning GST on.',
      );
    }
    setBusy(true);
    setProblem(null);
    try {
      if (can('branch.manage') && data?.activeBranch) {
        await patchData(`/branches/${data.activeBranch.id}`, {
          ...(cleanGstin ? { gstin: cleanGstin } : {}),
          ...(cleanState ? { stateCode: cleanState } : {}),
          ...(addressLine.trim() ? { addressLine: addressLine.trim() } : {}),
          ...(city.trim() ? { city: city.trim() } : {}),
          ...(stateName.trim() ? { state: stateName.trim() } : {}),
          ...(pincode.trim() ? { pincode: pincode.trim() } : {}),
          ...(shopPhone.trim() ? { phone: shopPhone.trim() } : {}),
        });
      }
      if (can('organization.manage')) {
        await patchData('/organization', {
          gstEnabled: on,
          defaultTaxMode,
          ...(legalName.trim().length >= 2 ? { legalName: legalName.trim() } : {}),
          ...(shopName.trim().length >= 2 ? { name: shopName.trim() } : {}),
          ...(shopEmail.trim() ? { email: shopEmail.trim() } : {}),
        });
      }
      await reload();
      router.back();
    } catch (e) {
      setProblem(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      footer={
        can('organization.manage') ? (
          <Button title="Save shop details" onPress={() => void save()} busy={busy} />
        ) : undefined
      }
    >
      <Stack.Screen options={{ title: 'Shop & bill details' }} />
      <FormHeader
        art={icons.gstInvoice}
        title="Shop & bill details"
        note="This is printed at the top of every bill."
      />

      <SectionTitle>Shop details (printed on the bill)</SectionTitle>
      <Card>
        <Field
          label="Shop name"
          value={shopName}
          onChangeText={setShopName}
          placeholder="e.g. Sri Lakshmi Kirana Store"
        />
        <Field
          label="Shop phone"
          value={shopPhone}
          onChangeText={setShopPhone}
          keyboardType="number-pad"
          placeholder="10-digit mobile number"
          maxLength={10}
        />
        <Field
          label="Email (optional)"
          value={shopEmail}
          onChangeText={setShopEmail}
          autoCapitalize="none"
          placeholder="shop@example.com"
        />
      </Card>

      <SectionTitle>Shop GST</SectionTitle>
      <Card>
        <Choice
          label="GST billing"
          options={GST_TOGGLE}
          value={gstEnabled}
          onChange={setGstEnabled}
        />
        <Choice
          label="Default product price mode"
          options={TAX_MODES}
          value={defaultTaxMode}
          onChange={setDefaultTaxMode}
        />
        <Field
          label="Legal / registered business name (optional)"
          value={legalName}
          onChangeText={setLegalName}
          placeholder={data.org.name}
        />
      </Card>

      {data.activeBranch ? (
        <>
          <SectionTitle>{`Branch GST (${data.activeBranch.name})`}</SectionTitle>
          <Card>
            <Field
              label="Branch GSTIN (15 characters)"
              value={gstin}
              onChangeText={(v) => {
                setGstin(v);
                if (v.trim().length >= 2 && !stateCode.trim()) {
                  setStateCode(v.trim().slice(0, 2));
                }
              }}
              autoCapitalize="characters"
              placeholder="e.g. 36AABCU9603R1ZM"
              maxLength={15}
            />
            <Field
              label="2-digit GST state code"
              value={stateCode}
              onChangeText={setStateCode}
              keyboardType="number-pad"
              placeholder="e.g. 36 for Telangana"
              maxLength={2}
            />
            <Field
              label="Shop address (shown on the bill)"
              value={addressLine}
              onChangeText={setAddressLine}
              placeholder="Shop no, street, area"
            />
            <Field
              label="City / town"
              value={city}
              onChangeText={setCity}
              placeholder="e.g. Hyderabad"
            />
            <Field
              label="State"
              value={stateName}
              onChangeText={setStateName}
              placeholder="e.g. Telangana"
            />
            <Field
              label="Pincode"
              value={pincode}
              onChangeText={setPincode}
              keyboardType="number-pad"
              placeholder="6 digits"
              maxLength={6}
            />
          </Card>
        </>
      ) : null}

      <ErrorText message={problem} />
    </Screen>
  );
}
