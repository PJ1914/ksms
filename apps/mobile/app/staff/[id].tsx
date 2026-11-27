import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { getData, patchData } from '@/api/client';
import type { BranchInfo, Employee, RoleInfo } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { api } from '@/auth/session';
import { MultiChoice } from '@/components/MultiChoice';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Choice,
  ErrorText,
  KeyValue,
  Loading,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { useLoad } from '@/hooks/useLoad';
import { colors } from '@/theme/colors';
import { friendlyError } from '@/utils/errors';
import { formatDateTime } from '@/utils/format';
import { summarizeRole } from '@/utils/permissions';

/** One person: change their role and branches, switch them off, or unlock their login. */
export default function StaffDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can, profile } = useAuth();
  const canManage = can('employee.manage');
  const canSeeRoles = can('role.read');

  const person = useLoad(() => getData<Employee>(`/employees/${id}`), [id]);
  const roles = useLoad(
    () => (canSeeRoles ? getData<RoleInfo[]>('/roles') : Promise.resolve([] as RoleInfo[])),
    [canSeeRoles],
  );
  const branches = useLoad(
    () =>
      can('branch.read')
        ? getData<BranchInfo[]>('/branches').then((b) => b.filter((x) => x.isActive !== false))
        : Promise.resolve([] as BranchInfo[]),
    [],
  );

  const [roleId, setRoleId] = useState('');
  const [branchIds, setBranchIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const emp = person.data;
  useEffect(() => {
    if (!emp) return;
    setRoleId(emp.role.id);
    setBranchIds(emp.branches.map((b) => b.id));
  }, [emp]);

  if (person.loading) return <Loading />;
  if (!emp) return <ErrorText message={person.error ?? 'Could not load this person.'} />;
  const e = emp;

  const assignable = (roles.data ?? []).filter((r) => !(r.isSystem && r.name === 'Owner'));
  const chosenRole = assignable.find((r) => r.id === roleId);
  const sameBranches =
    branchIds.length === e.branches.length && e.branches.every((b) => branchIds.includes(b.id));
  const changed = roleId !== e.role.id || !sameBranches;
  const isMe = e.user.id === profile?.user.id;
  const editable = canManage && !e.isOwner && !isMe;
  const off = e.status !== 'ACTIVE';

  async function run(action: () => Promise<unknown>, done: string) {
    setBusy(true);
    setProblem(null);
    setNote(null);
    try {
      await action();
      setNote(done);
      await person.reload();
    } catch (err) {
      setProblem(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    if (branchIds.length === 0) return setProblem('Pick at least one branch.');
    void run(
      () =>
        patchData(`/employees/${id}`, {
          ...(roleId !== e.role.id ? { roleId } : {}),
          ...(!sameBranches ? { branchIds } : {}),
        }),
      'Saved. The change applies to them right away.',
    );
  }

  function switchOff() {
    Alert.alert(
      `Switch off ${e.user.fullName}?`,
      'They are signed out at once and cannot sign in until you switch them on again. Their past bills stay as they are.',
      [
        { text: 'Keep them on', style: 'cancel' },
        {
          text: 'Switch off',
          style: 'destructive',
          onPress: () =>
            void run(() => api.post(`/employees/${id}/deactivate`, {}), 'Switched off.'),
        },
      ],
    );
  }

  return (
    <Screen
      onRefresh={() => void person.reload(true)}
      refreshing={person.refreshing}
      footer={
        editable && !off && changed ? (
          <Button title="Save changes" icon="checkmark" onPress={save} busy={busy} />
        ) : undefined
      }
    >
      <Stack.Screen options={{ title: e.user.fullName }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <Avatar name={e.user.fullName} size={56} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>
            {e.user.fullName}
          </Text>
          <Text style={{ fontSize: 14, color: colors.textMuted }}>
            {e.user.phone ?? 'No mobile number'}
          </Text>
        </View>
        {e.isOwner ? <Badge text="Owner" tone="good" /> : null}
        {off ? <Badge text="Switched off" tone="warn" /> : null}
      </View>

      <Card>
        <KeyValue label="Role" value={e.role.name} bold />
        <KeyValue label="Branches" value={e.branches.map((b) => b.name).join(', ') || 'None'} />
        <KeyValue
          label="Last signed in"
          value={e.user.lastLoginAt ? formatDateTime(e.user.lastLoginAt) : 'Never'}
        />
        <KeyValue label="Joined" value={formatDateTime(e.createdAt)} />
      </Card>

      {e.isOwner ? (
        <Text style={{ color: colors.textMuted, marginTop: 8 }}>
          The owner always has full access and cannot be changed.
        </Text>
      ) : isMe ? (
        <Text style={{ color: colors.textMuted, marginTop: 8 }}>
          You cannot change or switch off your own account.
        </Text>
      ) : null}

      {editable && !off ? (
        <>
          <SectionTitle>What they can do</SectionTitle>
          {assignable.length > 0 ? (
            <>
              <Choice
                label="Role"
                options={assignable.map((r) => ({ key: r.id, label: r.name }))}
                value={roleId}
                onChange={setRoleId}
              />
              {chosenRole ? (
                <Text style={{ color: colors.textMuted, marginBottom: 14 }}>
                  {chosenRole.description ? `${chosenRole.description}. ` : ''}
                  Covers: {summarizeRole(chosenRole.permissions).join(', ') || 'nothing yet'}.
                </Text>
              ) : null}
            </>
          ) : null}
          {(branches.data ?? []).length > 0 ? (
            <MultiChoice
              label="Branches they can work in"
              options={(branches.data ?? []).map((b) => ({ key: b.id, label: b.name }))}
              value={branchIds}
              onChange={setBranchIds}
              note="The first branch ticked is the one they start in."
            />
          ) : null}
        </>
      ) : null}

      <ErrorText message={problem} />
      {note ? <Text style={{ color: colors.success, marginBottom: 8 }}>{note}</Text> : null}

      {editable ? (
        <View style={{ gap: 10, marginTop: 8 }}>
          {off ? (
            <Button
              title="Switch on again"
              icon="play-circle-outline"
              onPress={() =>
                void run(() => api.post(`/employees/${id}/reactivate`, {}), 'Switched on.')
              }
              busy={busy}
            />
          ) : (
            <>
              <Button
                title="Unlock sign-in"
                icon="lock-open-outline"
                variant="secondary"
                onPress={() =>
                  void run(
                    () => api.post(`/employees/${id}/unlock-login`, {}),
                    'Unlocked. They can try signing in again.',
                  )
                }
                busy={busy}
              />
              <Button
                title="Switch off"
                icon="pause-circle-outline"
                variant="danger"
                onPress={switchOff}
                busy={busy}
              />
            </>
          )}
        </View>
      ) : null}
    </Screen>
  );
}
