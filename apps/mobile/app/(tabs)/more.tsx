import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Card, Choice, KeyValue, ListRow, Screen, SectionTitle } from '@/components/ui';
import { getData } from '@/api/client';
import { useLoad } from '@/hooks/useLoad';
import { useSync } from '@/sync/SyncProvider';
import { colors } from '@/theme/colors';

export default function MoreScreen() {
  const { profile, branch, switchBranch, signOut, can } = useAuth();
  const { stats } = useSync();
  const [busy, setBusy] = useState(false);
  const unread = useLoad(
    () =>
      getData<{ unreadCount: number }>('/notifications/unread-count')
        .then((r) => r.unreadCount)
        .catch(() => 0),
    [branch?.id],
  );

  return (
    <Screen>
      <Card>
        <Text style={{ fontSize: 18, fontWeight: '700', color: colors.text }}>
          {profile?.user.fullName}
        </Text>
        <KeyValue label="Mobile" value={profile?.user.phone ?? ''} />
        <KeyValue label="Role" value={profile?.role.name ?? ''} />
        <KeyValue label="Shop" value={profile?.organization.name ?? ''} />
        <KeyValue label="Branch" value={branch?.name ?? ''} />
      </Card>

      {(profile?.branches.length ?? 0) > 1 ? (
        <Choice
          label="Working in branch"
          options={profile!.branches.map((b) => ({ key: b.id, label: b.name }))}
          value={branch?.id ?? ''}
          onChange={switchBranch}
        />
      ) : null}

      <SectionTitle>Buying</SectionTitle>
      <View style={{ gap: 8 }}>
        {can('supplier.read') ? (
          <ListRow
            title="Suppliers"
            subtitle="Who you buy from, and what you owe them"
            onPress={() => router.push('/suppliers')}
          />
        ) : null}
        {can('purchase.read') ? (
          <ListRow
            title="Purchases"
            subtitle="Goods bought and received"
            onPress={() => router.push('/purchases')}
          />
        ) : null}
      </View>

      {can('collection.read') ? (
        <>
          <SectionTitle>Khata & Collections</SectionTitle>
          <View style={{ gap: 8 }}>
            <ListRow
              title="Collections"
              subtitle="Customer payment receipts and reversals"
              onPress={() => router.push('/collections')}
            />
            <ListRow
              title="Collection agents"
              subtitle="Field collectors, assigned customers and totals"
              onPress={() => router.push('/collection-agents')}
            />
          </View>
        </>
      ) : null}

      {can('report.sales') ||
      can('report.financial') ||
      can('report.profit') ||
      can('report.purchases') ||
      can('report.inventory') ? (
        <>
          <SectionTitle>Reports</SectionTitle>
          <View style={{ gap: 8 }}>
            <ListRow
              title="Reports"
              subtitle="Sales, profit, cash flow, money owed, stock and the day book"
              onPress={() => router.push('/reports')}
            />
          </View>
        </>
      ) : null}

      {can('expense.read') || can('cashbook.read') || can('closing.manage') ? (
        <>
          <SectionTitle>Finance</SectionTitle>
          <View style={{ gap: 8 }}>
            {can('expense.read') ? (
              <ListRow
                title="Expenses"
                subtitle="Shop expenses, categories and cancellations"
                onPress={() => router.push('/expenses')}
              />
            ) : null}
            {can('cashbook.read') ? (
              <ListRow
                title="Cashbook"
                subtitle="Money in and out of the branch register"
                onPress={() => router.push('/cashbook')}
              />
            ) : null}
            {can('cashbook.read') || can('closing.manage') ? (
              <ListRow
                title="Daily closing"
                subtitle="Expected vs actual cash count for the day"
                onPress={() => router.push('/daily-closing')}
              />
            ) : null}
          </View>
        </>
      ) : null}

      {can('organization.read') ? (
        <>
          <SectionTitle>Shop & GST</SectionTitle>
          <ListRow
            title="GST & billing settings"
            subtitle="Turn GST on or off, set GSTIN, state code and tax mode"
            onPress={() => router.push('/gst-settings')}
          />
        </>
      ) : null}

      <SectionTitle>Alerts & Catalog</SectionTitle>
      <View style={{ gap: 8 }}>
        <ListRow
          title="Notifications"
          subtitle={
            (unread.data ?? 0) > 0
              ? `${unread.data} unread alert${unread.data === 1 ? '' : 's'}`
              : 'Low stock, expiring batches & alerts'
          }
          onPress={() => router.push('/notifications')}
        />
        {can('category.manage') ? (
          <ListRow
            title="Categories"
            subtitle="Add, rename or remove product categories"
            onPress={() => router.push('/categories')}
          />
        ) : null}
      </View>

      <SectionTitle>Offline & Sync</SectionTitle>
      <ListRow
        title="Sync & offline cache"
        subtitle={
          stats.failedOutbox > 0
            ? `${stats.failedOutbox} failed upload${stats.failedOutbox === 1 ? '' : 's'} — tap to retry or discard`
            : stats.pendingOutbox > 0
              ? `${stats.pendingOutbox} held bill${stats.pendingOutbox === 1 ? '' : 's'} waiting to upload`
              : `${stats.products} products · ${stats.customers} customers cached`
        }
        onPress={() => router.push('/sync')}
      />

      <SectionTitle>Account</SectionTitle>
      <Button
        title="Sign out"
        variant="secondary"
        busy={busy}
        onPress={() => {
          setBusy(true);
          void signOut();
        }}
      />
    </Screen>
  );
}
