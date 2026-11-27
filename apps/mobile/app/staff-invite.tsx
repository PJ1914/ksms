import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { Share, Text, View } from 'react-native';
import { normalizeIndianPhone } from '@ksms/validation';
import { getData, postData } from '@/api/client';
import type { BranchInfo, CreatedInvitation, RoleInfo } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { MultiChoice } from '@/components/MultiChoice';
import { Button, Card, Choice, ErrorText, Field, Loading, Screen } from '@/components/ui';
import { useLoad } from '@/hooks/useLoad';
import { colors } from '@/theme/colors';
import { friendlyError } from '@/utils/errors';
import { formatDateTime } from '@/utils/format';
import { summarizeRole } from '@/utils/permissions';

/** Invite a person: the server makes a one-time code that the owner shares with them. */
export default function InviteStaffScreen() {
  const { profile, branch } = useAuth();
  const roles = useLoad(
    () =>
      getData<RoleInfo[]>('/roles').then((r) =>
        r.filter((x) => !(x.isSystem && x.name === 'Owner')),
      ),
    [],
  );
  const branches = useLoad(
    () => getData<BranchInfo[]>('/branches').then((b) => b.filter((x) => x.isActive !== false)),
    [],
  );

  const [phone, setPhone] = useState('');
  const [roleId, setRoleId] = useState('');
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<CreatedInvitation | null>(null);

  // start on the first role (Manager) and the branch the owner is working in
  useEffect(() => {
    if (!roleId && roles.data?.[0]) setRoleId(roles.data[0].id);
  }, [roles.data, roleId]);
  useEffect(() => {
    if (branchIds.length === 0 && branch) setBranchIds([branch.id]);
  }, [branch, branchIds.length]);

  if (roles.loading || branches.loading) return <Loading />;
  const chosen = roles.data?.find((r) => r.id === roleId);
  const shop = profile?.organization.name ?? 'the shop';

  async function invite() {
    const normalized = normalizeIndianPhone(phone);
    if (!normalized) return setError('Enter a valid 10-digit mobile number.');
    if (!roleId) return setError('Choose a role.');
    if (branchIds.length === 0) return setError('Pick at least one branch.');
    setBusy(true);
    setError(null);
    try {
      setCreated(
        await postData<CreatedInvitation>('/invitations', { phone: normalized, roleId, branchIds }),
      );
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  function share(c: CreatedInvitation) {
    void Share.share({
      message:
        `You are invited to work at ${shop}.\n` +
        `1. Open the app and tap "I have an invitation code".\n` +
        `2. Enter this code: ${c.code}\n` +
        `The code works once and ends on ${formatDateTime(c.expiresAt)}.`,
    });
  }

  if (created) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Invitation ready' }} />
        <Card>
          <Text style={{ color: colors.textMuted, marginBottom: 6 }}>Code for {created.phone}</Text>
          <Text
            selectable
            style={{
              fontSize: 30,
              fontWeight: '800',
              letterSpacing: 2,
              color: colors.text,
              marginBottom: 8,
            }}
          >
            {created.code}
          </Text>
          <Text style={{ color: colors.textMuted }}>
            Shown only now, so share it before you leave this screen. It works once and ends on{' '}
            {formatDateTime(created.expiresAt)}.
          </Text>
        </Card>
        <Button title="Share the code" icon="share-social-outline" onPress={() => share(created)} />
        <Button
          title="Invite another person"
          variant="secondary"
          onPress={() => {
            setCreated(null);
            setPhone('');
          }}
        />
      </Screen>
    );
  }

  return (
    <Screen
      footer={<Button title="Create the code" icon="key-outline" onPress={invite} busy={busy} />}
    >
      <Stack.Screen options={{ title: 'Invite someone' }} />
      <Field
        label="Their mobile number"
        value={phone}
        onChangeText={setPhone}
        keyboardType="phone-pad"
        maxLength={14}
        placeholder="10-digit mobile number"
      />
      <Choice
        label="Role"
        options={(roles.data ?? []).map((r) => ({ key: r.id, label: r.name }))}
        value={roleId}
        onChange={setRoleId}
      />
      {chosen ? (
        <View style={{ marginBottom: 14 }}>
          <Text style={{ color: colors.textMuted }}>
            {chosen.description ? `${chosen.description}. ` : ''}
            Covers: {summarizeRole(chosen.permissions).join(', ') || 'nothing yet'}.
          </Text>
        </View>
      ) : null}
      <MultiChoice
        label="Branches they can work in"
        options={(branches.data ?? []).map((b) => ({ key: b.id, label: b.name }))}
        value={branchIds}
        onChange={setBranchIds}
        note="The first branch ticked is the one they start in."
      />
      <ErrorText message={error} />
    </Screen>
  );
}
