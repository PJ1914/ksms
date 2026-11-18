import { router } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useAuth } from '@/auth/AuthProvider';
import { Button, Card, Choice, KeyValue, ListRow, Screen, SectionTitle } from '@/components/ui';
import { colors } from '@/theme/colors';

export default function MoreScreen() {
  const { profile, branch, switchBranch, signOut, can } = useAuth();
  const [busy, setBusy] = useState(false);

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
