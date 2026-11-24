import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { deleteData, getData, patchData, postData } from '@/api/client';
import {
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  Loading,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { illustrations } from '@/theme/art';
import { useLoad } from '@/hooks/useLoad';
import { colors } from '@/theme/colors';
import { friendlyError } from '@/utils/errors';

interface CategoryRow {
  id: string;
  name: string;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
}

export default function CategoriesScreen() {
  const { data, loading, error, refreshing, reload } = useLoad(
    () => getData<CategoryRow[]>('/categories'),
    [],
  );
  const [newName, setNewName] = useState('');
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  async function autoAssign() {
    if (busy) return;
    setBusy(true);
    setFormError(null);
    setStatusMessage(null);
    try {
      const res = await postData<{ updated: number; createdCategories: number }>(
        '/categories/auto-assign',
      );
      setStatusMessage(
        res.updated === 0
          ? 'All matching products are already categorized.'
          : `Auto-categorized ${res.updated} product${res.updated === 1 ? '' : 's'}${res.createdCategories > 0 ? ` and created ${res.createdCategories} new categor${res.createdCategories === 1 ? 'y' : 'ies'}` : ''}.`,
      );
      await reload();
    } catch (e) {
      setFormError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function addCategory() {
    if (newName.trim().length < 2) {
      return setFormError('Enter a category name (at least 2 characters).');
    }
    setBusy(true);
    setFormError(null);
    try {
      await postData('/categories', { name: newName.trim() });
      setNewName('');
      await reload();
    } catch (e) {
      setFormError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit() {
    if (!editing) return;
    if (editName.trim().length < 2) {
      return setFormError('Enter a category name (at least 2 characters).');
    }
    setBusy(true);
    setFormError(null);
    try {
      await patchData(`/categories/${editing.id}`, { name: editName.trim() });
      setEditing(null);
      setEditName('');
      await reload();
    } catch (e) {
      setFormError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  function confirmDelete(cat: CategoryRow) {
    Alert.alert('Delete category?', `Remove "${cat.name}"? Only empty categories can be deleted.`, [
      { text: 'Keep', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          setBusy(true);
          setFormError(null);
          void deleteData(`/categories/${cat.id}`)
            .then(() => reload())
            .catch((e) => setFormError(friendlyError(e)))
            .finally(() => setBusy(false));
        },
      },
    ]);
  }

  if (loading) return <Loading />;

  return (
    <Screen refreshing={refreshing} onRefresh={() => void reload(true)}>
      <Stack.Screen options={{ title: 'Categories' }} />
      <ErrorText message={formError ?? error} />
      {statusMessage ? (
        <Card style={{ backgroundColor: colors.successSoft, borderColor: colors.success }}>
          <Text style={{ color: colors.success, fontWeight: '600' }}>{statusMessage}</Text>
        </Card>
      ) : null}

      <Button
        title="Auto-categorize products by name"
        variant="secondary"
        busy={busy}
        onPress={() => void autoAssign()}
      />

      <Card>
        <Field
          label={editing ? `Rename "${editing.name}"` : 'New category'}
          value={editing ? editName : newName}
          onChangeText={editing ? setEditName : setNewName}
          placeholder="e.g. Grains, Beverages, Dairy"
        />
        {editing ? (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button title="Save name" busy={busy} onPress={() => void saveEdit()} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title="Cancel"
                variant="secondary"
                onPress={() => {
                  setEditing(null);
                  setEditName('');
                }}
              />
            </View>
          </View>
        ) : (
          <Button title="Add category" busy={busy} onPress={() => void addCategory()} />
        )}
      </Card>

      <SectionTitle>{`All categories (${data?.length ?? 0})`}</SectionTitle>
      {!data || data.length === 0 ? (
        <EmptyState
          art={illustrations.emptyProducts}
          title="No categories yet"
          note="Add categories above to group your products."
        />
      ) : (
        data.map((cat) => (
          <Card key={cat.id}>
            <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 8 }}>
              {cat.name}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button
                  title="Rename"
                  variant="secondary"
                  disabled={busy}
                  onPress={() => {
                    setEditing(cat);
                    setEditName(cat.name);
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  title="Delete"
                  variant="danger"
                  disabled={busy}
                  onPress={() => confirmDelete(cat)}
                />
              </View>
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}
