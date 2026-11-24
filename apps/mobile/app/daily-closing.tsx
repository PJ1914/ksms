import { Stack } from 'expo-router';
import { useState } from 'react';
import { Alert, Text } from 'react-native';
import Decimal from 'decimal.js';
import { moneyString } from '@ksms/validation';
import { getData, getPage } from '@/api/client';
import type { DailyClosingPreview, DailyClosingRow } from '@/api/types';
import { useAuth } from '@/auth/AuthProvider';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorText,
  Field,
  Hero,
  KeyValue,
  Loading,
  Screen,
  SectionTitle,
} from '@/components/ui';
import { illustrations } from '@/theme/art';
import { useLoad } from '@/hooks/useLoad';
import { useSubmit } from '@/hooks/useSubmit';
import { colors } from '@/theme/colors';
import { absMoney, formatINR } from '@/utils/currency';

export default function DailyClosingScreen() {
  const { can } = useAuth();
  const [actualCash, setActualCash] = useState('');
  const [notes, setNotes] = useState('');
  const { run, busy, error, setError } = useSubmit();

  const {
    data,
    loading,
    error: loadError,
    refreshing,
    reload,
  } = useLoad(async () => {
    const [preview, history] = await Promise.all([
      getData<DailyClosingPreview>('/closings/preview'),
      getPage<DailyClosingRow>('/closings?pageSize=15'),
    ]);
    return { preview, history: history.data };
  }, []);

  if (!can('cashbook.read') && !can('closing.manage')) {
    return (
      <EmptyState
        art={illustrations.roleLocked}
        title="Daily closing is not available for your role"
      />
    );
  }

  if (loading) return <Loading />;
  if (!data) return <ErrorText message={loadError ?? 'Could not load daily closing.'} />;

  const { preview, history } = data;
  const closed = preview.closing?.status === 'CLOSED';

  let liveDiff: Decimal | null = null;
  if (!closed && moneyString.safeParse(actualCash.trim()).success) {
    liveDiff = new Decimal(actualCash.trim()).minus(new Decimal(preview.expectedCash));
  }

  function closeDay() {
    if (!moneyString.safeParse(actualCash.trim()).success) {
      return setError('Enter the counted cash amount (0 or more, like 1250.00).');
    }
    // Closing cannot be undone, so ask first and show what is being locked in.
    Alert.alert(
      `Close ${preview.businessDate}?`,
      `Counted cash ${formatINR(actualCash.trim())} against expected ${formatINR(preview.expectedCash)}. ` +
        'This cannot be undone. Sales made after closing go on the next day.',
      [
        { text: 'Not yet', style: 'cancel' },
        { text: 'Close day', style: 'destructive', onPress: () => void confirmClose() },
      ],
    );
  }

  async function confirmClose() {
    const res = await run('/closings', {
      businessDate: preview.businessDate,
      actualCash: actualCash.trim(),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    });
    if (res) {
      setActualCash('');
      setNotes('');
      void reload(true);
    }
  }

  return (
    <Screen onRefresh={() => void reload(true)} refreshing={refreshing}>
      <Stack.Screen options={{ title: `Closing · ${preview.businessDate}` }} />
      <Hero
        label="Cash that should be in the drawer"
        value={formatINR(preview.expectedCash)}
        art={illustrations.dailyClosing}
        tint="mango"
        sub={`Opening ${formatINR(preview.openingCash)} · in ${formatINR(preview.cashIn)} · out ${formatINR(preview.cashOut)}`}
      />
      <Card>
        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 8 }}>
          Today ({preview.businessDate})
        </Text>
        <KeyValue label="Opening cash" value={formatINR(preview.openingCash)} />
        <KeyValue label="Cash in" value={`+${formatINR(preview.cashIn)}`} tone="success" />
        <KeyValue label="Cash out" value={`-${formatINR(preview.cashOut)}`} tone="danger" />
        <KeyValue label="Expected cash" value={formatINR(preview.expectedCash)} bold />
        <KeyValue label="UPI net" value={formatINR(preview.byMethod.UPI ?? '0.00')} tone="muted" />
        <KeyValue
          label="Card net"
          value={formatINR(preview.byMethod.CARD ?? '0.00')}
          tone="muted"
        />
        <KeyValue
          label="Bank transfer net"
          value={formatINR(preview.byMethod.BANK_TRANSFER ?? '0.00')}
          tone="muted"
        />
      </Card>

      {closed && preview.closing ? (
        <Card>
          <Badge text="Day closed" tone="good" />
          <KeyValue
            label="Actual cash"
            value={formatINR(preview.closing.actualCash ?? '0.00')}
            bold
          />
          <KeyValue
            label="Difference"
            value={formatINR(preview.closing.difference ?? '0.00')}
            tone={
              preview.closing.difference && new Decimal(preview.closing.difference).lt(0)
                ? 'danger'
                : 'success'
            }
          />
          {preview.closing.notes ? <KeyValue label="Notes" value={preview.closing.notes} /> : null}
        </Card>
      ) : can('closing.manage') ? (
        <Card>
          <Field
            label="Actual cash counted (₹)"
            value={actualCash}
            onChangeText={setActualCash}
            placeholder={preview.expectedCash}
            keyboardType="decimal-pad"
          />
          {liveDiff !== null ? (
            <KeyValue
              label={
                liveDiff.isZero() ? 'Exact match' : liveDiff.gt(0) ? 'Excess cash' : 'Cash short'
              }
              value={`${liveDiff.gt(0) ? '+' : liveDiff.lt(0) ? '-' : ''}${formatINR(absMoney(liveDiff.toFixed(2)))}`}
              tone={liveDiff.lt(0) ? 'danger' : 'success'}
              bold
            />
          ) : null}
          <Field
            label="Closing notes (optional)"
            value={notes}
            onChangeText={setNotes}
            placeholder="Reason for any variance..."
          />
          <ErrorText message={error} />
          <Button title="Close day" onPress={closeDay} busy={busy} />
        </Card>
      ) : null}

      <SectionTitle>Recent closings</SectionTitle>
      <Card>
        {history.length === 0 ? (
          <EmptyState art={illustrations.dailyClosing} title="No closed days yet" />
        ) : (
          history.map((c) => (
            <KeyValue
              key={c.id}
              label={`${c.businessDate} · Exp ${formatINR(c.expectedCash)}`}
              value={c.actualCash ? `Act ${formatINR(c.actualCash)}` : c.status}
              tone={c.difference && new Decimal(c.difference).lt(0) ? 'danger' : 'success'}
            />
          ))
        )}
      </Card>
    </Screen>
  );
}
