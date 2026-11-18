import { Stack } from 'expo-router';
import { useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { getData, getPage, postData, query } from '@/api/client';
import type { CollectionAgentDetail, CollectionAgentRow, CustomerRow } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  KeyValue,
  ListRow,
  Loading,
  SearchBox,
  SectionTitle,
} from '@/components/ui';
import { useLoad, usePagedList } from '@/hooks/useLoad';
import { colors } from '@/theme/colors';
import { formatINR } from '@/utils/currency';
import { friendlyError } from '@/utils/errors';

export default function CollectionAgentsScreen() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [custSearch, setCustSearch] = useState('');
  const candidates = useLoad(
    () =>
      custSearch.trim().length >= 2
        ? getPage<CustomerRow>(`/customers${query({ q: custSearch.trim(), pageSize: 5 })}`)
        : Promise.resolve(null),
    [custSearch],
  );

  const list = usePagedList<CollectionAgentRow>(`/collection-agents${query({ q: search.trim() })}`);
  const detail = useLoad(
    () =>
      selectedId
        ? getData<CollectionAgentDetail>(`/collection-agents/${selectedId}`)
        : Promise.resolve(null),
    [selectedId],
  );

  if (!can('collection.read')) {
    return (
      <EmptyState
        icon="lock-closed-outline"
        title="Collection agents are not available for your role"
      />
    );
  }

  async function assign(agentId: string, customerId: string) {
    setBusy(true);
    setProblem(null);
    try {
      await postData(`/collection-agents/${agentId}/assignments`, { customerId });
      setCustSearch('');
      void detail.reload();
      void list.reload(true);
    } catch (e) {
      setProblem(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function endAssignment(agentId: string, assignmentId: string) {
    setBusy(true);
    setProblem(null);
    try {
      await postData(`/collection-agents/${agentId}/assignments/${assignmentId}/end`);
      void detail.reload();
      void list.reload(true);
    } catch (e) {
      setProblem(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function createAgent() {
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      return setProblem('Enter the agent name (at least 2 letters).');
    }
    setBusy(true);
    setProblem(null);
    try {
      await postData('/collection-agents', {
        name: trimmed,
        ...(phone.trim() ? { phone: phone.trim() } : {}),
      });
      setName('');
      setPhone('');
      setCreating(false);
      void list.reload(true);
    } catch (e) {
      setProblem(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View
      style={{ flex: 1, backgroundColor: colors.background, paddingHorizontal: 16, paddingTop: 12 }}
    >
      <Stack.Screen options={{ title: 'Collection agents' }} />
      <SearchBox value={search} onChangeText={setSearch} placeholder="Search agent name or phone" />

      {can('collection.assign') ? (
        creating ? (
          <Card>
            <Field label="Agent name" value={name} onChangeText={setName} placeholder="Ramesh" />
            <Field
              label="Mobile number (optional)"
              value={phone}
              onChangeText={setPhone}
              placeholder="9876543210"
              keyboardType="phone-pad"
            />
            <ErrorText message={problem} />
            <Button title="Save agent" onPress={createAgent} busy={busy} />
            <Button
              title="Cancel"
              variant="secondary"
              onPress={() => {
                setCreating(false);
                setProblem(null);
              }}
            />
          </Card>
        ) : (
          <Button title="Add collection agent" onPress={() => setCreating(true)} />
        )
      ) : null}

      {selectedId && detail.data ? (
        <Card>
          <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 4 }}>
            {detail.data.name}
          </Text>
          <KeyValue label="Phone" value={detail.data.phone ?? '—'} />
          <KeyValue label="Status" value={detail.data.isActive ? 'Active' : 'Inactive'} />
          <SectionTitle>{`Assigned customers (${detail.data.assignments.length})`}</SectionTitle>
          {detail.data.assignments.length === 0 ? (
            <Text style={{ color: colors.textMuted, marginBottom: 8 }}>
              No active customer assignments.
            </Text>
          ) : (
            detail.data.assignments.map((a) => (
              <View key={a.id}>
                <KeyValue label={a.customerName} value={formatINR(a.customerBalance)} />
                {can('collection.assign') ? (
                  <Button
                    title={`Remove ${a.customerName}`}
                    variant="secondary"
                    busy={busy}
                    onPress={() => void endAssignment(detail.data!.id, a.id)}
                  />
                ) : null}
              </View>
            ))
          )}
          {can('collection.assign') && detail.data.isActive ? (
            <>
              <SectionTitle>Assign a customer</SectionTitle>
              <SearchBox
                value={custSearch}
                onChangeText={setCustSearch}
                placeholder="Type a customer name or mobile"
              />
              {(candidates.data?.data ?? []).map((c) => (
                <ListRow
                  key={c.id}
                  title={c.name}
                  subtitle={c.phone ?? 'No mobile number'}
                  right={<Badge text={formatINR(c.balance)} tone="warn" />}
                  onPress={() => void assign(detail.data!.id, c.id)}
                />
              ))}
              <ErrorText message={problem} />
            </>
          ) : null}
          <Button title="Close details" variant="secondary" onPress={() => setSelectedId(null)} />
        </Card>
      ) : null}

      {list.loading ? (
        <Loading />
      ) : (
        <>
          <ErrorText message={list.error} />
          <FlatList
            data={list.items}
            keyExtractor={(a) => a.id}
            refreshing={list.refreshing}
            onRefresh={() => void list.reload(true)}
            onEndReachedThreshold={0.5}
            onEndReached={() => void list.loadMore()}
            ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
            ListEmptyComponent={
              <EmptyState icon="people-outline" title="No collection agents yet" />
            }
            renderItem={({ item }) => (
              <ListRow
                title={item.name}
                subtitle={`${item.phone ?? 'No phone'} · ${item.activeAssignments} assigned`}
                right={<Badge text={formatINR(item.totalCollected)} tone="good" />}
                rightSub={`${item.completedCollections} receipts`}
                onPress={() => setSelectedId(item.id)}
              />
            )}
          />
        </>
      )}
    </View>
  );
}
