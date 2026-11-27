import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { deleteData, getData, patchData, postData } from '@/api/client';
import type { RoleInfo } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Card, ErrorText, Field, Loading, Screen, SectionTitle } from '@/components/ui';
import { useLoad } from '@/hooks/useLoad';
import { colors } from '@/theme/colors';
import { friendlyError } from '@/utils/errors';
import { groupPermissions, permissionLabel } from '@/utils/permissions';

/** Make a role, or look at / change one: tick what the role may do, in plain words. */
export default function RoleEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const { can } = useAuth();
  const role = useLoad(
    () => (id ? getData<RoleInfo>(`/roles/${id}`) : Promise.resolve(null)),
    [id],
  );

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [ticked, setTicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const r = role.data;
  useEffect(() => {
    if (!r) return;
    setName(r.name);
    setDescription(r.description ?? '');
    setTicked(r.permissions);
  }, [r]);

  if (role.loading) return <Loading />;
  if (id && !r) return <ErrorText message={role.error ?? 'Could not load this role.'} />;

  const isOwnerRole = r?.isSystem === true && r.name === 'Owner';
  const readOnly = !can('role.manage') || isOwnerRole;
  const canDelete = !readOnly && !!r && !r.isSystem && r.memberCount === 0;

  function toggle(key: string) {
    setTicked((t) => (t.includes(key) ? t.filter((k) => k !== key) : [...t, key]));
  }
  function setGroup(keys: string[], on: boolean) {
    setTicked((t) => (on ? [...new Set([...t, ...keys])] : t.filter((k) => !keys.includes(k))));
  }

  async function save() {
    if (!r && name.trim().length < 2) return setError('Give the role a name (at least 2 letters).');
    if (ticked.length === 0) return setError('Tick at least one thing this role can do.');
    setBusy(true);
    setError(null);
    try {
      if (r) {
        await patchData(`/roles/${r.id}`, {
          ...(r.isSystem ? {} : { name: name.trim() }),
          description: description.trim(),
          permissionKeys: ticked,
        });
      } else {
        await postData('/roles', {
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          permissionKeys: ticked,
        });
      }
      router.back();
    } catch (e) {
      setError(friendlyError(e));
      setBusy(false);
    }
  }

  function remove() {
    if (!r) return;
    Alert.alert(`Delete the role "${r.name}"?`, 'Nobody has this role. This cannot be undone.', [
      { text: 'Keep it', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          deleteData(`/roles/${r.id}`)
            .then(() => router.back())
            .catch((e: unknown) => {
              setError(friendlyError(e));
              setBusy(false);
            });
        },
      },
    ]);
  }

  return (
    <Screen
      footer={
        readOnly ? undefined : (
          <Button
            title={r ? 'Save role' : 'Create role'}
            icon="checkmark"
            onPress={save}
            busy={busy}
          />
        )
      }
    >
      <Stack.Screen options={{ title: r ? r.name : 'New role' }} />
      {isOwnerRole ? (
        <Text style={{ color: colors.textMuted, marginBottom: 12 }}>
          The Owner can do everything. This role cannot be changed.
        </Text>
      ) : readOnly ? (
        <Text style={{ color: colors.textMuted, marginBottom: 12 }}>
          You can look at this role, but only the owner can change roles.
        </Text>
      ) : null}

      <Field
        label="Role name"
        value={name}
        onChangeText={setName}
        editable={!readOnly && !r?.isSystem}
        placeholder="For example: Stock keeper"
        autoCapitalize="words"
      />
      <Field
        label="What this role is for (optional)"
        value={description}
        onChangeText={setDescription}
        editable={!readOnly}
        placeholder="For example: Receives goods and counts stock"
        maxLength={200}
      />

      {groupPermissions().map((g) => {
        const all = g.keys.every((k) => ticked.includes(k));
        return (
          <View key={g.title}>
            <SectionTitle
              action={
                readOnly ? undefined : (
                  <Pressable
                    accessibilityRole="button"
                    hitSlop={8}
                    onPress={() => setGroup(g.keys, !all)}
                  >
                    <Text style={{ color: colors.primary, fontWeight: '700' }}>
                      {all ? 'Clear all' : 'Tick all'}
                    </Text>
                  </Pressable>
                )
              }
            >
              {g.title}
            </SectionTitle>
            <Card>
              {g.keys.map((k) => {
                const on = isOwnerRole || ticked.includes(k);
                return (
                  <Pressable
                    key={k}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on, disabled: readOnly }}
                    disabled={readOnly}
                    onPress={() => toggle(k)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 10,
                      paddingVertical: 10,
                    }}
                  >
                    <Ionicons
                      name={on ? 'checkbox' : 'square-outline'}
                      size={24}
                      color={on ? colors.primary : colors.textMuted}
                    />
                    <Text style={{ flex: 1, fontSize: 15, color: colors.text }}>
                      {permissionLabel(k)}
                    </Text>
                  </Pressable>
                );
              })}
            </Card>
          </View>
        );
      })}

      <ErrorText message={error} />
      {canDelete ? (
        <View style={{ marginTop: 12 }}>
          <Button title="Delete this role" icon="trash-outline" variant="danger" onPress={remove} />
        </View>
      ) : null}
    </Screen>
  );
}
