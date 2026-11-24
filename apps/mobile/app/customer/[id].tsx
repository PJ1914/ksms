import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Text, View } from 'react-native';
import Decimal from 'decimal.js';
import { moneyString } from '@ksms/validation';
import { getData, patchData, postData } from '@/api/client';
import type { CustomerRow, LedgerEntry } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import { ListFooter } from '@/components/ListFooter';
import {
  Avatar,
  Badge,
  Button,
  Card,
  EmptyState,
  EntryRow,
  ErrorText,
  Field,
  Group,
  Hero,
  Loading,
  QuickActions,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { illustrations } from '@/theme/art';
import { useLoad, usePagedList } from '@/hooks/useLoad';
import { colors } from '@/theme/colors';
import { absMoney, formatINR, isNegative, isPositive } from '@/utils/currency';
import { friendlyError } from '@/utils/errors';
import { formatDateTime, words } from '@/utils/format';

export default function CustomerScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { can } = useAuth();
  const {
    data: c,
    loading,
    error,
    refreshing,
    reload,
  } = useLoad(() => getData<CustomerRow>(`/customers/${id}`), [id]);
  const canLedger = can('ledger.read');
  const ledger = usePagedList<LedgerEntry>(canLedger ? `/customers/${id}/ledger` : null, 25);
  const [limit, setLimit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (!c) return <ErrorText message={error ?? 'Could not load this customer.'} />;
  const customer = c;
  const owes = isPositive(customer.balance);

  async function saveLimit() {
    const v = (limit ?? '').trim();
    if (v !== '' && !moneyString.safeParse(v).success)
      return setProblem(
        'Enter the credit limit in rupees, like 5000, or leave it empty for no limit.',
      );
    setBusy(true);
    setProblem(null);
    try {
      await patchData(`/customers/${id}`, {
        creditLimit: v === '' ? null : v,
        version: customer.version,
      });
      setLimit(null);
      void reload();
    } catch (e) {
      setProblem(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    setBusy(true);
    setProblem(null);
    try {
      await postData(`/customers/${id}/${customer.isActive ? 'deactivate' : 'reactivate'}`);
      void reload();
    } catch (e) {
      setProblem(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen onRefresh={() => void reload(true)} refreshing={refreshing}>
      <Stack.Screen options={{ title: c.name }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <Avatar name={c.name} size={56} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 20, fontWeight: '800', color: colors.text }}>{c.name}</Text>
          <Text style={{ fontSize: 14, color: colors.textMuted }}>
            {c.phone ?? 'No mobile number'}
          </Text>
        </View>
        {!c.isActive ? <Badge text="Switched off" tone="warn" /> : null}
      </View>

      <Hero
        label={owes ? 'Balance due' : isNegative(c.balance) ? 'Advance with you' : 'All clear'}
        value={formatINR(isNegative(c.balance) ? absMoney(c.balance) : c.balance)}
        valueTone={owes ? 'danger' : 'success'}
        tint={owes ? 'tomato' : 'green'}
        art={owes ? illustrations.ledger : illustrations.duesCleared}
        sub={c.creditLimit ? `Credit limit ${formatINR(c.creditLimit)}` : 'No credit limit set'}
      >
        {owes && c.creditLimit && isPositive(c.creditLimit) ? (
          <LimitBar used={c.balance} limit={c.creditLimit} />
        ) : null}
      </Hero>

      <QuickActions
        actions={[
          {
            label: 'Got payment',
            icon: 'cash-outline',
            primary: true,
            hidden: !can('collection.create'),
            onPress: () => router.push({ pathname: '/customer/pay', params: { customerId: id } }),
          },
          {
            label: 'Khata entry',
            icon: 'create-outline',
            hidden: !can('customer.manage'),
            onPress: () =>
              router.push({ pathname: '/customer/adjust', params: { customerId: id } }),
          },
          {
            label: 'Call',
            icon: 'call-outline',
            hidden: !c.phone,
            onPress: () => void Linking.openURL(`tel:${c.phone}`),
          },
          {
            label: 'Message',
            icon: 'chatbubble-outline',
            hidden: !c.phone || !owes,
            onPress: () =>
              void Linking.openURL(
                `sms:${c.phone}?body=${encodeURIComponent(`Namaste ${c.name}, your khata balance is ${formatINR(c.balance)}. Thank you.`)}`,
              ),
          },
        ]}
      />

      {can('customer.manage') ? (
        limit === null ? (
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ flex: 1 }}>
              <Button
                title="Credit limit"
                icon="speedometer-outline"
                variant="secondary"
                onPress={() => setLimit(c.creditLimit ?? '')}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                title={c.isActive ? 'Switch off' : 'Switch on'}
                icon={c.isActive ? 'pause-circle-outline' : 'play-circle-outline'}
                variant="secondary"
                onPress={toggleActive}
                busy={busy}
              />
            </View>
          </View>
        ) : (
          <Card>
            <Field
              label="Credit limit ₹ (empty = no limit)"
              value={limit}
              onChangeText={setLimit}
              keyboardType="decimal-pad"
            />
            <ErrorText message={problem} />
            <Button title="Save limit" onPress={saveLimit} busy={busy} />
            <Button title="Cancel" variant="secondary" onPress={() => setLimit(null)} />
          </Card>
        )
      ) : null}
      {limit === null ? <ErrorText message={problem} /> : null}

      {canLedger ? (
        <>
          <SectionTitle>Khata statement</SectionTitle>
          {ledger.loading ? (
            <Loading />
          ) : ledger.items.length === 0 ? (
            <EmptyState art={illustrations.emptyKhata} title="No khata entries yet" />
          ) : (
            <Group>
              {ledger.items.map((e) => (
                <EntryRow
                  key={e.id}
                  title={e.description || words(e.type)}
                  subtitle={`${e.description ? `${words(e.type)} · ` : ''}${formatDateTime(e.occurredAt)}`}
                  amount={`${isPositive(e.amount) ? '+' : '−'}${formatINR(absMoney(e.amount))}`}
                  direction={isPositive(e.amount) ? 'out' : 'in'}
                />
              ))}
            </Group>
          )}
          <ListFooter
            shown={ledger.items.length}
            total={ledger.meta?.total}
            loadingMore={ledger.loadingMore}
            onLoadMore={() => void ledger.loadMore()}
          />
        </>
      ) : null}
    </Screen>
  );
}

/** How much of the credit limit is used (decimal maths; the bar is capped at 100%). */
function LimitBar({ used, limit }: { used: string; limit: string }) {
  const pct = Decimal.min(new Decimal(used).div(limit).times(100), 100)
    .toDecimalPlaces(0)
    .toNumber();
  const over = pct >= 100;
  return (
    <View>
      <View style={{ height: 8, borderRadius: 99, backgroundColor: '#FFFFFF', overflow: 'hidden' }}>
        <View
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 99,
            backgroundColor: over ? colors.danger : '#E4572E',
          }}
        />
      </View>
      <Text style={{ fontSize: 12, color: colors.danger, marginTop: 6, fontWeight: '600' }}>
        {over ? 'Over the credit limit' : `${pct}% of the credit limit used`}
      </Text>
    </View>
  );
}
