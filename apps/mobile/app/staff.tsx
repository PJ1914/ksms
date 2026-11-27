import { router, Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { getData } from '@/api/client';
import type { Employee, InvitationRow } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { api } from '@/auth/session';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Group,
  ListRow,
  Loading,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { useLoad } from '@/hooks/useLoad';
import { useStaffPref } from '@/prefs/staff-pref';
import { illustrations } from '@/theme/art';
import { friendlyError } from '@/utils/errors';
import { formatDateTime } from '@/utils/format';

/** The people who work in the shop, their roles, and the invitations waiting to be used. */
export default function StaffScreen() {
  const { can, profile } = useAuth();
  const canInvite = can('invitation.manage');
  const isOwner = profile?.role.name === 'Owner';
  const staffPref = useStaffPref(profile?.organization.id);
  const [problem, setProblem] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const people = useLoad(() => getData<Employee[]>('/employees'), []);
  const invites = useLoad(
    () =>
      canInvite
        ? getData<InvitationRow[]>('/invitations').then((r) =>
            r.filter((i) => i.status === 'PENDING'),
          )
        : Promise.resolve([] as InvitationRow[]),
    [canInvite],
  );

  function cancelInvite(inv: InvitationRow) {
    Alert.alert('Cancel this invitation?', `The code sent to ${inv.phone} will stop working.`, [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Cancel invitation',
        style: 'destructive',
        onPress: () => {
          setBusyId(inv.id);
          setProblem(null);
          api
            .post(`/invitations/${inv.id}/revoke`)
            .then(() => invites.reload())
            .catch((e: unknown) => setProblem(friendlyError(e)))
            .finally(() => setBusyId(null));
        },
      },
    ]);
  }

  if (people.loading) return <Loading />;
  const list = people.data ?? [];

  return (
    <Screen
      onRefresh={() => {
        void people.reload(true);
        void invites.reload(true);
      }}
      refreshing={people.refreshing}
    >
      <Stack.Screen options={{ title: 'Staff' }} />
      <ErrorText message={people.error ?? problem} />

      {canInvite ? (
        <Button
          title="Invite someone"
          icon="person-add-outline"
          onPress={() => router.push('/staff-invite')}
        />
      ) : null}
      {can('role.read') ? (
        <Button
          title="Roles and what each can do"
          icon="shield-checkmark-outline"
          variant="secondary"
          onPress={() => router.push('/roles')}
        />
      ) : null}

      <SectionTitle>{`People (${list.length})`}</SectionTitle>
      {list.length === 0 ? (
        <EmptyState art={illustrations.emptySearch} title="Nobody here yet" />
      ) : (
        <Group>
          {list.map((p) => (
            <ListRow
              key={p.id}
              leading={<Avatar name={p.user.fullName} />}
              title={p.user.fullName}
              subtitle={`${p.role.name}${p.user.phone ? ` · ${p.user.phone}` : ''}`}
              right={
                p.isOwner ? (
                  <Badge text="Owner" tone="good" />
                ) : p.status !== 'ACTIVE' ? (
                  <Badge text="Switched off" tone="warn" />
                ) : undefined
              }
              onPress={() => router.push({ pathname: '/staff/[id]', params: { id: p.id } })}
            />
          ))}
        </Group>
      )}

      {canInvite && (invites.data?.length ?? 0) > 0 ? (
        <>
          <SectionTitle>Waiting to join</SectionTitle>
          <Group>
            {(invites.data ?? []).map((i) => (
              <ListRow
                key={i.id}
                icon="time-outline"
                title={i.phone}
                subtitle={`${i.role.name} · code ends ${formatDateTime(i.expiresAt)}`}
                actions={
                  <Button
                    title="Cancel"
                    variant="secondary"
                    busy={busyId === i.id}
                    onPress={() => cancelInvite(i)}
                  />
                }
              />
            ))}
          </Group>
        </>
      ) : null}

      {isOwner ? (
        <Card style={{ marginTop: 16 }}>
          <Text style={{ fontWeight: '800', marginBottom: 4 }}>Do you work alone?</Text>
          <Text style={{ marginBottom: 12, opacity: 0.7 }}>
            You can hide the staff options from the More tab. You can bring them back any time.
          </Text>
          <View>
            <Button
              title="I work alone, hide staff options"
              variant="secondary"
              onPress={() => {
                staffPref.set('no');
                router.back();
              }}
            />
          </View>
        </Card>
      ) : null}
    </Screen>
  );
}
