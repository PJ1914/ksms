import { router, Stack } from 'expo-router';
import { Text, View } from 'react-native';
import { getData } from '@/api/client';
import type { RoleInfo } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Badge, Button, Card, ErrorText, Loading, Screen } from '@/components/ui';
import { useLoad } from '@/hooks/useLoad';
import { colors } from '@/theme/colors';
import { summarizeRole } from '@/utils/permissions';

/** Every role in the shop, what it covers, and how many people hold it. */
export default function RolesScreen() {
  const { can } = useAuth();
  const roles = useLoad(() => getData<RoleInfo[]>('/roles'), []);

  if (roles.loading) return <Loading />;

  return (
    <Screen onRefresh={() => void roles.reload(true)} refreshing={roles.refreshing}>
      <Stack.Screen options={{ title: 'Roles' }} />
      <Text style={{ color: colors.textMuted, marginBottom: 12 }}>
        A role decides what a person can see and do. Give each person the smallest role that lets
        them do their job.
      </Text>
      <ErrorText message={roles.error} />
      {can('role.manage') ? (
        <Button title="Make a new role" icon="add" onPress={() => router.push('/role-edit')} />
      ) : null}
      {(roles.data ?? []).map((r) => (
        <Card key={r.id} style={{ marginTop: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <Text style={{ flex: 1, fontSize: 17, fontWeight: '800', color: colors.text }}>
              {r.name}
            </Text>
            {r.isSystem ? <Badge text="Built in" /> : null}
            <Badge
              text={`${r.memberCount} ${r.memberCount === 1 ? 'person' : 'people'}`}
              tone={r.memberCount > 0 ? 'good' : 'neutral'}
            />
          </View>
          {r.description ? (
            <Text style={{ color: colors.textMuted, marginBottom: 6 }}>{r.description}</Text>
          ) : null}
          <Text style={{ color: colors.text, marginBottom: 10 }}>
            {r.name === 'Owner'
              ? 'Everything'
              : summarizeRole(r.permissions).join(' · ') || 'Nothing yet'}
          </Text>
          <Button
            title={can('role.manage') && r.name !== 'Owner' ? 'See and change' : 'See details'}
            variant="secondary"
            onPress={() => router.push({ pathname: '/role-edit', params: { id: r.id } })}
          />
        </Card>
      ))}
    </Screen>
  );
}
