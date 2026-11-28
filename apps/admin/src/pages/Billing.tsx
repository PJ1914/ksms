import { useState } from 'react';
import { api, dateTime, request, rupees, type Role } from '../api';
import { Alert, Badge, errorText, Loading, Modal, useLoad } from '../ui';

interface Plan {
  id: string;
  code: string;
  name: string;
  monthlyPrice: string;
  durationDiscounts: Record<string, string>;
  maxBranches: number | null;
  maxUsers: number | null;
  isTrial: boolean;
  trialDays: number | null;
  isActive: boolean;
  shops: number;
}

export function Plans({ role }: { role: Role }) {
  const { data, error, loading, reload } = useLoad(() => api.get<Plan[]>('/plans'), []);
  const [edit, setEdit] = useState<Plan | 'new' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Plans</h1>
        {role === 'ADMIN' && (
          <button className="primary" onClick={() => setEdit('new')}>
            New plan
          </button>
        )}
      </div>
      <Alert kind="ok">{notice}</Alert>
      <Loading loading={loading} error={error} />
      <div className="card" style={{ padding: 0 }}>
        <table className="cards">
          <thead>
            <tr>
              <th>Plan</th>
              <th className="right">Per month</th>
              <th>Limits</th>
              <th>Multi-month discount</th>
              <th>Shops</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {(data ?? []).map((p) => (
              <tr key={p.id}>
                <td data-label="Plan">
                  <b>{p.name}</b> <span className="muted small">{p.code}</span>
                  {!p.isActive && (
                    <div>
                      <Badge value="CLOSED" />
                    </div>
                  )}
                  {p.isTrial && <div className="muted small">{p.trialDays} day trial</div>}
                </td>
                <td data-label="Per month" className="right num">
                  {rupees(p.monthlyPrice)}
                </td>
                <td data-label="Limits">
                  {p.maxBranches ?? '∞'} branches · {p.maxUsers ?? '∞'} users
                </td>
                <td data-label="Discount">
                  {Object.entries(p.durationDiscounts)
                    .map(([m, pct]) => `${m} mo −${pct}%`)
                    .join(', ') || '—'}
                </td>
                <td data-label="Shops" className="num">
                  {p.shops}
                </td>
                <td data-label="">
                  {role === 'ADMIN' && <button onClick={() => setEdit(p)}>Edit</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <PlanDialog
          plan={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={(m) => {
            setNotice(m);
            reload();
          }}
        />
      )}
    </>
  );
}

function PlanDialog({
  plan,
  onClose,
  onSaved,
}: {
  plan: Plan | null;
  onClose: () => void;
  onSaved: (m: string) => void;
}) {
  const [code, setCode] = useState(plan?.code ?? '');
  const [name, setName] = useState(plan?.name ?? '');
  const [price, setPrice] = useState(plan?.monthlyPrice ?? '');
  const [branches, setBranches] = useState(plan?.maxBranches?.toString() ?? '');
  const [users, setUsers] = useState(plan?.maxUsers?.toString() ?? '');
  const [trialDays, setTrialDays] = useState(plan?.trialDays?.toString() ?? '');
  const [discounts, setDiscounts] = useState(
    Object.entries(plan?.durationDiscounts ?? { '3': '5', '6': '10', '9': '12', '12': '15' })
      .map(([m, p]) => `${m}:${p}`)
      .join(', '),
  );
  const [active, setActive] = useState(plan?.isActive ?? true);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parseDiscounts = () =>
    Object.fromEntries(
      discounts
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => s.split(':').map((x) => x.trim()) as [string, string]),
    );
  const num = (v: string) => (v.trim() === '' ? null : Number(v));

  const save = () => {
    setBusy(true);
    setError(null);
    const common = {
      name,
      monthlyPrice: price,
      durationDiscounts: parseDiscounts(),
      maxBranches: num(branches),
      maxUsers: num(users),
    };
    const call = plan
      ? api.patch(`/plans/${plan.id}`, {
          ...common,
          isActive: active,
          ...(plan.isTrial && trialDays ? { trialDays: Number(trialDays) } : {}),
          reason,
        })
      : api.post('/plans', { code, ...common });
    call
      .then(() => {
        onSaved(plan ? 'Plan updated.' : 'Plan created.');
        onClose();
      })
      .catch((e: unknown) => setError(errorText(e)))
      .finally(() => setBusy(false));
  };

  return (
    <Modal title={plan ? `Edit ${plan.name}` : 'New plan'} onClose={onClose}>
      <Alert kind="error">{error}</Alert>
      {!plan && (
        <label>
          Code (A-Z, 0-9, _)
          <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        </label>
      )}
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Price per month (₹)
        <input inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />
      </label>
      <div className="row">
        <label style={{ flex: 1 }}>
          Max branches (empty = unlimited)
          <input
            inputMode="numeric"
            value={branches}
            onChange={(e) => setBranches(e.target.value)}
          />
        </label>
        <label style={{ flex: 1 }}>
          Max users (empty = unlimited)
          <input inputMode="numeric" value={users} onChange={(e) => setUsers(e.target.value)} />
        </label>
      </div>
      <label>
        Multi-month discounts (months:percent, comma separated)
        <input value={discounts} onChange={(e) => setDiscounts(e.target.value)} />
      </label>
      {plan?.isTrial && (
        <label>
          Trial length (days)
          <input
            inputMode="numeric"
            value={trialDays}
            onChange={(e) => setTrialDays(e.target.value)}
          />
        </label>
      )}
      {plan && (
        <>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              style={{ width: 'auto', margin: 0 }}
            />
            Plan can be sold
          </label>
          <label>
            Reason (audit log)
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
        </>
      )}
      <div className="actions">
        <button onClick={onClose}>Cancel</button>
        <button
          className="primary"
          disabled={busy || (plan !== null && reason.trim().length < 3)}
          onClick={save}
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
}

interface Payment {
  id: string;
  organizationId: string;
  shopName: string | null;
  amount: string;
  method: string;
  reference: string | null;
  months: number;
  receivedAt: string;
  reversesPaymentId: string | null;
  recordedBy: { email: string };
}

export function Payments() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rows, setRows] = useState<Payment[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const path = (c?: string | null) => {
    const p = new URLSearchParams({ limit: '100' });
    if (from) p.set('from', new Date(`${from}T00:00:00+05:30`).toISOString());
    if (to) p.set('to', new Date(`${to}T23:59:59+05:30`).toISOString());
    if (c) p.set('cursor', c);
    return `/payments?${p.toString()}`;
  };
  const { error, loading } = useLoad(async () => {
    const r = await request<Payment[]>('GET', path());
    setRows(r.data);
    setCursor(r.meta?.nextCursor ?? null);
  }, [from, to]);

  const exportCsv = async () => {
    const all: Payment[] = [];
    let c: string | null = null;
    do {
      const r: Awaited<ReturnType<typeof request<Payment[]>>> = await request<Payment[]>(
        'GET',
        path(c),
      );
      all.push(...r.data);
      c = r.meta?.nextCursor ?? null;
    } while (c);
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [
      [
        'Received',
        'Shop',
        'Amount',
        'Method',
        'Months',
        'Reference',
        'Refund of',
        'Recorded by',
      ].join(','),
      ...all.map((p) =>
        [
          p.receivedAt,
          p.shopName,
          p.amount,
          p.method,
          p.months,
          p.reference,
          p.reversesPaymentId,
          p.recordedBy.email,
        ]
          .map(esc)
          .join(','),
      ),
    ];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `payments-${from || 'all'}-${to || 'now'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <div className="spread">
        <h1 style={{ margin: 0 }}>Payments</h1>
        <button onClick={() => void exportCsv()}>Export CSV</button>
      </div>
      <div className="filters">
        <label>
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <Loading loading={loading && rows.length === 0} error={error} />
      <div className="card" style={{ padding: 0 }}>
        <table className="cards">
          <thead>
            <tr>
              <th>Received</th>
              <th>Shop</th>
              <th className="right">Amount</th>
              <th>Method</th>
              <th>Months</th>
              <th>Reference</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr
                key={p.id}
                className="click"
                onClick={() => (location.hash = `#/shops/${p.organizationId}`)}
              >
                <td data-label="Received">{dateTime(p.receivedAt)}</td>
                <td data-label="Shop">{p.shopName ?? '—'}</td>
                <td data-label="Amount" className="right num">
                  {rupees(p.amount)}
                </td>
                <td data-label="Method">{p.method}</td>
                <td data-label="Months">{p.months || '—'}</td>
                <td data-label="Reference">
                  {p.reference ?? (p.reversesPaymentId ? 'Refund' : '—')}
                </td>
                <td data-label="By">{p.recordedBy.email}</td>
              </tr>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={7} className="muted">
                  No payments in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {cursor && (
        <button
          onClick={() =>
            void request<Payment[]>('GET', path(cursor)).then((r) => {
              setRows((x) => [...x, ...r.data]);
              setCursor(r.meta?.nextCursor ?? null);
            })
          }
        >
          Load more
        </button>
      )}
    </>
  );
}
