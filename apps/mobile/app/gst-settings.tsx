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
        });
      }
      if (can('organization.manage')) {
        await patchData('/organization', {
          gstEnabled: on,
          defaultTaxMode,
          ...(legalName.trim().length >= 2 ? { legalName: legalName.trim() } : {}),
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
          <Button title="Save GST settings" onPress={() => void save()} busy={busy} />
        ) : undefined
      }
    >
      <Stack.Screen options={{ title: 'GST & Billing Settings' }} />
      <FormHeader
        art={icons.gstInvoice}
        title="GST & billing"
        note="These settings decide the tax on every new bill."
      />

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
              label="Branch address (shown on invoice)"
              value={addressLine}
              onChangeText={setAddressLine}
              placeholder="Street, area, city"
            />
          </Card>
        </>
      ) : null}

      <ErrorText message={problem} />
    </Screen>
  );
}
